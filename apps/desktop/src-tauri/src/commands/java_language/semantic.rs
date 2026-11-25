//! Tauri-free semantic request validation, cancellation, and result sanitization.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::process::ChildStdin;
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::contract::{
    JavaLanguageDocument, JavaSemanticNativeError, JavaSemanticNativeResponse, JavaSemanticRange,
    JavaSemanticRequest, JavaWorkspaceSymbolsNativeResponse, JavaWorkspaceSymbolsRequest,
    SemanticTokenLegend,
};
use super::path_policy::{authorize_java_path, diagnostic_uri_in_workspace, path_from_file_uri};
use super::protocol::{response_id, sanitize_range, write_message};
use super::support::lock;

mod workspace_code_actions;

pub(super) const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_OPEN_DOCUMENTS: usize = 128;
pub(super) const MAX_SEMANTIC_REQUESTS: usize = 16;
const MAX_SEMANTIC_ID_BYTES: usize = 256;
pub(super) const MAX_SEMANTIC_RESPONSE_BYTES: usize = 256 * 1024;
pub(super) const MAX_COMPLETION_ITEMS: usize = 200;
const MAX_ADDITIONAL_EDITS: usize = 16;
const MAX_COMMIT_CHARACTERS: usize = 16;
const MAX_HOVER_CONTENTS: usize = 8;
pub(super) const MAX_SIGNATURES: usize = 32;
const MAX_DOCUMENT_SYMBOLS: usize = 1_000;
const MAX_DOCUMENT_SYMBOL_DEPTH: usize = 32;
const MAX_DOCUMENT_HIGHLIGHTS: usize = 512;
const MAX_INLAY_HINTS: usize = 512;
pub(super) const MAX_WORKSPACE_SYMBOLS: usize = 100;
const MAX_WORKSPACE_SYMBOL_QUERY_CHARS: usize = 256;
const MAX_CALL_HIERARCHY_ITEMS: usize = 100;
const MAX_CALL_HIERARCHY_SITES: usize = 32;
pub(super) const MAX_CODE_ACTIONS: usize = 50;
const MAX_CODE_ACTION_EDITS: usize = 64;
const MAX_RENAME_DOCUMENTS: usize = 128;
const MAX_RENAME_EDITS: usize = 4_096;
const MAX_CODE_ACTION_DIAGNOSTICS: usize = 100;
const MAX_PARAMETERS: usize = 64;
pub(super) const MAX_SEMANTIC_STRING_CHARS: usize = 8_192;
const MAX_LABEL_CHARS: usize = 1_024;

#[derive(Clone)]
pub(super) struct OpenDocument {
    pub(super) path: String,
    pub(super) uri: String,
    pub(super) language_id: String,
    pub(super) version: i64,
    pub(super) text_hash: String,
    pub(super) line_utf16_boundaries: Vec<Vec<u32>>,
}

#[derive(Debug)]
pub(super) struct PendingSemanticRequest {
    pub(super) cancellation_id: String,
    pub(super) response_tx: mpsc::SyncSender<Value>,
}

pub(super) type PendingSemanticRequests = Arc<Mutex<HashMap<u64, PendingSemanticRequest>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PendingReservationError {
    Limit,
    DuplicateCancellationId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SemanticKind {
    Completion,
    Hover,
    SignatureHelp,
    DocumentSymbols,
    DocumentHighlights,
    Definitions,
    TypeDefinitions,
    Implementations,
    References,
    SemanticTokens,
    InlayHints,
    CodeActions,
    Rename,
    Formatting,
    RangeFormatting,
    OnTypeFormatting,
}

impl SemanticKind {
    pub(super) fn method(self) -> &'static str {
        match self {
            Self::Completion => "textDocument/completion",
            Self::Hover => "textDocument/hover",
            Self::SignatureHelp => "textDocument/signatureHelp",
            Self::DocumentSymbols => "textDocument/documentSymbol",
            Self::DocumentHighlights => "textDocument/documentHighlight",
            Self::Definitions => "textDocument/definition",
            Self::TypeDefinitions => "textDocument/typeDefinition",
            Self::Implementations => "textDocument/implementation",
            Self::References => "textDocument/references",
            Self::SemanticTokens => "textDocument/semanticTokens/full",
            Self::InlayHints => "textDocument/inlayHint",
            Self::CodeActions => "textDocument/codeAction",
            Self::Rename => "textDocument/rename",
            Self::Formatting => "textDocument/formatting",
            Self::RangeFormatting => "textDocument/rangeFormatting",
            Self::OnTypeFormatting => "textDocument/onTypeFormatting",
        }
    }
}

pub(super) fn validate_open_document(
    document: &OpenDocument,
    path: &str,
    uri: &str,
) -> Result<(), String> {
    if document.path != path || document.uri != uri || document.text_hash.len() != 64 {
        return Err("Native open document identity is inconsistent".to_string());
    }
    Ok(())
}

pub(super) fn require_java_language(document: &JavaLanguageDocument) -> Result<String, String> {
    match document.language_id.as_deref() {
        Some("java") => Ok("java".to_string()),
        _ => Err("Only the Java language is supported for document synchronization".to_string()),
    }
}

pub(super) fn require_document_text(document: &JavaLanguageDocument) -> Result<String, String> {
    let text = document
        .text
        .as_ref()
        .ok_or_else(|| "Full document text is required".to_string())?;
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err("Document exceeds the synchronization byte limit".to_string());
    }
    Ok(text.clone())
}

pub(super) fn hash_text(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub(super) fn line_utf16_boundaries(text: &str) -> Result<Vec<Vec<u32>>, String> {
    let mut lines = vec![vec![0_u32]];
    let mut previous_was_cr = false;
    for character in text.chars() {
        if character == '\n' {
            if previous_was_cr {
                previous_was_cr = false;
            } else {
                lines.push(vec![0]);
            }
            continue;
        }
        if character == '\r' {
            lines.push(vec![0]);
            previous_was_cr = true;
            continue;
        }
        previous_was_cr = false;
        let line = lines
            .last_mut()
            .ok_or_else(|| "Cannot build document position metadata".to_string())?;
        let next = line
            .last()
            .copied()
            .unwrap_or(0)
            .checked_add(character.len_utf16() as u32)
            .ok_or_else(|| "Document line exceeds the UTF-16 position limit".to_string())?;
        line.push(next);
    }
    Ok(lines)
}

pub(super) fn validate_semantic_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_SEMANTIC_ID_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(format!("Invalid semantic {label} ID"));
    }
    Ok(())
}

pub(super) fn native_response(
    request: &JavaSemanticRequest,
    provider_version: Option<String>,
) -> JavaSemanticNativeResponse {
    JavaSemanticNativeResponse {
        provider: "jdtls",
        provider_version,
        workspace_id: request.workspace_id.clone(),
        generation: request.generation,
        path: request.document.path.clone(),
        uri: request.document.uri.clone(),
        version: request.document.version,
        request_id: request.request_id.clone(),
        cancelled: false,
        timeout: false,
        error: None,
        result: None,
    }
}

pub(super) fn semantic_failure(
    mut response: JavaSemanticNativeResponse,
    kind: &str,
    summary: &str,
    retryable: bool,
) -> JavaSemanticNativeResponse {
    response.cancelled = kind == "cancelled";
    response.timeout = kind == "timeout";
    response.error = Some(JavaSemanticNativeError {
        kind: kind.to_string(),
        summary: Some(summary.to_string()),
        provider_code: None,
        retryable,
    });
    response
}

pub(super) fn workspace_symbols_response(
    request: &JavaWorkspaceSymbolsRequest,
    provider_version: Option<String>,
) -> JavaWorkspaceSymbolsNativeResponse {
    JavaWorkspaceSymbolsNativeResponse {
        provider: "jdtls",
        provider_version,
        workspace_id: request.workspace_id.clone(),
        generation: request.generation,
        request_id: request.request_id.clone(),
        cancelled: false,
        timeout: false,
        error: None,
        result: None,
    }
}

pub(super) fn workspace_symbols_failure(
    mut response: JavaWorkspaceSymbolsNativeResponse,
    kind: &str,
    summary: &str,
    retryable: bool,
) -> JavaWorkspaceSymbolsNativeResponse {
    response.cancelled = kind == "cancelled";
    response.timeout = kind == "timeout";
    response.error = Some(JavaSemanticNativeError {
        kind: kind.to_string(),
        summary: Some(summary.to_string()),
        provider_code: None,
        retryable,
    });
    response
}

pub(super) fn validate_workspace_symbol_query(query: &str) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty()
        || query.chars().count() > MAX_WORKSPACE_SYMBOL_QUERY_CHARS
        || query.chars().any(char::is_control)
    {
        return Err("Invalid Java workspace-symbol query".to_string());
    }
    Ok(query.to_string())
}

pub(super) fn validate_semantic_open_document(
    document: &OpenDocument,
    path: &str,
    uri: &str,
    request: &JavaSemanticRequest,
) -> Result<(), String> {
    validate_open_document(document, path, uri)?;
    if request.document.version != document.version {
        return Err("Java semantic document version is stale".to_string());
    }
    let Some(boundaries) = document
        .line_utf16_boundaries
        .get(request.position.line as usize)
    else {
        return Err("Java semantic position line is outside the document".to_string());
    };
    if boundaries
        .binary_search(&request.position.character)
        .is_err()
    {
        return Err("Java semantic UTF-16 position is outside the document line".to_string());
    }
    let valid_position = |position: &super::contract::JavaSemanticPosition| {
        document
            .line_utf16_boundaries
            .get(position.line as usize)
            .is_some_and(|line| line.binary_search(&position.character).is_ok())
    };
    if let Some(range) = &request.range {
        if !valid_position(&range.start)
            || !valid_position(&range.end)
            || (range.start.line, range.start.character)
                != (request.position.line, request.position.character)
            || (range.end.line, range.end.character) < (range.start.line, range.start.character)
        {
            return Err("Java semantic range is outside the synchronized document".to_string());
        }
    }
    if let Some(diagnostics) = &request.diagnostics {
        if diagnostics.len() > MAX_CODE_ACTION_DIAGNOSTICS
            || diagnostics.iter().any(|diagnostic| {
                !(1..=4).contains(&diagnostic.severity)
                    || diagnostic.message.len() > MAX_SEMANTIC_STRING_CHARS
                    || diagnostic
                        .source
                        .as_ref()
                        .is_some_and(|source| source.len() > 256)
                    || diagnostic.code.as_ref().is_some_and(|code| {
                        !code.is_string() && !code.is_number()
                            || code.as_str().is_some_and(|value| value.len() > 256)
                    })
                    || !valid_position(&diagnostic.range.start)
                    || !valid_position(&diagnostic.range.end)
                    || (diagnostic.range.end.line, diagnostic.range.end.character)
                        < (
                            diagnostic.range.start.line,
                            diagnostic.range.start.character,
                        )
            })
        {
            return Err("Java code-action diagnostic context is invalid".to_string());
        }
    }
    Ok(())
}

pub(super) fn semantic_params(
    request: &JavaSemanticRequest,
    kind: SemanticKind,
) -> Result<Value, String> {
    if (kind == SemanticKind::Rename) != request.new_name.is_some() {
        return Err("Java rename name is supported only for semantic rename".to_string());
    }
    let formatting_request = matches!(
        kind,
        SemanticKind::Formatting | SemanticKind::RangeFormatting | SemanticKind::OnTypeFormatting
    );
    if formatting_request != request.formatting_options.is_some() {
        return Err(
            "Java formatting options are supported only for formatting requests".to_string(),
        );
    }
    if (kind == SemanticKind::OnTypeFormatting) != request.formatting_character.is_some() {
        return Err("Java formatting character is supported only for on-type formatting".to_string());
    }
    let range_allowed = matches!(
        kind,
        SemanticKind::CodeActions | SemanticKind::RangeFormatting | SemanticKind::InlayHints
    );
    if !range_allowed && (request.range.is_some() || request.diagnostics.is_some()) {
        return Err("Range context is unsupported for this Java semantic request".to_string());
    }
    if matches!(
        kind,
        SemanticKind::CodeActions | SemanticKind::RangeFormatting | SemanticKind::InlayHints
    ) != request.range.is_some()
        || (kind == SemanticKind::CodeActions) != request.diagnostics.is_some()
        || (kind != SemanticKind::References && request.include_declaration.is_some())
    {
        return Err("Java range or diagnostics context is incomplete".to_string());
    }
    let mut params = match kind {
        SemanticKind::DocumentSymbols | SemanticKind::SemanticTokens => {
            json!({"textDocument":{"uri":request.document.uri}})
        }
        SemanticKind::InlayHints => {
            let range = request
                .range
                .as_ref()
                .ok_or_else(|| "Missing Java inlay-hint range".to_string())?;
            json!({"textDocument":{"uri":request.document.uri},"range":range})
        }
        SemanticKind::DocumentHighlights | SemanticKind::Definitions | SemanticKind::TypeDefinitions => json!({
            "textDocument":{"uri":request.document.uri},
            "position":{"line":request.position.line,"character":request.position.character}
        }),
        SemanticKind::References => {
            let include_declaration = request
                .include_declaration
                .ok_or_else(|| "Missing Java references declaration policy".to_string())?;
            json!({
                "textDocument":{"uri":request.document.uri},
                "position":{"line":request.position.line,"character":request.position.character},
                "context":{"includeDeclaration":include_declaration}
            })
        }
        SemanticKind::CodeActions => {
            let range = request
                .range
                .as_ref()
                .ok_or_else(|| "Missing code-action range".to_string())?;
            let diagnostics = request
                .diagnostics
                .as_ref()
                .ok_or_else(|| "Missing code-action diagnostics".to_string())?;
            json!({
                "textDocument":{"uri":request.document.uri},
                "range":range,
                "context":{"diagnostics":diagnostics,"only":["quickfix","quickassist","refactor","source"]}
            })
        }
        SemanticKind::Rename => {
            let new_name = request
                .new_name
                .as_deref()
                .filter(|name| {
                    !name.trim().is_empty()
                        && name.len() <= 256
                        && !name.chars().any(char::is_control)
                })
                .ok_or_else(|| "Invalid Java rename name".to_string())?;
            json!({
                "textDocument":{"uri":request.document.uri},
                "position":{"line":request.position.line,"character":request.position.character},
                "newName":new_name
            })
        }
        SemanticKind::Formatting | SemanticKind::OnTypeFormatting => {
            let options = request
                .formatting_options
                .as_ref()
                .filter(|options| (1..=16).contains(&options.tab_size))
                .ok_or_else(|| "Invalid Java formatting options".to_string())?;
            let mut params = json!({
                "textDocument":{"uri":request.document.uri},
                "options":{
                    "tabSize":options.tab_size,
                    "insertSpaces":options.insert_spaces
                }
            });
            if kind == SemanticKind::OnTypeFormatting {
                let character = request.formatting_character.as_deref()
                    .filter(|value| value.chars().count() == 1 && !value.contains('\0'))
                    .ok_or_else(|| "Invalid Java formatting character".to_string())?;
                params["ch"] = json!(character);
                params["position"] = json!(request.position);
            }
            params
        }
        SemanticKind::RangeFormatting => {
            let range = request
                .range
                .as_ref()
                .ok_or_else(|| "Missing Java formatting range".to_string())?;
            let options = request
                .formatting_options
                .as_ref()
                .filter(|options| (1..=16).contains(&options.tab_size))
                .ok_or_else(|| "Invalid Java formatting options".to_string())?;
            json!({
                "textDocument":{"uri":request.document.uri},
                "range":range,
                "options":{
                    "tabSize":options.tab_size,
                    "insertSpaces":options.insert_spaces
                }
            })
        }
        _ => json!({
            "textDocument":{"uri":request.document.uri},
            "position":{"line":request.position.line,"character":request.position.character}
        }),
    };
    match kind {
        SemanticKind::Completion => {
            let context = match &request.trigger {
                None => json!({"triggerKind":1}),
                Some(trigger) if trigger.kind == "invoked" && trigger.character.is_none() => {
                    json!({"triggerKind":1})
                }
                Some(trigger)
                    if trigger.kind == "trigger-character"
                        && trigger.character.as_deref().is_some_and(|value| {
                            !value.is_empty()
                                && value.len() <= 4
                                && value.chars().count() == 1
                                && !value.chars().any(char::is_control)
                        }) =>
                {
                    json!({"triggerKind":2,"triggerCharacter":trigger.character})
                }
                Some(trigger)
                    if trigger.kind == "incomplete-completions" && trigger.character.is_none() =>
                {
                    json!({"triggerKind":3})
                }
                _ => return Err("Invalid Java completion trigger context".to_string()),
            };
            params["context"] = context;
        }
        SemanticKind::Hover => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
        }
        SemanticKind::SignatureHelp => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
            // The UI contract does not expose Monaco trigger details, so native requests are
            // explicit invocations. JDT LS returns an empty result when context is omitted.
            params["context"] = json!({"triggerKind":1,"isRetrigger":false});
        }
        SemanticKind::DocumentSymbols => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
        }
        SemanticKind::DocumentHighlights | SemanticKind::Definitions | SemanticKind::TypeDefinitions => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
        }
        SemanticKind::Implementations => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
        }
        SemanticKind::References => {
            if request.trigger.is_some() || request.range.is_some() || request.diagnostics.is_some()
            {
                return Err("References context contains unsupported fields".to_string());
            }
        }
        SemanticKind::SemanticTokens => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
        }
        SemanticKind::InlayHints => {
            if request.trigger.is_some() || request.range.is_none() || request.diagnostics.is_some()
            {
                return Err("Inlay-hint context is invalid".to_string());
            }
        }
        SemanticKind::CodeActions => {
            if request.trigger.is_some() {
                return Err("Trigger context is supported only for completion".to_string());
            }
        }
        SemanticKind::Rename => {
            if request.trigger.is_some() || request.range.is_some() || request.diagnostics.is_some()
            {
                return Err("Rename context contains unsupported fields".to_string());
            }
        }
        SemanticKind::Formatting | SemanticKind::OnTypeFormatting => {
            if request.trigger.is_some() || request.range.is_some() || request.diagnostics.is_some()
            {
                return Err("Formatting context contains unsupported fields".to_string());
            }
        }
        SemanticKind::RangeFormatting => {
            if request.trigger.is_some() || request.range.is_none() || request.diagnostics.is_some()
            {
                return Err("Range-formatting context is invalid".to_string());
            }
        }
    }
    Ok(params)
}

pub(super) fn reserve_pending_request(
    pending: &PendingSemanticRequests,
    native_id: u64,
    cancellation_id: String,
    response_tx: mpsc::SyncSender<Value>,
) -> Result<Result<(), PendingReservationError>, String> {
    let mut requests = lock(pending, "Java semantic pending requests")?;
    if requests.len() >= MAX_SEMANTIC_REQUESTS {
        return Ok(Err(PendingReservationError::Limit));
    }
    if requests
        .values()
        .any(|entry| entry.cancellation_id == cancellation_id)
    {
        return Ok(Err(PendingReservationError::DuplicateCancellationId));
    }
    requests.insert(
        native_id,
        PendingSemanticRequest {
            cancellation_id,
            response_tx,
        },
    );
    Ok(Ok(()))
}

pub(super) fn send_cancel(writer: &Arc<Mutex<ChildStdin>>, native_id: u64) {
    let _ = write_message(
        writer,
        &json!({"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":native_id}}),
    );
}

pub(super) fn cancel_by_cancellation_id(
    pending: &PendingSemanticRequests,
    writer: &Arc<Mutex<ChildStdin>>,
    cancellation_id: &str,
) {
    let cancelled = pending
        .lock()
        .map(|mut requests| {
            let ids = requests
                .iter()
                .filter_map(|(id, entry)| (entry.cancellation_id == cancellation_id).then_some(*id))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| requests.remove(&id).map(|request| (id, request)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for (native_id, request) in cancelled {
        send_cancel(writer, native_id);
        let _ = request.response_tx.try_send(json!({"__cancelled":true}));
    }
}

pub(super) fn route_pending_response(pending: &PendingSemanticRequests, message: &Value) -> bool {
    if message.get("method").is_some() || message.get("id").is_none() {
        return false;
    }
    if let Some(native_id) = response_id(message) {
        let request = pending
            .lock()
            .ok()
            .and_then(|mut requests| requests.remove(&native_id));
        if let Some(request) = request {
            let _ = request.response_tx.try_send(message.clone());
        }
    }
    true
}

pub(super) fn cancel_all_semantic_requests(
    pending: &PendingSemanticRequests,
    writer: &Arc<Mutex<ChildStdin>>,
) {
    let requests = pending
        .lock()
        .map(|mut requests| requests.drain().collect::<Vec<_>>())
        .unwrap_or_default();
    for (native_id, request) in requests {
        send_cancel(writer, native_id);
        let _ = request.response_tx.try_send(json!({"__cancelled":true}));
    }
}

pub(super) fn bounded_string(value: &Value, max_chars: usize) -> Option<String> {
    let value = value.as_str()?;
    Some(value.chars().take(max_chars).collect())
}

pub(super) fn semantic_content_exceeds_cap(value: &Value) -> bool {
    value
        .as_str()
        .or_else(|| value.get("value").and_then(Value::as_str))
        .is_some_and(|text| text.chars().count() > MAX_SEMANTIC_STRING_CHARS)
}

pub(super) fn sanitize_content(value: &Value) -> Option<Value> {
    if let Some(text) = value.as_str() {
        return Some(json!({
            "format":"plaintext",
            "value":text.chars().take(MAX_SEMANTIC_STRING_CHARS).collect::<String>()
        }));
    }
    let object = value.as_object()?;
    let kind = object.get("kind")?.as_str()?;
    let format = match kind {
        "plaintext" => "plaintext",
        "markdown" => "markdown",
        _ => return None,
    };
    let text = object.get("value")?.as_str()?;
    Some(json!({
        "format":format,
        "value":text.chars().take(MAX_SEMANTIC_STRING_CHARS).collect::<String>()
    }))
}

pub(super) fn sanitize_semantic_range(value: &Value) -> Option<Value> {
    let clean = sanitize_range(value)?;
    let start_line = clean.pointer("/start/line")?.as_u64()?;
    let start_character = clean.pointer("/start/character")?.as_u64()?;
    let end_line = clean.pointer("/end/line")?.as_u64()?;
    let end_character = clean.pointer("/end/character")?.as_u64()?;
    if (end_line, end_character) < (start_line, start_character)
        || end_line.saturating_sub(start_line) > 100_000
        || start_character > 1_000_000
        || end_character > 1_000_000
    {
        return None;
    }
    Some(clean)
}

pub(super) fn sanitize_text_edit(value: &Value) -> Option<Value> {
    let edit = value.as_object()?;
    let range = sanitize_semantic_range(edit.get("range")?)?;
    let new_text = bounded_string(edit.get("newText")?, MAX_SEMANTIC_STRING_CHARS)?;
    Some(json!({"range":range,"newText":new_text}))
}

pub(super) fn completion_kind(value: Option<&Value>) -> &'static str {
    match value.and_then(Value::as_u64) {
        Some(1) => "text",
        Some(2) => "method",
        Some(3) => "function",
        Some(4) => "constructor",
        Some(5) => "field",
        Some(6) => "variable",
        Some(7) => "class",
        Some(8) => "interface",
        Some(9) => "module",
        Some(10) => "property",
        Some(11) => "unit",
        Some(12) => "value",
        Some(13) => "enum",
        Some(14) => "keyword",
        Some(15) => "snippet",
        Some(16) => "color",
        Some(17) => "file",
        Some(18) => "reference",
        Some(19) => "folder",
        Some(20) => "enum-member",
        Some(21) => "constant",
        Some(22) => "struct",
        Some(23) => "event",
        Some(24) => "operator",
        Some(25) => "type-parameter",
        _ => "unknown",
    }
}

pub(super) fn sanitize_completion_item(
    value: &Value,
    request: &JavaSemanticRequest,
) -> Option<Value> {
    let item = value.as_object()?;
    let label = bounded_string(item.get("label")?, MAX_LABEL_CHARS)?;
    if label.is_empty() {
        return None;
    }
    let mut clean = Map::new();
    clean.insert("label".to_string(), Value::String(label));
    clean.insert(
        "kind".to_string(),
        Value::String(completion_kind(item.get("kind")).to_string()),
    );
    for (source, target, cap) in [
        ("detail", "detail", MAX_SEMANTIC_STRING_CHARS),
        ("sortText", "sortText", MAX_LABEL_CHARS),
        ("filterText", "filterText", MAX_LABEL_CHARS),
        ("insertText", "insertText", MAX_SEMANTIC_STRING_CHARS),
    ] {
        if let Some(value) = item
            .get(source)
            .and_then(|value| bounded_string(value, cap))
        {
            clean.insert(target.to_string(), Value::String(value));
        }
    }
    if let Some(documentation) = item.get("documentation").and_then(sanitize_content) {
        clean.insert("documentation".to_string(), documentation);
    }
    if let Some(edit) = item.get("textEdit").and_then(sanitize_text_edit) {
        clean.insert("textEdit".to_string(), edit);
    }
    if let Some(edits) = item.get("additionalTextEdits").and_then(Value::as_array) {
        let edits = edits
            .iter()
            .take(MAX_ADDITIONAL_EDITS)
            .filter_map(sanitize_text_edit)
            .map(|edit| {
                json!({
                    "document":{
                        "workspaceId":request.workspace_id,
                        "path":request.document.path,
                        "uri":request.document.uri,
                        "version":request.document.version
                    },
                    "edit":edit
                })
            })
            .collect::<Vec<_>>();
        if !edits.is_empty() {
            clean.insert("additionalTextEdits".to_string(), Value::Array(edits));
        }
    }
    if let Some(characters) = item.get("commitCharacters").and_then(Value::as_array) {
        let characters = characters
            .iter()
            .take(MAX_COMMIT_CHARACTERS)
            .filter_map(|value| {
                let value = value.as_str()?;
                (!value.is_empty()
                    && value.chars().count() == 1
                    && !value.chars().any(char::is_control))
                .then(|| Value::String(value.to_string()))
            })
            .collect::<Vec<_>>();
        if !characters.is_empty() {
            clean.insert("commitCharacters".to_string(), Value::Array(characters));
        }
    }
    for field in ["deprecated", "preselect"] {
        if let Some(value) = item.get(field).and_then(Value::as_bool) {
            clean.insert(field.to_string(), Value::Bool(value));
        }
    }
    Some(Value::Object(clean))
}

pub(super) fn sanitize_completion(value: &Value, request: &JavaSemanticRequest) -> Option<Value> {
    let (items, incomplete) = if value.is_null() {
        (&[][..], false)
    } else if let Some(items) = value.as_array() {
        (items.as_slice(), false)
    } else {
        let object = value.as_object()?;
        (
            object.get("items")?.as_array()?.as_slice(),
            object
                .get("isIncomplete")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
    };
    let input_count = items.len();
    let mut items = items
        .iter()
        .take(MAX_COMPLETION_ITEMS)
        .filter_map(|item| sanitize_completion_item(item, request))
        .collect::<Vec<_>>();
    let mut result = json!({
        "items":items,
        "isIncomplete":incomplete || input_count > items.len()
    });
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        items.pop()?;
        result["items"] = Value::Array(items.clone());
        result["isIncomplete"] = Value::Bool(true);
    }
    Some(result)
}

pub(super) fn sanitize_hover_content(value: &Value) -> Option<Value> {
    if value.is_string() || value.get("kind").is_some() {
        return sanitize_content(value);
    }
    let object = value.as_object()?;
    let text = object.get("value")?.as_str()?;
    let language = object.get("language")?.as_str()?;
    let markdown = format!(
        "```{}\n{}\n```",
        language.chars().take(64).collect::<String>(),
        text.chars()
            .take(MAX_SEMANTIC_STRING_CHARS)
            .collect::<String>()
    );
    Some(json!({"format":"markdown","value":markdown}))
}

pub(super) fn sanitize_hover(value: &Value) -> Option<Value> {
    if value.is_null() {
        return Some(json!({"contents":[],"isTruncated":false}));
    }
    let hover = value.as_object()?;
    let raw = hover.get("contents")?;
    let total = raw.as_array().map_or(1, Vec::len);
    let mut contents = raw
        .as_array()
        .map(|items| {
            items
                .iter()
                .take(MAX_HOVER_CONTENTS)
                .filter_map(sanitize_hover_content)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| sanitize_hover_content(raw).into_iter().collect());
    let content_was_truncated = raw
        .as_array()
        .map(|items| {
            items
                .iter()
                .take(MAX_HOVER_CONTENTS)
                .any(semantic_content_exceeds_cap)
        })
        .unwrap_or_else(|| semantic_content_exceeds_cap(raw));
    let mut truncated = total > contents.len() || content_was_truncated;
    let mut result = json!({"contents":contents,"isTruncated":truncated});
    if let Some(range) = hover.get("range") {
        result["range"] = sanitize_semantic_range(range)?;
    }
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        contents.pop()?;
        truncated = true;
        result["contents"] = Value::Array(contents.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

pub(super) fn sanitize_parameter(value: &Value, signature_label: &str) -> Option<Value> {
    let parameter = value.as_object()?;
    let label = parameter.get("label")?;
    let label = if let Some(label) = label.as_str() {
        Value::String(label.chars().take(MAX_LABEL_CHARS).collect())
    } else {
        let offsets = label.as_array()?;
        if offsets.len() != 2 {
            return None;
        }
        let start = offsets[0].as_u64()?;
        let end = offsets[1].as_u64()?;
        if start > end || end > signature_label.encode_utf16().count() as u64 {
            return None;
        }
        json!({"start":start,"end":end})
    };
    let mut clean = json!({"label":label});
    if let Some(documentation) = parameter.get("documentation").and_then(sanitize_content) {
        clean["documentation"] = documentation;
    }
    Some(clean)
}

pub(super) fn sanitize_signature(value: &Value) -> Option<Value> {
    let signature = value.as_object()?;
    let label = bounded_string(signature.get("label")?, MAX_LABEL_CHARS)?;
    let raw_parameters = signature
        .get("parameters")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let parameters = raw_parameters
        .iter()
        .take(MAX_PARAMETERS)
        .filter_map(|parameter| sanitize_parameter(parameter, &label))
        .collect::<Vec<_>>();
    let mut clean = json!({"label":label,"parameters":parameters});
    if let Some(documentation) = signature.get("documentation").and_then(sanitize_content) {
        clean["documentation"] = documentation;
    }
    if let Some(active) = signature.get("activeParameter").and_then(Value::as_u64) {
        if (active as usize) < parameters.len() {
            clean["activeParameter"] = Value::from(active);
        }
    }
    Some(clean)
}

pub(super) fn sanitize_signature_help(value: &Value) -> Option<Value> {
    if value.is_null() {
        return Some(json!({"signatures":[],"isTruncated":false}));
    }
    let help = value.as_object()?;
    let raw = help.get("signatures")?.as_array()?;
    let mut signatures = raw
        .iter()
        .take(MAX_SIGNATURES)
        .filter_map(sanitize_signature)
        .collect::<Vec<_>>();
    let nested_truncation = raw.iter().take(MAX_SIGNATURES).any(|signature| {
        let label_truncated = signature
            .get("label")
            .and_then(Value::as_str)
            .is_some_and(|label| label.chars().count() > MAX_LABEL_CHARS);
        let documentation_truncated = signature
            .get("documentation")
            .is_some_and(semantic_content_exceeds_cap);
        let parameters_truncated = signature
            .get("parameters")
            .and_then(Value::as_array)
            .is_some_and(|parameters| {
                parameters.len() > MAX_PARAMETERS
                    || parameters.iter().take(MAX_PARAMETERS).any(|parameter| {
                        parameter
                            .get("documentation")
                            .is_some_and(semantic_content_exceeds_cap)
                    })
            });
        label_truncated || documentation_truncated || parameters_truncated
    });
    let mut truncated = raw.len() > signatures.len() || nested_truncation;
    let mut result = json!({"signatures":signatures,"isTruncated":truncated});
    if let Some(active) = help.get("activeSignature").and_then(Value::as_u64) {
        if (active as usize) < signatures.len() {
            result["activeSignature"] = Value::from(active);
        }
    }
    if let Some(active) = help.get("activeParameter").and_then(Value::as_u64) {
        let active_signature = result
            .get("activeSignature")
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        let parameter_count = signatures
            .get(active_signature)
            .and_then(|signature| signature.get("parameters"))
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if (active as usize) < parameter_count {
            result["activeParameter"] = Value::from(active);
        }
    }
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        signatures.pop()?;
        truncated = true;
        result["signatures"] = Value::Array(signatures.clone());
        result["isTruncated"] = Value::Bool(truncated);
        result.as_object_mut()?.remove("activeSignature");
        result.as_object_mut()?.remove("activeParameter");
    }
    Some(result)
}

fn document_symbol_kind(value: Option<&Value>) -> Option<&'static str> {
    Some(match value.and_then(Value::as_u64)? {
        1 => "file",
        2 => "module",
        3 => "namespace",
        4 => "package",
        5 => "class",
        6 => "method",
        7 => "property",
        8 => "field",
        9 => "constructor",
        10 => "enum",
        11 => "interface",
        12 => "function",
        13 => "variable",
        14 => "constant",
        15 => "string",
        16 => "number",
        17 => "boolean",
        18 => "array",
        19 => "object",
        20 => "key",
        21 => "null",
        22 => "enum-member",
        23 => "struct",
        24 => "event",
        25 => "operator",
        26 => "type-parameter",
        _ => return None,
    })
}

fn workspace_symbol_path(uri: &str, workspace_root: &Path) -> Option<String> {
    if uri.len() > super::protocol::MAX_DIAGNOSTIC_URI_BYTES {
        return None;
    }
    let root = workspace_root.canonicalize().ok()?;
    let path = path_from_file_uri(uri)?.canonicalize().ok()?;
    if !path.starts_with(&root)
        || path == root
        || path.extension().and_then(|extension| extension.to_str()) != Some("java")
    {
        return None;
    }
    let relative = path
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    if relative.is_empty() || relative.chars().any(char::is_control) {
        return None;
    }
    Some(relative)
}

fn sanitize_call_hierarchy_item(
    value: &Value,
    workspace_root: &Path,
) -> Option<(String, &'static str, Option<String>, String, Value)> {
    let item = value.as_object()?;
    let name = item
        .get("name")
        .and_then(|value| bounded_string(value, MAX_LABEL_CHARS))
        .filter(|name| !name.is_empty())?;
    let kind = document_symbol_kind(item.get("kind"))?;
    let path = item
        .get("uri")
        .and_then(Value::as_str)
        .and_then(|uri| workspace_symbol_path(uri, workspace_root))?;
    let range = item.get("range").and_then(sanitize_semantic_range)?;
    let selection = item
        .get("selectionRange")
        .and_then(sanitize_semantic_range)?;
    let range_start = range.pointer("/start")?;
    let range_end = range.pointer("/end")?;
    let selection_start = selection.pointer("/start")?;
    let selection_end = selection.pointer("/end")?;
    let position = |value: &Value| -> Option<(u64, u64)> {
        Some((
            value.get("line")?.as_u64()?,
            value.get("character")?.as_u64()?,
        ))
    };
    if position(range_start)? > position(selection_start)?
        || position(selection_end)? > position(range_end)?
    {
        return None;
    }
    let detail = item
        .get("detail")
        .and_then(|detail| bounded_string(detail, MAX_LABEL_CHARS))
        .filter(|detail| !detail.is_empty());
    Some((name, kind, detail, path, selection))
}

pub(super) fn call_hierarchy_item_is_workspace_source(value: &Value, root: &Path) -> bool {
    sanitize_call_hierarchy_item(value, root).is_some()
}

pub(super) fn sanitize_call_hierarchy(
    direction: &str,
    prepared_items: &[Value],
    calls: &[Value],
    mut truncated: bool,
    workspace_root: &Path,
) -> Option<Value> {
    if !matches!(direction, "incoming" | "outgoing") || prepared_items.len() != calls.len() {
        return None;
    }
    let mut entries: Vec<Value> = Vec::new();
    let mut entry_indexes = HashMap::<String, usize>::new();
    let mut seen_sites = HashSet::<String>::new();
    for (prepared, raw_calls) in prepared_items.iter().zip(calls) {
        let Some((_, _, _, prepared_path, _)) =
            sanitize_call_hierarchy_item(prepared, workspace_root)
        else {
            truncated = true;
            continue;
        };
        let raw_calls = if raw_calls.is_null() {
            &[][..]
        } else if let Some(raw_calls) = raw_calls.as_array() {
            raw_calls.as_slice()
        } else {
            truncated = true;
            continue;
        };
        if raw_calls.len() > MAX_CALL_HIERARCHY_ITEMS {
            truncated = true;
        }
        for raw_call in raw_calls.iter().take(MAX_CALL_HIERARCHY_ITEMS) {
            let Some(raw_call) = raw_call.as_object() else {
                truncated = true;
                continue;
            };
            let item_key = if direction == "incoming" {
                "from"
            } else {
                "to"
            };
            let Some((name, kind, detail, path, selection_range)) = raw_call
                .get(item_key)
                .and_then(|item| sanitize_call_hierarchy_item(item, workspace_root))
            else {
                truncated = true;
                continue;
            };
            let Some(raw_ranges) = raw_call.get("fromRanges").and_then(Value::as_array) else {
                truncated = true;
                continue;
            };
            if raw_ranges.len() > MAX_CALL_HIERARCHY_SITES {
                truncated = true;
            }
            let site_path = if direction == "incoming" {
                path.as_str()
            } else {
                prepared_path.as_str()
            };
            let entry_key = format!(
                "{}:{}:{}:{}",
                path,
                name,
                selection_range.pointer("/start/line")?.as_u64()?,
                selection_range.pointer("/start/character")?.as_u64()?
            );
            let index = if let Some(index) = entry_indexes.get(&entry_key) {
                *index
            } else {
                if entries.len() >= MAX_CALL_HIERARCHY_ITEMS {
                    truncated = true;
                    continue;
                }
                let mut entry = json!({
                    "name":name,
                    "kind":kind,
                    "location":{"path":path,"range":selection_range},
                    "callSites":[]
                });
                if let Some(detail) = detail {
                    entry["detail"] = json!(detail);
                }
                let index = entries.len();
                entries.push(entry);
                entry_indexes.insert(entry_key.clone(), index);
                index
            };
            for range in raw_ranges.iter().take(MAX_CALL_HIERARCHY_SITES) {
                let Some(range) = sanitize_semantic_range(range) else {
                    truncated = true;
                    continue;
                };
                let site_key = format!("{}:{}", site_path, range);
                if !seen_sites.insert(site_key) {
                    continue;
                }
                let Some(sites) = entries[index]["callSites"].as_array_mut() else {
                    return None;
                };
                if sites.len() >= MAX_CALL_HIERARCHY_SITES {
                    truncated = true;
                    continue;
                }
                sites.push(json!({"path":site_path,"range":range}));
            }
        }
    }
    let mut result = json!({"direction":direction,"entries":entries,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if entries.pop().is_none() {
            return None;
        }
        result["entries"] = Value::Array(entries.clone());
        result["isTruncated"] = Value::Bool(true);
    }
    Some(result)
}

pub(super) fn sanitize_workspace_symbols(value: &Value, workspace_root: &Path) -> Option<Value> {
    let raw_symbols: &[Value] = if value.is_null() {
        &[]
    } else {
        value.as_array()?.as_slice()
    };
    let mut symbols = Vec::new();
    let mut truncated = raw_symbols.len() > MAX_WORKSPACE_SYMBOLS;
    for raw in raw_symbols.iter().take(MAX_WORKSPACE_SYMBOLS) {
        let Some(symbol) = raw.as_object() else {
            truncated = true;
            continue;
        };
        let Some(name) = symbol
            .get("name")
            .and_then(|value| bounded_string(value, MAX_LABEL_CHARS))
            .filter(|name| !name.is_empty())
        else {
            truncated = true;
            continue;
        };
        let Some(kind) = document_symbol_kind(symbol.get("kind")) else {
            truncated = true;
            continue;
        };
        let Some(location) = symbol.get("location").and_then(Value::as_object) else {
            truncated = true;
            continue;
        };
        let Some(path) = location
            .get("uri")
            .and_then(Value::as_str)
            .and_then(|uri| workspace_symbol_path(uri, workspace_root))
        else {
            truncated = true;
            continue;
        };
        let Some(range) = location.get("range").and_then(sanitize_semantic_range) else {
            truncated = true;
            continue;
        };
        let mut clean = json!({"name":name,"kind":kind,"path":path,"range":range});
        if let Some(container) = symbol
            .get("containerName")
            .and_then(|value| bounded_string(value, MAX_LABEL_CHARS))
            .filter(|container| !container.is_empty())
        {
            clean["containerName"] = Value::String(container);
        }
        let deprecated = symbol.get("deprecated").and_then(Value::as_bool) == Some(true)
            || symbol
                .get("tags")
                .and_then(Value::as_array)
                .is_some_and(|tags| tags.iter().any(|tag| tag.as_u64() == Some(1)));
        if deprecated {
            clean["deprecated"] = Value::Bool(true);
        }
        symbols.push(clean);
    }
    let mut result = json!({"symbols":symbols,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if symbols.pop().is_none() {
            return None;
        }
        truncated = true;
        result["symbols"] = Value::Array(symbols.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

pub(super) fn sanitize_implementations(value: &Value, workspace_root: &Path) -> Option<Value> {
    let raw_locations: Vec<&Value> = if value.is_null() {
        Vec::new()
    } else if let Some(locations) = value.as_array() {
        locations.iter().collect()
    } else {
        vec![value]
    };
    let mut locations = Vec::new();
    let mut truncated = raw_locations.len() > MAX_WORKSPACE_SYMBOLS;
    for raw in raw_locations.iter().take(MAX_WORKSPACE_SYMBOLS) {
        let Some(location) = raw.as_object() else {
            truncated = true;
            continue;
        };
        // textDocument/implementation may return either Location or LocationLink.
        let uri = location
            .get("uri")
            .or_else(|| location.get("targetUri"))
            .and_then(Value::as_str);
        let Some(path) = uri.and_then(|uri| workspace_symbol_path(uri, workspace_root)) else {
            truncated = true;
            continue;
        };
        let range = location
            .get("targetSelectionRange")
            .or_else(|| location.get("range"))
            .or_else(|| location.get("targetRange"))
            .and_then(sanitize_semantic_range);
        let Some(range) = range else {
            truncated = true;
            continue;
        };
        locations.push(json!({"path":path,"range":range}));
    }
    let mut result = json!({"locations":locations,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if locations.pop().is_none() {
            return None;
        }
        truncated = true;
        result["locations"] = Value::Array(locations.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

pub(super) fn sanitize_references(value: &Value, workspace_root: &Path) -> Option<Value> {
    // References use LSP Location values. Reuse the path and range policy shared
    // with implementation navigation, while preserving a separate result type.
    sanitize_implementations(value, workspace_root)
}

fn range_tuple(value: &Value) -> Option<((u64, u64), (u64, u64))> {
    let start_line = value.pointer("/start/line")?.as_u64()?;
    let start_character = value.pointer("/start/character")?.as_u64()?;
    let end_line = value.pointer("/end/line")?.as_u64()?;
    let end_character = value.pointer("/end/character")?.as_u64()?;
    Some(((start_line, start_character), (end_line, end_character)))
}

fn range_contains(outer: &Value, inner: &Value) -> bool {
    let (Some((outer_start, outer_end)), Some((inner_start, inner_end))) =
        (range_tuple(outer), range_tuple(inner))
    else {
        return false;
    };
    outer_start <= inner_start && inner_end <= outer_end
}

fn sanitize_document_symbol(
    value: &Value,
    count: &mut usize,
    depth: usize,
) -> Option<(Value, bool)> {
    if depth > MAX_DOCUMENT_SYMBOL_DEPTH || *count >= MAX_DOCUMENT_SYMBOLS {
        return None;
    }
    *count += 1;
    let symbol = value.as_object()?;
    let name = bounded_string(symbol.get("name")?, MAX_LABEL_CHARS)?;
    if name.is_empty() {
        return None;
    }
    let kind = document_symbol_kind(symbol.get("kind"))?;
    let range = sanitize_semantic_range(symbol.get("range")?)?;
    let selection_range = sanitize_semantic_range(symbol.get("selectionRange")?)?;
    if !range_contains(&range, &selection_range) {
        return None;
    }
    let mut clean = json!({
        "name":name,
        "kind":kind,
        "range":range,
        "selectionRange":selection_range
    });
    if let Some(detail) = symbol
        .get("detail")
        .and_then(|value| bounded_string(value, MAX_SEMANTIC_STRING_CHARS))
    {
        clean["detail"] = Value::String(detail);
    }
    let deprecated = symbol
        .get("deprecated")
        .and_then(Value::as_bool)
        .or_else(|| {
            symbol
                .get("tags")
                .and_then(Value::as_array)
                .is_some_and(|tags| tags.iter().any(|tag| tag.as_u64() == Some(1)))
                .then_some(true)
        })
        .unwrap_or(false);
    if deprecated {
        clean["tags"] = json!([1]);
    }
    let mut truncated = false;
    if let Some(raw_children) = symbol.get("children") {
        let children = raw_children.as_array()?;
        let mut clean_children = Vec::new();
        for child in children.iter().take(MAX_DOCUMENT_SYMBOLS) {
            match sanitize_document_symbol(child, count, depth + 1) {
                Some((child, child_truncated)) if range_contains(&range, &child["range"]) => {
                    clean_children.push(child);
                    truncated |= child_truncated;
                }
                _ => truncated = true,
            }
        }
        truncated |= children.len() > clean_children.len();
        clean["children"] = Value::Array(clean_children);
    }
    Some((clean, truncated))
}

pub(super) fn sanitize_document_symbols(value: &Value) -> Option<Value> {
    let raw_symbols: &[Value] = if value.is_null() {
        &[]
    } else {
        value.as_array()?.as_slice()
    };
    let mut count = 0;
    let mut symbols = Vec::new();
    let mut truncated = raw_symbols.len() > MAX_DOCUMENT_SYMBOLS;
    for symbol in raw_symbols.iter().take(MAX_DOCUMENT_SYMBOLS) {
        match sanitize_document_symbol(symbol, &mut count, 0) {
            Some((symbol, symbol_truncated)) => {
                symbols.push(symbol);
                truncated |= symbol_truncated;
            }
            None => truncated = true,
        }
    }
    let mut result = json!({"symbols":symbols,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if symbols.pop().is_none() {
            return None;
        }
        truncated = true;
        result["symbols"] = Value::Array(symbols.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

fn document_highlight_kind(value: Option<&Value>) -> Option<&'static str> {
    Some(match value.and_then(Value::as_u64)? {
        1 => "text",
        2 => "read",
        3 => "write",
        _ => return None,
    })
}

pub(super) fn sanitize_document_highlights(value: &Value) -> Option<Value> {
    let raw_highlights: &[Value] = if value.is_null() {
        &[]
    } else {
        value.as_array()?.as_slice()
    };
    let mut highlights = Vec::new();
    let mut truncated = raw_highlights.len() > MAX_DOCUMENT_HIGHLIGHTS;
    for raw in raw_highlights.iter().take(MAX_DOCUMENT_HIGHLIGHTS) {
        let Some(highlight) = raw.as_object() else {
            truncated = true;
            continue;
        };
        let Some(range) = highlight.get("range").and_then(sanitize_semantic_range) else {
            truncated = true;
            continue;
        };
        let mut clean = json!({"range":range});
        if let Some(kind) = document_highlight_kind(highlight.get("kind")) {
            clean["kind"] = Value::String(kind.to_string());
        } else if highlight.contains_key("kind") {
            truncated = true;
            continue;
        }
        highlights.push(clean);
    }
    let mut result = json!({"highlights":highlights,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if highlights.pop().is_none() {
            return None;
        }
        truncated = true;
        result["highlights"] = Value::Array(highlights.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

fn sanitize_inlay_hint_label(value: &Value) -> Option<String> {
    let mut label = String::new();
    let parts: Vec<&Value> = match value {
        Value::String(_) => vec![value],
        Value::Array(parts) => parts.iter().collect(),
        _ => return None,
    };
    for part in parts {
        let value = if let Some(value) = part.as_str() {
            value
        } else {
            part.get("value")?.as_str()?
        };
        if value.chars().any(char::is_control)
            || label.len().saturating_add(value.len()) > MAX_LABEL_CHARS
        {
            return None;
        }
        label.push_str(value);
    }
    (!label.is_empty()).then_some(label)
}

fn sanitize_inlay_hints(
    value: &Value,
    request: &JavaSemanticRequest,
    document: &OpenDocument,
) -> Option<Value> {
    let raw_hints: &[Value] = if value.is_null() {
        &[]
    } else {
        value.as_array()?.as_slice()
    };
    let requested = request.range.as_ref()?;
    let mut hints = Vec::new();
    let mut truncated = raw_hints.len() > MAX_INLAY_HINTS;
    'hint: for raw in raw_hints.iter().take(MAX_INLAY_HINTS) {
        let Some(position) = raw.get("position") else {
            truncated = true;
            continue;
        };
        let Some(line) = position.get("line").and_then(Value::as_u64) else {
            truncated = true;
            continue;
        };
        let Some(character) = position.get("character").and_then(Value::as_u64) else {
            truncated = true;
            continue;
        };
        if line > 100_000 || character > 1_000_000 {
            truncated = true;
            continue;
        }
        let Ok(line_index) = usize::try_from(line) else {
            truncated = true;
            continue;
        };
        let Some(boundaries) = document.line_utf16_boundaries.get(line_index) else {
            truncated = true;
            continue;
        };
        if character > u32::MAX as u64
            || boundaries.binary_search(&(character as u32)).is_err()
            || (line, character)
                < (
                    requested.start.line as u64,
                    requested.start.character as u64,
                )
            || (line, character) > (requested.end.line as u64, requested.end.character as u64)
        {
            truncated = true;
            continue;
        }
        let Some(label) = raw.get("label").and_then(sanitize_inlay_hint_label) else {
            truncated = true;
            continue;
        };
        let kind = match raw.get("kind").and_then(Value::as_u64) {
            None => None,
            Some(1) => Some("type"),
            Some(2) => Some("parameter"),
            Some(_) => {
                truncated = true;
                continue;
            }
        };
        let mut hint = json!({"position":{"line":line,"character":character},"label":label});
        if let Some(kind) = kind {
            hint["kind"] = Value::String(kind.to_string());
        }
        for key in ["paddingLeft", "paddingRight"] {
            if let Some(padding) = raw.get(key) {
                let Some(padding) = padding.as_bool() else {
                    truncated = true;
                    continue 'hint;
                };
                hint[key] = Value::Bool(padding);
            }
        }
        hints.push(hint);
    }
    let mut result = json!({"hints":hints,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if hints.pop().is_none() {
            return None;
        }
        truncated = true;
        result["hints"] = Value::Array(hints.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

fn ranges_overlap(left: &Value, right: &Value) -> bool {
    let (Some((left_start, left_end)), Some((right_start, right_end))) =
        (range_tuple(left), range_tuple(right))
    else {
        return true;
    };
    let left_empty = left_start == left_end;
    let right_empty = right_start == right_end;
    match (left_empty, right_empty) {
        (true, true) => left_start == right_start,
        (true, false) => right_start <= left_start && left_start <= right_end,
        (false, true) => left_start <= right_start && right_start <= left_end,
        (false, false) => left_start < right_end && right_start < left_end,
    }
}

fn sanitize_code_action_edits(
    value: &Value,
    request: &JavaSemanticRequest,
    open_documents: &HashMap<String, OpenDocument>,
) -> Option<(Vec<Value>, Vec<Value>)> {
    let edit = value.as_object()?;
    let has_changes = edit.contains_key("changes");
    let has_document_changes = edit.contains_key("documentChanges");
    if has_changes == has_document_changes {
        return None;
    }
    let requested_document = open_documents.get(&request.document.path)?;
    if requested_document.uri != request.document.uri
        || requested_document.version != request.document.version
        || requested_document.language_id != "java"
    {
        return None;
    }
    let mut edits_by_path: BTreeMap<String, (OpenDocument, Vec<Value>)> = BTreeMap::new();
    let mut total_edits = 0usize;
    let mut append = |uri: &str, version: Option<i64>, raw_edits: &Value| -> Option<()> {
        let document = open_documents
            .values()
            .find(|document| document.uri == uri && document.language_id == "java")?;
        if version.is_some_and(|version| version != document.version)
            || !raw_edits.is_array()
            || edits_by_path.contains_key(&document.path)
        {
            return None;
        }
        let raw_edits = raw_edits.as_array()?;
        if raw_edits.is_empty()
            || total_edits.saturating_add(raw_edits.len()) > MAX_CODE_ACTION_EDITS
        {
            return None;
        }
        let mut sanitized = Vec::with_capacity(raw_edits.len());
        for raw in raw_edits {
            let edit = sanitize_text_edit(raw)?;
            if !response_edit_is_in_document(&edit, document)
                || sanitized.iter().any(|previous: &Value| {
                    match (previous.get("range"), edit.get("range")) {
                        (Some(previous), Some(current)) => ranges_overlap(previous, current),
                        _ => true,
                    }
                })
            {
                return None;
            }
            sanitized.push(edit);
        }
        total_edits = total_edits.saturating_add(sanitized.len());
        sanitized.sort_by_key(|edit| range_tuple(edit.get("range").unwrap()).unwrap().0);
        edits_by_path.insert(document.path.clone(), (document.clone(), sanitized));
        Some(())
    };
    if has_changes {
        let changes = edit.get("changes")?.as_object()?;
        if changes.is_empty() || changes.len() > MAX_RENAME_DOCUMENTS {
            return None;
        }
        for (uri, edits) in changes {
            append(uri, None, edits)?;
        }
    } else {
        let changes = edit.get("documentChanges")?.as_array()?;
        if changes.is_empty() || changes.len() > MAX_RENAME_DOCUMENTS {
            return None;
        }
        for change in changes {
            let text_document = change.get("textDocument")?.as_object()?;
            let uri = text_document.get("uri")?.as_str()?;
            let version = match text_document.get("version") {
                Some(Value::Null) | None => None,
                Some(version) => Some(version.as_i64()?),
            };
            append(uri, version, change.get("edits")?)?;
        }
    }
    if edits_by_path.is_empty() {
        return None;
    }
    let mut primary_edits = Vec::new();
    let mut additional_edits = Vec::new();
    for (path, (document, edits)) in edits_by_path {
        if path == request.document.path {
            if document.uri != request.document.uri || document.version != request.document.version
            {
                return None;
            }
            primary_edits.extend(edits);
        } else {
            additional_edits.extend(edits.into_iter().map(|edit| {
                json!({
                    "document":{
                        "workspaceId":request.workspace_id,
                        "path":document.path,
                        "uri":document.uri,
                        "version":document.version
                    },
                    "edit":edit
                })
            }));
        }
    }
    Some((primary_edits, additional_edits))
}

fn sanitize_single_document_code_action_edits(
    value: &Value,
    request: &JavaSemanticRequest,
) -> Option<Vec<Value>> {
    let edit = value.as_object()?;
    let has_changes = edit.contains_key("changes");
    let has_document_changes = edit.contains_key("documentChanges");
    if has_changes == has_document_changes {
        return None;
    }
    let mut edits: Vec<Value> = Vec::new();
    let mut append = |raw_edits: &Value| -> Option<()> {
        let raw_edits = raw_edits.as_array()?;
        if raw_edits.is_empty()
            || edits.len().saturating_add(raw_edits.len()) > MAX_CODE_ACTION_EDITS
        {
            return None;
        }
        for raw in raw_edits {
            let edit = sanitize_text_edit(raw)?;
            if edits.iter().any(
                |previous| match (previous.get("range"), edit.get("range")) {
                    (Some(previous), Some(current)) => ranges_overlap(previous, current),
                    _ => true,
                },
            ) {
                return None;
            }
            edits.push(edit);
        }
        Some(())
    };
    if has_changes {
        let changes = edit.get("changes")?.as_object()?;
        if changes.len() != 1 || !changes.contains_key(&request.document.uri) {
            return None;
        }
        append(changes.get(&request.document.uri)?)?;
    } else {
        let changes = edit.get("documentChanges")?.as_array()?;
        if changes.is_empty() || changes.len() > MAX_CODE_ACTION_EDITS {
            return None;
        }
        for change in changes {
            let text_document = change.get("textDocument")?.as_object()?;
            if text_document.get("uri")?.as_str()? != request.document.uri {
                return None;
            }
            match text_document.get("version") {
                Some(Value::Null) | None => {}
                Some(version) if version.as_i64() == Some(request.document.version) => {}
                _ => return None,
            }
            append(change.get("edits")?)?;
        }
    }
    Some(edits)
}

fn sanitize_code_action_internal(
    value: &Value,
    request: &JavaSemanticRequest,
    open_documents: Option<&HashMap<String, OpenDocument>>,
    sources: Option<&mut workspace_code_actions::Sources<'_>>,
) -> Option<Value> {
    let action = value.as_object()?;
    if action.contains_key("disabled") {
        return None;
    }
    let edit = if action.contains_key("command") {
        let command_edit = jdtls_workspace_edit_command(action)?;
        if action
            .get("edit")
            .is_some_and(|direct_edit| direct_edit != command_edit)
        {
            return None;
        }
        command_edit
    } else {
        action.get("edit")?
    };
    let title = bounded_string(action.get("title")?, MAX_LABEL_CHARS)?;
    if title.is_empty() || title.chars().any(char::is_control) {
        return None;
    }
    let kind = action.get("kind").and_then(Value::as_str);
    if kind.is_some_and(|kind| {
        !(kind == "quickfix"
            || kind.starts_with("quickfix.")
            || kind == "quickassist"
            || kind.starts_with("quickassist.")
            || kind == "refactor"
            || kind.starts_with("refactor.")
            || kind == "source"
            || kind.starts_with("source."))
    }) {
        return None;
    }
    let mut clean = if let Some(sources) = sources {
        workspace_code_actions::project(edit, request, open_documents?, sources, &title, kind)?
    } else {
        let (edits, additional_edits) = match open_documents {
            Some(open_documents) => sanitize_code_action_edits(edit, request, open_documents)?,
            None => (
                sanitize_single_document_code_action_edits(edit, request)?,
                vec![],
            ),
        };
        let mut clean = json!({"title":title,"edits":edits});
        if !additional_edits.is_empty() {
            clean["additionalEdits"] = Value::Array(additional_edits);
        }
        clean
    };
    clean["title"] = json!(title);
    if let Some(kind) = kind.and_then(|kind| bounded_string(&Value::String(kind.to_string()), 128))
    {
        clean["kind"] = Value::String(kind);
    }
    if let Some(preferred) = action.get("isPreferred").and_then(Value::as_bool) {
        clean["isPreferred"] = Value::Bool(preferred);
    }
    Some(clean)
}

fn jdtls_workspace_edit_command(action: &Map<String, Value>) -> Option<&Value> {
    let command = action.get("command")?;
    let (name, arguments) = match command {
        Value::String(name) => (name.as_str(), action.get("arguments")?.as_array()?),
        Value::Object(command) => (
            command.get("command")?.as_str()?,
            command.get("arguments")?.as_array()?,
        ),
        _ => return None,
    };
    if name != "java.apply.workspaceEdit" || arguments.len() != 1 {
        return None;
    }
    let edit = &arguments[0];
    (edit.is_object() && (edit.get("changes").is_some() || edit.get("documentChanges").is_some()))
        .then_some(edit)
}

pub(super) fn sanitize_code_action(value: &Value, request: &JavaSemanticRequest) -> Option<Value> {
    sanitize_code_action_internal(value, request, None, None)
}

pub(super) fn sanitize_code_actions(
    value: &Value,
    request: &JavaSemanticRequest,
    open_documents: &HashMap<String, OpenDocument>,
    workspace_root: Option<&Path>,
) -> Option<Value> {
    let raw_actions: &[Value] = if value.is_null() {
        &[]
    } else {
        value.as_array()?.as_slice()
    };
    let mut actions = Vec::new();
    let mut truncated = raw_actions.len() > MAX_CODE_ACTIONS;
    let mut sources = workspace_root.map(workspace_code_actions::Sources::new);
    for action in raw_actions.iter().take(MAX_CODE_ACTIONS) {
        match sanitize_code_action_internal(action, request, Some(open_documents), sources.as_mut())
        {
            Some(action) => actions.push(action),
            None => truncated = true,
        }
    }
    let mut result = json!({"actions":actions,"isTruncated":truncated});
    while serde_json::to_vec(&result)
        .map_or(true, |bytes| bytes.len() > MAX_SEMANTIC_RESPONSE_BYTES)
    {
        if actions.pop().is_none() {
            return None;
        }
        truncated = true;
        result["actions"] = Value::Array(actions.clone());
        result["isTruncated"] = Value::Bool(truncated);
    }
    Some(result)
}

fn response_edit_is_in_document(edit: &Value, document: &OpenDocument) -> bool {
    response_edit_is_in_boundaries(edit, &document.line_utf16_boundaries)
}

fn response_edit_is_in_boundaries(edit: &Value, boundaries: &[Vec<u32>]) -> bool {
    let Some((start, end)) = edit.get("range").and_then(range_tuple) else {
        return false;
    };
    let valid = |(line, character): (u64, u64)| {
        boundaries
            .get(line as usize)
            .is_some_and(|boundaries| boundaries.binary_search(&(character as u32)).is_ok())
    };
    valid(start) && valid(end) && end >= start
}

fn response_edit_is_in_requested_range(edit: &Value, range: &JavaSemanticRange) -> bool {
    let Some((start, end)) = edit.get("range").and_then(range_tuple) else {
        return false;
    };
    let selected_start = (
        u64::from(range.start.line),
        u64::from(range.start.character),
    );
    let selected_end = (u64::from(range.end.line), u64::from(range.end.character));
    start >= selected_start && end <= selected_end
}

/// A closed-file response only discovers documents to synchronize. Its edits are
/// discarded; a fresh request must be made against the complete open-document frame.
fn sanitize_rename_with_closed_documents(
    value: &Value,
    request: &JavaSemanticRequest,
    workspace_root: &Path,
    open_documents: &HashMap<String, OpenDocument>,
) -> Option<Value> {
    if value.is_null() {
        return sanitize_rename(value, request, open_documents);
    }
    let edit = value.as_object()?;
    if edit.contains_key("changes") == edit.contains_key("documentChanges") {
        return None;
    }
    let entries: Vec<(&str, Option<&Value>, &Value)> = if let Some(changes) = edit.get("changes") {
        changes
            .as_object()?
            .iter()
            .map(|(uri, edits)| (uri.as_str(), None, edits))
            .collect()
    } else {
        edit.get("documentChanges")?
            .as_array()?
            .iter()
            .map(|change| {
                // Create, Rename and Delete resource operations remain unavailable.
                let change = change.as_object()?;
                if change.contains_key("kind") {
                    return None;
                }
                let document = change.get("textDocument")?.as_object()?;
                Some((
                    document.get("uri")?.as_str()?,
                    Some(document.get("version")?),
                    change.get("edits")?,
                ))
            })
            .collect::<Option<Vec<_>>>()?
    };
    if entries.len() > MAX_RENAME_DOCUMENTS {
        return None;
    }
    let mut paths = HashSet::new();
    let mut closed = Vec::new();
    let mut total = 0usize;
    for (uri, version, edits) in entries {
        let open = open_documents
            .values()
            .find(|document| document.uri == uri && document.path.ends_with(".java"));
        let path = if let Some(document) = open {
            document.path.clone()
        } else {
            let path = workspace_symbol_path(uri, workspace_root)?;
            let (_, canonical_uri) = authorize_java_path(workspace_root, &path).ok()?;
            if canonical_uri != uri || !workspace_root.join(&path).is_file() {
                return None;
            }
            path
        };
        if !paths.insert(path.clone()) {
            return None;
        }
        let edits = edits.as_array()?;
        total = total.checked_add(edits.len())?;
        if edits.is_empty()
            || total > MAX_RENAME_EDITS
            || edits.iter().any(|edit| sanitize_text_edit(edit).is_none())
        {
            return None;
        }
        if let Some(document) = open {
            if document.uri != uri
                || version.is_some_and(|version| version.as_i64() != Some(document.version))
            {
                return None;
            }
        } else {
            // A version on a closed file cannot identify our current document.
            if version.is_some_and(|version| !version.is_null()) {
                return None;
            }
            closed.push(path);
        }
    }
    if closed.is_empty() {
        sanitize_rename(value, request, open_documents)
    } else {
        closed.sort();
        let result = json!({"documentEdits":[],"documentsToOpen":closed});
        if serde_json::to_vec(&result).ok()?.len() > MAX_SEMANTIC_RESPONSE_BYTES {
            return None;
        }
        Some(result)
    }
}

pub(super) fn sanitize_rename(
    value: &Value,
    request: &JavaSemanticRequest,
    open_documents: &HashMap<String, OpenDocument>,
) -> Option<Value> {
    if value.is_null() {
        return Some(json!({"documentEdits":[]}));
    }
    let workspace_edit = value.as_object()?;
    let has_changes = workspace_edit.contains_key("changes");
    let has_document_changes = workspace_edit.contains_key("documentChanges");
    if has_changes == has_document_changes {
        return None;
    }

    let mut edits_by_path: BTreeMap<String, (OpenDocument, Vec<Value>)> = BTreeMap::new();
    let mut total_edits = 0usize;
    let mut append = |uri: &str, version: Option<i64>, raw_edits: &Value| -> Option<()> {
        let document = open_documents
            .values()
            .find(|document| document.uri == uri && document.path.ends_with(".java"))?;
        if version.is_some_and(|version| version != document.version)
            || !raw_edits.is_array()
            || edits_by_path.contains_key(&document.path)
        {
            return None;
        }
        let raw_edits = raw_edits.as_array()?;
        if raw_edits.is_empty() || total_edits.saturating_add(raw_edits.len()) > MAX_RENAME_EDITS {
            return None;
        }
        let mut edits: Vec<Value> = Vec::with_capacity(raw_edits.len());
        for raw in raw_edits {
            let edit = sanitize_text_edit(raw)?;
            if !response_edit_is_in_document(&edit, document)
                || edits.iter().any(
                    |previous| match (previous.get("range"), edit.get("range")) {
                        (Some(previous), Some(current)) => ranges_overlap(previous, current),
                        _ => true,
                    },
                )
            {
                return None;
            }
            edits.push(edit);
        }
        total_edits = total_edits.saturating_add(edits.len());
        edits.sort_by_key(|edit| range_tuple(edit.get("range").unwrap()).unwrap().0);
        edits_by_path.insert(document.path.clone(), (document.clone(), edits));
        Some(())
    };

    if has_changes {
        let changes = workspace_edit.get("changes")?.as_object()?;
        if changes.len() > MAX_RENAME_DOCUMENTS {
            return None;
        }
        for (uri, edits) in changes {
            append(uri, None, edits)?;
        }
    } else {
        let changes = workspace_edit.get("documentChanges")?.as_array()?;
        if changes.len() > MAX_RENAME_DOCUMENTS {
            return None;
        }
        for change in changes {
            let text_document = change.get("textDocument")?.as_object()?;
            let uri = text_document.get("uri")?.as_str()?;
            // A null version names disk content, not an unsaved open document.
            let version = text_document.get("version")?.as_i64()?;
            append(uri, Some(version), change.get("edits")?)?;
        }
    }

    let document_edits = edits_by_path
        .into_values()
        .map(|(document, edits)| {
            json!({
                "document":{
                    "path":document.path,
                    "uri":document.uri,
                    "version":document.version
                },
                "edits":edits
            })
        })
        .collect::<Vec<_>>();
    if document_edits.iter().any(|document| {
        document["document"]["path"] == request.document.path
            && document["document"]["uri"] != request.document.uri
    }) {
        return None;
    }
    let result = json!({"documentEdits":document_edits});
    serde_json::to_vec(&result)
        .ok()
        .filter(|bytes| bytes.len() <= MAX_SEMANTIC_RESPONSE_BYTES)?;
    Some(result)
}

pub(super) fn sanitize_formatting(
    value: &Value,
    document: &OpenDocument,
    requested_range: Option<&JavaSemanticRange>,
) -> Option<Value> {
    const MAX_FORMATTING_EDITS: usize = 2_048;
    let raw_edits = if value.is_null() {
        &[][..]
    } else {
        value.as_array()?.as_slice()
    };
    if raw_edits.len() > MAX_FORMATTING_EDITS {
        return None;
    }
    let mut edits: Vec<Value> = Vec::with_capacity(raw_edits.len());
    for raw in raw_edits {
        let edit = sanitize_text_edit(raw)?;
        if !response_edit_is_in_document(&edit, document)
            || requested_range
                .is_some_and(|range| !response_edit_is_in_requested_range(&edit, range))
            || edits.iter().any(
                |previous| match (previous.get("range"), edit.get("range")) {
                    (Some(previous), Some(current)) => ranges_overlap(previous, current),
                    _ => true,
                },
            )
        {
            return None;
        }
        edits.push(edit);
    }
    edits.sort_by_key(|edit| range_tuple(edit.get("range").unwrap()).unwrap().0);
    let result = json!({"edits":edits});
    serde_json::to_vec(&result)
        .ok()
        .filter(|bytes| bytes.len() <= MAX_SEMANTIC_RESPONSE_BYTES)?;
    Some(result)
}

pub(super) fn sanitize_semantic_result(
    kind: SemanticKind,
    value: &Value,
    request: &JavaSemanticRequest,
    workspace_root: &Path,
    token_legend: Option<&SemanticTokenLegend>,
    open_document: Option<&OpenDocument>,
    open_documents: &HashMap<String, OpenDocument>,
) -> Option<Value> {
    if !diagnostic_uri_in_workspace(&request.document.uri, workspace_root) {
        return None;
    }
    match kind {
        SemanticKind::Completion => sanitize_completion(value, request),
        SemanticKind::Hover => sanitize_hover(value),
        SemanticKind::SignatureHelp => sanitize_signature_help(value),
        SemanticKind::DocumentSymbols => sanitize_document_symbols(value),
        SemanticKind::DocumentHighlights => sanitize_document_highlights(value),
        SemanticKind::Definitions | SemanticKind::TypeDefinitions => sanitize_implementations(value, workspace_root),
        SemanticKind::Implementations => sanitize_implementations(value, workspace_root),
        SemanticKind::References => sanitize_references(value, workspace_root),
        SemanticKind::SemanticTokens => {
            sanitize_semantic_tokens(value, token_legend?, open_document?)
        }
        SemanticKind::InlayHints => sanitize_inlay_hints(value, request, open_document?),
        SemanticKind::CodeActions => {
            sanitize_code_actions(value, request, open_documents, Some(workspace_root))
        }
        SemanticKind::Rename => {
            sanitize_rename_with_closed_documents(value, request, workspace_root, open_documents)
        }
        SemanticKind::Formatting | SemanticKind::OnTypeFormatting => sanitize_formatting(value, open_document?, None),
        SemanticKind::RangeFormatting => {
            sanitize_formatting(value, open_document?, request.range.as_ref())
        }
    }
}

fn sanitize_semantic_tokens(
    value: &Value,
    legend: &SemanticTokenLegend,
    document: &OpenDocument,
) -> Option<Value> {
    const MAX_TOKENS: usize = 20_000;
    let data = value.get("data")?.as_array()?;
    if data.len() % 5 != 0 || data.len() / 5 > MAX_TOKENS {
        return None;
    }
    let mut tokens = Vec::with_capacity(data.len() / 5);
    let (mut line, mut character, mut previous_end) = (0_u32, 0_u32, 0_u32);
    for tuple in data.chunks_exact(5) {
        let read_u32 = |value: &Value| -> Option<u32> {
            let number = value.as_u64()?;
            u32::try_from(number).ok()
        };
        let delta_line = read_u32(&tuple[0])?;
        let delta_start = read_u32(&tuple[1])?;
        let length = read_u32(&tuple[2])?;
        let token_type = read_u32(&tuple[3])? as usize;
        let modifiers = read_u32(&tuple[4])?;
        if length == 0 || token_type >= legend.token_types.len() {
            return None;
        }
        if delta_line == 0 {
            character = character.checked_add(delta_start)?;
        } else {
            line = line.checked_add(delta_line)?;
            character = delta_start;
            previous_end = 0;
        }
        let end_character = character.checked_add(length)?;
        if character < previous_end {
            return None;
        }
        let boundaries = document.line_utf16_boundaries.get(line as usize)?;
        if boundaries.binary_search(&character).is_err()
            || boundaries.binary_search(&end_character).is_err()
        {
            return None;
        }
        let token_modifiers = legend
            .token_modifiers
            .iter()
            .enumerate()
            .filter_map(|(index, modifier)| {
                (modifiers & (1_u32 << index) != 0).then(|| modifier.clone())
            })
            .collect::<Vec<_>>();
        if legend.token_modifiers.len() < 32 && modifiers >> legend.token_modifiers.len() != 0 {
            return None;
        }
        tokens.push(json!({
            "range":{"start":{"line":line,"character":character},"end":{"line":line,"character":end_character}},
            "tokenType":legend.token_types[token_type],
            "tokenModifiers":token_modifiers,
        }));
        previous_end = end_character;
    }
    let result = json!({"tokens":tokens,"isTruncated":false});
    (serde_json::to_vec(&result).ok()?.len() <= MAX_SEMANTIC_RESPONSE_BYTES).then_some(result)
}

#[cfg(test)]
mod tests {
    use super::super::contract::{
        JavaCodeActionDiagnostic, JavaCompletionTriggerContext, JavaFormattingOptions,
        JavaSemanticDocumentTarget, JavaSemanticPosition, JavaSemanticRange,
    };
    use super::super::path_policy::file_uri;
    use super::*;
    use std::fs;
    use std::process::{Command, Stdio};
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_workspace(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("ide-java-{label}-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn semantic_request_fixture() -> JavaSemanticRequest {
        JavaSemanticRequest {
            workspace_id: "workspace-test".to_string(),
            generation: 7,
            document: JavaSemanticDocumentTarget {
                path: "src/Main.java".to_string(),
                uri: "file:///workspace/src/Main.java".to_string(),
                version: 4,
            },
            position: JavaSemanticPosition {
                line: 2,
                character: 3,
            },
            request_id: "request-1".to_string(),
            cancellation_id: "cancel-1".to_string(),
            trigger: None,
            range: None,
            diagnostics: None,
            new_name: None,
            formatting_options: None,
            formatting_character: None,
            generation_selection: None,
            include_declaration: None,
        }
    }

    #[test]
    fn on_type_formatting_preserves_post_typing_position_and_refuses_mixed_contexts() {
        let mut request = semantic_request_fixture();
        request.formatting_options = Some(JavaFormattingOptions { tab_size: 4, insert_spaces: true });
        request.formatting_character = Some(";".into());
        assert_eq!(SemanticKind::OnTypeFormatting.method(), "textDocument/onTypeFormatting");
        let params = semantic_params(&request, SemanticKind::OnTypeFormatting).unwrap();
        assert_eq!(params["ch"], ";");
        assert_eq!(params["position"], json!({"line":2,"character":3}));
        assert_eq!(params["options"], json!({"tabSize":4,"insertSpaces":true}));
        assert!(semantic_params(&request, SemanticKind::Formatting).is_err());
        request.range = Some(JavaSemanticRange { start: request.position.clone(), end: request.position.clone() });
        assert!(semantic_params(&request, SemanticKind::OnTypeFormatting).is_err());
        request.range = None;
        request.formatting_character = Some("\n".into());
        assert!(semantic_params(&request, SemanticKind::OnTypeFormatting).is_ok());
        request.formatting_character = Some("ab".into());
        assert!(semantic_params(&request, SemanticKind::OnTypeFormatting).is_err());
        request.formatting_character = None;
        assert!(semantic_params(&request, SemanticKind::OnTypeFormatting).is_err());
    }

    fn rename_document_fixture() -> OpenDocument {
        OpenDocument {
            path: "src/Main.java".to_string(),
            uri: "file:///workspace/src/Main.java".to_string(),
            language_id: "java".to_string(),
            version: 4,
            text_hash: "0".repeat(64),
            line_utf16_boundaries: vec![(0..=7).collect()],
        }
    }

    #[test]
    fn semantic_pending_responses_route_out_of_order_and_late_responses_drop() {
        let pending: PendingSemanticRequests = Arc::new(Mutex::new(HashMap::new()));
        let (first_tx, first_rx) = mpsc::sync_channel(1);
        let (second_tx, second_rx) = mpsc::sync_channel(1);
        pending.lock().unwrap().insert(
            100,
            PendingSemanticRequest {
                cancellation_id: "first".to_string(),
                response_tx: first_tx,
            },
        );
        pending.lock().unwrap().insert(
            101,
            PendingSemanticRequest {
                cancellation_id: "second".to_string(),
                response_tx: second_tx,
            },
        );
        let second = json!({"jsonrpc":"2.0","id":101,"result":{"value":2}});
        let first = json!({"jsonrpc":"2.0","id":"100","result":{"value":1}});
        assert!(route_pending_response(&pending, &second));
        assert!(route_pending_response(&pending, &first));
        assert_eq!(second_rx.recv().unwrap(), second);
        assert_eq!(first_rx.recv().unwrap(), first);
        assert!(pending.lock().unwrap().is_empty());
        assert!(route_pending_response(
            &pending,
            &json!({"jsonrpc":"2.0","id":100,"result":"late"})
        ));
        assert!(!route_pending_response(
            &pending,
            &json!({"jsonrpc":"2.0","method":"window/logMessage","params":{}})
        ));
    }

    #[test]
    fn semantic_pending_concurrency_duplicate_cancel_and_cleanup_are_bounded() {
        let pending: PendingSemanticRequests = Arc::new(Mutex::new(HashMap::new()));
        let mut receivers = Vec::new();
        for index in 0..MAX_SEMANTIC_REQUESTS {
            let (tx, rx) = mpsc::sync_channel(1);
            receivers.push(rx);
            assert_eq!(
                reserve_pending_request(&pending, index as u64, format!("cancel-{index}"), tx)
                    .unwrap(),
                Ok(())
            );
        }
        let (overflow_tx, _overflow_rx) = mpsc::sync_channel(1);
        assert_eq!(
            reserve_pending_request(&pending, 99, "overflow".to_string(), overflow_tx).unwrap(),
            Err(PendingReservationError::Limit)
        );

        let mut process = Command::new("sh")
            .args(["-c", "cat >/dev/null"])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        let writer = Arc::new(Mutex::new(process.stdin.take().unwrap()));
        cancel_by_cancellation_id(&pending, &writer, "cancel-3");
        assert_eq!(
            receivers[3].recv_timeout(Duration::from_secs(1)).unwrap(),
            json!({"__cancelled":true})
        );
        assert_eq!(pending.lock().unwrap().len(), MAX_SEMANTIC_REQUESTS - 1);
        let (duplicate_tx, _duplicate_rx) = mpsc::sync_channel(1);
        assert_eq!(
            reserve_pending_request(&pending, 100, "cancel-4".to_string(), duplicate_tx).unwrap(),
            Err(PendingReservationError::DuplicateCancellationId)
        );
        cancel_all_semantic_requests(&pending, &writer);
        assert!(pending.lock().unwrap().is_empty());
        drop(writer);
        let _ = process.wait();
    }

    #[test]
    fn utf16_metadata_tracks_lines_and_rejects_surrogate_interior() {
        let lines = line_utf16_boundaries("a😀b\r\ncafé\n").unwrap();
        assert_eq!(lines, vec![vec![0, 1, 3, 4], vec![0, 1, 2, 3, 4], vec![0]]);
        assert!(lines[0].binary_search(&2).is_err());
        assert!(lines[0].binary_search(&3).is_ok());
    }

    #[test]
    fn semantic_open_document_rejects_stale_identity_version_and_position() {
        let mut request = semantic_request_fixture();
        request.position = JavaSemanticPosition {
            line: 0,
            character: 3,
        };
        let document = OpenDocument {
            path: request.document.path.clone(),
            uri: request.document.uri.clone(),
            language_id: "java".to_string(),
            version: request.document.version,
            text_hash: hash_text("a😀b"),
            line_utf16_boundaries: line_utf16_boundaries("a😀b").unwrap(),
        };
        assert!(validate_semantic_open_document(
            &document,
            &request.document.path,
            &request.document.uri,
            &request
        )
        .is_ok());
        request.position.character = 2;
        assert!(validate_semantic_open_document(
            &document,
            &request.document.path,
            &request.document.uri,
            &request
        )
        .is_err());
        request.position.character = 3;
        request.document.version += 1;
        assert!(validate_semantic_open_document(
            &document,
            &request.document.path,
            &request.document.uri,
            &request
        )
        .is_err());
        request.document.version = document.version;
        assert!(validate_semantic_open_document(
            &document,
            "src/Other.java",
            &request.document.uri,
            &request
        )
        .is_err());
    }

    #[test]
    fn semantic_methods_and_completion_triggers_are_fixed_lsp_payloads() {
        let mut request = semantic_request_fixture();
        assert_eq!(
            semantic_params(&request, SemanticKind::Hover).unwrap(),
            json!({"textDocument":{"uri":request.document.uri},"position":{"line":2,"character":3}})
        );
        request.trigger = Some(JavaCompletionTriggerContext {
            kind: "trigger-character".to_string(),
            character: Some(".".to_string()),
        });
        assert_eq!(
            semantic_params(&request, SemanticKind::Completion)
                .unwrap()
                .get("context"),
            Some(&json!({"triggerKind":2,"triggerCharacter":"."}))
        );
        request.trigger.as_mut().unwrap().character = Some("xx".to_string());
        assert!(semantic_params(&request, SemanticKind::Completion).is_err());
        request.trigger = None;
        assert_eq!(
            semantic_params(&request, SemanticKind::SignatureHelp)
                .unwrap()
                .get("context"),
            Some(&json!({"triggerKind":1,"isRetrigger":false}))
        );
        assert_eq!(
            semantic_params(&request, SemanticKind::DocumentSymbols).unwrap(),
            json!({"textDocument":{"uri":request.document.uri}})
        );
        assert_eq!(
            semantic_params(&request, SemanticKind::SemanticTokens).unwrap(),
            json!({"textDocument":{"uri":request.document.uri}})
        );
        request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 2,
                character: 3,
            },
            end: JavaSemanticPosition {
                line: 2,
                character: 7,
            },
        });
        assert_eq!(
            semantic_params(&request, SemanticKind::InlayHints).unwrap(),
            json!({"textDocument":{"uri":request.document.uri},"range":{"start":{"line":2,"character":3},"end":{"line":2,"character":7}}})
        );
        assert_eq!(SemanticKind::InlayHints.method(), "textDocument/inlayHint");
        request.range = None;
        assert_eq!(
            semantic_params(&request, SemanticKind::DocumentHighlights).unwrap(),
            json!({"textDocument":{"uri":request.document.uri},"position":{"line":2,"character":3}})
        );
        assert_eq!(
            semantic_params(&request, SemanticKind::Definitions).unwrap(),
            json!({"textDocument":{"uri":request.document.uri},"position":{"line":2,"character":3}})
        );
        request.include_declaration = Some(true);
        assert_eq!(
            semantic_params(&request, SemanticKind::References).unwrap(),
            json!({"textDocument":{"uri":request.document.uri},"position":{"line":2,"character":3},"context":{"includeDeclaration":true}})
        );
        assert_eq!(SemanticKind::References.method(), "textDocument/references");
        request.include_declaration = None;
        assert!(semantic_params(&request, SemanticKind::References).is_err());
        request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 2,
                character: 3,
            },
            end: JavaSemanticPosition {
                line: 2,
                character: 7,
            },
        });
        request.diagnostics = Some(vec![JavaCodeActionDiagnostic {
            range: JavaSemanticRange {
                start: JavaSemanticPosition {
                    line: 2,
                    character: 2,
                },
                end: JavaSemanticPosition {
                    line: 2,
                    character: 6,
                },
            },
            severity: 1,
            message: "List cannot be resolved".to_string(),
            source: Some("jdt.ls".to_string()),
            code: Some(json!("16777218")),
        }]);
        assert_eq!(
            semantic_params(&request, SemanticKind::CodeActions).unwrap(),
            json!({
                "textDocument":{"uri":request.document.uri},
                    "range":{"start":{"line":2,"character":3},"end":{"line":2,"character":7}},
                "context":{"diagnostics":[{
                    "range":{"start":{"line":2,"character":2},"end":{"line":2,"character":6}},
                    "severity":1,"message":"List cannot be resolved","source":"jdt.ls","code":"16777218"
                }],"only":["quickfix","quickassist","refactor","source"]}
            })
        );
        let mut rename_request = semantic_request_fixture();
        rename_request.new_name = Some("renamed".to_string());
        assert_eq!(
            semantic_params(&rename_request, SemanticKind::Rename).unwrap(),
            json!({
                "textDocument":{"uri":"file:///workspace/src/Main.java"},
                "position":{"line":2,"character":3},
                "newName":"renamed"
            })
        );
        assert_eq!(SemanticKind::Completion.method(), "textDocument/completion");
        assert_eq!(SemanticKind::Hover.method(), "textDocument/hover");
        assert_eq!(
            SemanticKind::Definitions.method(),
            "textDocument/definition"
        );
        assert_eq!(
            SemanticKind::TypeDefinitions.method(),
            "textDocument/typeDefinition"
        );
        assert_eq!(
            semantic_params(&semantic_request_fixture(), SemanticKind::TypeDefinitions).unwrap(),
            semantic_params(&semantic_request_fixture(), SemanticKind::Definitions).unwrap()
        );
        assert_eq!(
            SemanticKind::SignatureHelp.method(),
            "textDocument/signatureHelp"
        );
        assert_eq!(
            SemanticKind::DocumentSymbols.method(),
            "textDocument/documentSymbol"
        );
        assert_eq!(
            SemanticKind::CodeActions.method(),
            "textDocument/codeAction"
        );
        assert_eq!(SemanticKind::Rename.method(), "textDocument/rename");
        let mut formatting_request = semantic_request_fixture();
        formatting_request.position = JavaSemanticPosition {
            line: 0,
            character: 0,
        };
        formatting_request.formatting_options = Some(JavaFormattingOptions {
            tab_size: 2,
            insert_spaces: false,
        });
        assert_eq!(
            semantic_params(&formatting_request, SemanticKind::Formatting).unwrap(),
            json!({
                "textDocument":{"uri":"file:///workspace/src/Main.java"},
                "options":{"tabSize":2,"insertSpaces":false}
            })
        );
        assert_eq!(SemanticKind::Formatting.method(), "textDocument/formatting");
        formatting_request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 0,
                character: 0,
            },
            end: JavaSemanticPosition {
                line: 0,
                character: 7,
            },
        });
        formatting_request.position = formatting_request.range.as_ref().unwrap().start.clone();
        assert_eq!(
            semantic_params(&formatting_request, SemanticKind::RangeFormatting).unwrap(),
            json!({
                "textDocument":{"uri":"file:///workspace/src/Main.java"},
                "range":{"start":{"line":0,"character":0},"end":{"line":0,"character":7}},
                "options":{"tabSize":2,"insertSpaces":false}
            })
        );
        assert_eq!(
            SemanticKind::RangeFormatting.method(),
            "textDocument/rangeFormatting"
        );
        formatting_request.range = None;
        formatting_request.position = JavaSemanticPosition {
            line: 0,
            character: 0,
        };
        formatting_request
            .formatting_options
            .as_mut()
            .unwrap()
            .tab_size = 0;
        assert!(semantic_params(&formatting_request, SemanticKind::Formatting).is_err());
        formatting_request
            .formatting_options
            .as_mut()
            .unwrap()
            .tab_size = 4;
        assert!(semantic_params(&formatting_request, SemanticKind::Hover).is_err());
        assert_eq!(
            SemanticKind::DocumentHighlights.method(),
            "textDocument/documentHighlight"
        );
    }

    #[test]
    fn formatting_accepts_only_bounded_nonoverlapping_edits_in_the_open_document() {
        let document = rename_document_fixture();
        let valid = json!([
            {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"class"},
            {"range":{"start":{"line":0,"character":4},"end":{"line":0,"character":7}},"newText":"Main"}
        ]);
        let sanitized = sanitize_formatting(&valid, &document, None).unwrap();
        assert_eq!(sanitized.pointer("/edits/0/newText"), Some(&json!("class")));
        assert_eq!(sanitized.pointer("/edits/1/newText"), Some(&json!("Main")));
        assert_eq!(
            sanitize_formatting(&Value::Null, &document, None).unwrap(),
            json!({"edits":[]})
        );
        assert!(sanitize_formatting(
            &json!([
                {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":5}},"newText":"class"},
                {"range":{"start":{"line":0,"character":4},"end":{"line":0,"character":7}},"newText":"Main"}
            ]),
            &document,
            None
        )
        .is_none());
        assert!(sanitize_formatting(
            &json!([{"range":{"start":{"line":0,"character":0},"end":{"line":1,"character":0}},"newText":"bad"}]),
            &document,
            None
        )
        .is_none());
        assert!(sanitize_formatting(
            &json!([{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"x"}]),
            &document,
            None
        )
        .is_some());

        let selected_range = JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 0,
                character: 4,
            },
            end: JavaSemanticPosition {
                line: 0,
                character: 7,
            },
        };
        assert!(sanitize_formatting(&valid, &document, Some(&selected_range)).is_none());
        assert!(sanitize_formatting(
            &json!([{"range":{"start":{"line":0,"character":4},"end":{"line":0,"character":7}},"newText":"Main"}]),
            &document,
            Some(&selected_range)
        )
        .is_some());
    }

    #[test]
    fn code_actions_allow_versioned_edits_in_open_java_documents() {
        let request = semantic_request_fixture();
        let boundaries = || (0..8).map(|_| (0..=64).collect()).collect();
        let main = OpenDocument {
            path: "src/Main.java".to_string(),
            uri: request.document.uri.clone(),
            language_id: "java".to_string(),
            version: request.document.version,
            text_hash: "0".repeat(64),
            line_utf16_boundaries: boundaries(),
        };
        let companion = OpenDocument {
            path: "src/Other.java".to_string(),
            uri: "file:///workspace/src/Other.java".to_string(),
            language_id: "java".to_string(),
            version: 2,
            text_hash: "1".repeat(64),
            line_utf16_boundaries: boundaries(),
        };
        let open_documents = HashMap::from([
            (main.path.clone(), main),
            (companion.path.clone(), companion),
        ]);
        let result = sanitize_code_actions(&json!([
            {
                "title":"Import java.util.List","kind":"quickfix","isPreferred":true,
                "edit":{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"import java.util.List;\n"},
                    {"range":{"start":{"line":4,"character":2},"end":{"line":4,"character":6}},"newText":"List"}
                ]}]}
            },
            {
                "title":"Use pattern matching","kind":"quickassist",
                "edit":{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":5,"character":4},"end":{"line":5,"character":18}},"newText":"if (value instanceof String text)"}
                ]}]}
            },
            {
                "title":"Extract to method","kind":"refactor.extract",
                "edit":{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":5,"character":4},"end":{"line":5,"character":18}},"newText":"extracted()"}
                ]}]}
            },
            {
                "title":"Generate getter and setter","kind":"source.generate.accessors",
                "edit":{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":7,"character":0},"end":{"line":7,"character":0}},"newText":"    public String getName() { return name; }\n    public void setName(String name) { this.name = name; }\n"}
                ]}]}
            },
            {
                "title":"Sort members","kind":"source.sortMembers",
                "edit":{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":2,"character":0},"end":{"line":4,"character":0}},"newText":"    private int count;\n    private String name;\n"}
                ]}]}
            },
            {
                "title":"Import from command edit","kind":"quickfix",
                "command":{"command":"java.apply.workspaceEdit","arguments":[{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"import java.util.Set;\n"}
                ]}]}]}
            },
            {
                "title":"Replace from legacy command","kind":"quickfix",
                "command":"java.apply.workspaceEdit",
                "arguments":[{"changes":{"file:///workspace/src/Main.java":[
                    {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"// migrated\n"}
                ]}}]
            },
            {
                "title":"Conflicting edit and command","kind":"quickfix",
                "command":{"command":"java.apply.workspaceEdit","arguments":[{"changes":{"file:///workspace/src/Main.java":[
                    {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"command edit"}
                ]}}]},
                "edit":{"changes":{"file:///workspace/src/Main.java":[
                    {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"different edit"}
                ]}}
            },
            {
                "title":"Command-backed generated members","kind":"source.generate.constructors",
                "command":{"command":"java.action.generateConstructorsPrompt"},
                "edit":{"documentChanges":[{"textDocument":{"uri":request.document.uri,"version":request.document.version},"edits":[
                    {"range":{"start":{"line":7,"character":0},"end":{"line":7,"character":0}},"newText":"constructor"}
                ]}]}
            },
            {
                "title":"Cross-file edit","kind":"quickfix",
                "edit":{"changes":{"file:///workspace/src/Other.java":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"bad"}]}}
            },
            {
                "title":"Closed-file edit","kind":"quickfix",
                "edit":{"changes":{"file:///workspace/src/Closed.java":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"bad"}]}}
            },
            {
                "title":"Stale companion edit","kind":"quickfix",
                "edit":{"documentChanges":[{"textDocument":{"uri":"file:///workspace/src/Other.java","version":1},"edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"stale"}]}]}
            },
            {
                "title":"Out-of-document companion edit","kind":"quickfix",
                "edit":{"changes":{"file:///workspace/src/Other.java":[{"range":{"start":{"line":8,"character":0},"end":{"line":8,"character":0}},"newText":"bad"}]}}
            },
            {
                "title":"Server command","kind":"quickfix","command":{"command":"do.thing"},
                "edit":{"changes":{"file:///workspace/src/Main.java":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"x"}]}}
            },
            {
                "title":"Overlapping edits","kind":"quickfix",
                "edit":{"changes":{"file:///workspace/src/Main.java":[
                    {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"x"},
                    {"range":{"start":{"line":0,"character":2},"end":{"line":0,"character":4}},"newText":"y"}
                ]}}
            },
            {
                "title":"Stale edit","kind":"quickfix",
                "edit":{"documentChanges":[{"textDocument":{"uri":"file:///workspace/src/Main.java","version":3},"edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"x"}]}]}
            }
        ]), &request, &open_documents, None).unwrap();
        assert_eq!(
            result.pointer("/actions/0/title"),
            Some(&json!("Import java.util.List"))
        );
        assert_eq!(
            result.pointer("/actions/1/kind"),
            Some(&json!("quickassist"))
        );
        assert_eq!(result["isTruncated"], true);
        assert_eq!(result["actions"].as_array().unwrap().len(), 8);
        assert_eq!(
            result.pointer("/actions/2/kind"),
            Some(&json!("refactor.extract"))
        );
        assert_eq!(
            result.pointer("/actions/3/kind"),
            Some(&json!("source.generate.accessors"))
        );
        assert_eq!(
            result.pointer("/actions/4/kind"),
            Some(&json!("source.sortMembers"))
        );
        assert_eq!(
            result.pointer("/actions/5/title"),
            Some(&json!("Import from command edit"))
        );
        assert_eq!(
            result.pointer("/actions/5/edits/0/newText"),
            Some(&json!("import java.util.Set;\n"))
        );
        assert_eq!(
            result.pointer("/actions/6/title"),
            Some(&json!("Replace from legacy command"))
        );
        assert_eq!(
            result.pointer("/actions/6/edits/0/newText"),
            Some(&json!("// migrated\n"))
        );
        assert_eq!(
            result.pointer("/actions/7/title"),
            Some(&json!("Cross-file edit"))
        );
        assert_eq!(
            result.pointer("/actions/7/additionalEdits/0/document/path"),
            Some(&json!("src/Other.java"))
        );
        let encoded = serde_json::to_string(&result).unwrap();
        assert!(!encoded.contains("SECRET"));
        assert!(!encoded.contains("java.apply.workspaceEdit"));
        assert!(!encoded.contains("java.action.generateConstructorsPrompt"));
        assert_eq!(
            sanitize_code_actions(&Value::Null, &request, &open_documents, None).unwrap(),
            json!({"actions":[],"isTruncated":false})
        );
    }

    #[test]
    fn closed_rename_discards_edits_until_a_fresh_synchronized_request() {
        let root = temporary_workspace("closed-rename");
        fs::create_dir_all(root.join("src with spaces")).unwrap();
        let path = "src with spaces/Use.java";
        fs::write(root.join(path), "class Use {}").unwrap();
        let uri = file_uri(&root.join(path));
        let request = semantic_request_fixture();
        let text_edits = json!([{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":5}},"newText":"other"}]);
        let result = json!({"documentChanges":[{"textDocument":{"uri":uri,"version":null},"edits":text_edits}]});
        let discovered =
            sanitize_rename_with_closed_documents(&result, &request, &root, &HashMap::new())
                .unwrap();
        assert_eq!(
            discovered,
            json!({"documentEdits":[],"documentsToOpen":[path]})
        );
        let mut document = rename_document_fixture();
        document.path = path.to_string();
        document.uri = uri.clone();
        document.version = 1;
        document.line_utf16_boundaries = vec![(0..=12).collect()];
        let documents = HashMap::from([(path.to_string(), document)]);
        let fresh_result = json!({"documentChanges":[{"textDocument":{"uri":uri,"version":1},"edits":text_edits}]});
        let fresh =
            sanitize_rename_with_closed_documents(&fresh_result, &request, &root, &documents)
                .unwrap();
        assert!(fresh.get("documentsToOpen").is_none());
        assert_eq!(fresh["documentEdits"][0]["document"]["version"], 1);
        assert_eq!(fs::read_to_string(root.join(path)).unwrap(), "class Use {}");
        for invalid in [
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":1},"edits":text_edits}]}),
            json!({"documentChanges":[{"kind":"delete","uri":uri}]}),
            json!({"changes":{(uri.clone()):[]}}),
            json!({"changes":{(uri.clone()):text_edits},"documentChanges":[]}),
            json!({"changes":{(uri.clone()):text_edits,(file_uri(&root.join("Missing.java"))):text_edits}}),
        ] {
            assert!(sanitize_rename_with_closed_documents(
                &invalid,
                &request,
                &root,
                &HashMap::new()
            )
            .is_none());
        }
        let foreign = temporary_workspace("foreign-rename");
        fs::write(foreign.join("Other.java"), "class Other {}").unwrap();
        let outside = json!({"changes":{(file_uri(&foreign.join("Other.java"))):text_edits}});
        assert!(
            sanitize_rename_with_closed_documents(&outside, &request, &root, &HashMap::new())
                .is_none()
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(foreign.join("Other.java"), root.join("Escape.java"))
                .unwrap();
            let escaped = json!({"changes":{(file_uri(&root.join("Escape.java"))):text_edits}});
            assert!(sanitize_rename_with_closed_documents(
                &escaped,
                &request,
                &root,
                &HashMap::new()
            )
            .is_none());
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(foreign).unwrap();
    }

    #[test]
    fn rename_accepts_only_bounded_edits_for_open_versioned_java_documents() {
        let mut request = semantic_request_fixture();
        request.new_name = Some("bar".to_string());
        let document = rename_document_fixture();
        let companion = OpenDocument {
            path: "src/Use.java".to_string(),
            uri: "file:///workspace/src/Use.java".to_string(),
            language_id: "java".to_string(),
            version: 2,
            text_hash: "1".repeat(64),
            line_utf16_boundaries: vec![(0..=7).collect()],
        };
        let open_documents = HashMap::from([
            (document.path.clone(), document.clone()),
            (companion.path.clone(), companion.clone()),
        ]);
        let valid = json!({"changes":{
            "file:///workspace/src/Main.java":[
                {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"},
                {"range":{"start":{"line":0,"character":4},"end":{"line":0,"character":7}},"newText":"bar"}
            ],
            "file:///workspace/src/Use.java":[
                {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}
            ]
        }});
        let result = sanitize_rename(&valid, &request, &open_documents).unwrap();
        assert_eq!(result["documentEdits"].as_array().unwrap().len(), 2);
        assert_eq!(
            result.pointer("/documentEdits/0/document/path"),
            Some(&json!("src/Main.java"))
        );
        assert_eq!(
            result.pointer("/documentEdits/1/document/path"),
            Some(&json!("src/Use.java"))
        );
        assert_eq!(
            result.pointer("/documentEdits/1/document/version"),
            Some(&json!(2))
        );
        assert_eq!(
            sanitize_rename(&Value::Null, &request, &open_documents).unwrap(),
            json!({"documentEdits":[]})
        );
        let versioned_document_changes = json!({"documentChanges":[
            {"textDocument":{"uri":"file:///workspace/src/Main.java","version":4},"edits":[
                {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}
            ]},
            {"textDocument":{"uri":"file:///workspace/src/Use.java","version":2},"edits":[
                {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}
            ]}
        ]});
        let result =
            sanitize_rename(&versioned_document_changes, &request, &open_documents).unwrap();
        assert_eq!(result["documentEdits"].as_array().unwrap().len(), 2);
        assert!(sanitize_rename(
            &json!({"changes":{
                "file:///workspace/src/Other.java":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}]
            }}),
            &request,
            &open_documents
        )
        .is_none());
        assert!(sanitize_rename(
            &json!({"documentChanges":[{"textDocument":{"uri":"file:///workspace/src/Main.java","version":3},"edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}]}]}),
            &request,
            &open_documents
        )
        .is_none());
        assert!(sanitize_rename(
            &json!({"changes":{"file:///workspace/src/Main.java":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":8}},"newText":"bar"}]}}),
            &request,
            &open_documents
        )
        .is_none());
        assert!(sanitize_rename(
            &json!({"changes":{"file:///workspace/src/Main.java":[
                {"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":4}},"newText":"bar"},
                {"range":{"start":{"line":0,"character":3},"end":{"line":0,"character":7}},"newText":"bar"}
            ]}}),
            &request,
            &open_documents
        )
        .is_none());
        assert!(sanitize_rename(
            &json!({"documentChanges":[{"textDocument":{"uri":"file:///workspace/src/Use.java","version":null},"edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}]}]}),
            &request,
            &open_documents
        )
        .is_none());
    }

    #[test]
    fn completion_variants_kinds_edits_and_caps_are_sanitized() {
        let request = semantic_request_fixture();
        assert_eq!(
            sanitize_completion(&Value::Null, &request).unwrap(),
            json!({"items":[],"isIncomplete":false})
        );
        let raw_items = (0..MAX_COMPLETION_ITEMS + 5)
        .map(|index| {
            json!({
                "label":format!("item-{index}"),"kind":2,"detail":"detail",
                "documentation":{"kind":"markdown","value":"**untrusted**"},
                "textEdit":{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}},"newText":"x"},
                "additionalTextEdits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"import x;"}],
                "commitCharacters":[".","invalid"],
                "command":{"command":"workspace.applyEdit","arguments":["SOURCE SECRET"]}
            })
        })
        .collect::<Vec<_>>();
        let result =
            sanitize_completion(&json!({"isIncomplete":false,"items":raw_items}), &request)
                .unwrap();
        assert_eq!(
            result["items"].as_array().unwrap().len(),
            MAX_COMPLETION_ITEMS
        );
        assert_eq!(result["isIncomplete"], true);
        assert_eq!(result.pointer("/items/0/kind"), Some(&json!("method")));
        assert_eq!(
            result.pointer("/items/0/additionalTextEdits/0/document/uri"),
            Some(&json!(request.document.uri))
        );
        assert!(result.pointer("/items/0/command").is_none());
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("SOURCE SECRET"));
        assert!(sanitize_completion(&json!({"items":"bad"}), &request).is_none());
    }

    #[test]
    fn hover_and_signature_content_ranges_and_active_indices_are_bounded() {
        let hover = sanitize_hover(&json!({
            "contents":["plain",{"kind":"markdown","value":"# untrusted"}],
            "range":{"start":{"line":1,"character":2},"end":{"line":1,"character":4}}
        }))
        .unwrap();
        assert_eq!(
            hover.pointer("/contents/0/format"),
            Some(&json!("plaintext"))
        );
        assert_eq!(
            hover.pointer("/contents/1/format"),
            Some(&json!("markdown"))
        );
        assert!(hover.get("range").is_some());
        let capped_hover = sanitize_hover(&json!({
            "contents":"x".repeat(MAX_SEMANTIC_STRING_CHARS + 1)
        }))
        .unwrap();
        assert_eq!(capped_hover["isTruncated"], true);
        assert_eq!(
            capped_hover
                .pointer("/contents/0/value")
                .unwrap()
                .as_str()
                .unwrap()
                .chars()
                .count(),
            MAX_SEMANTIC_STRING_CHARS
        );
        assert!(sanitize_hover(&json!({
            "contents":"x",
            "range":{"start":{"line":2,"character":0},"end":{"line":1,"character":0}}
        }))
        .is_none());

        let signature = sanitize_signature_help(&json!({
            "signatures":[{
                "label":"call(String)",
                "documentation":"docs",
                "parameters":[{"label":[5,11],"documentation":{"kind":"markdown","value":"p"}}],
                "activeParameter":9
            }],
            "activeSignature":9,
            "activeParameter":9
        }))
        .unwrap();
        assert!(signature.get("activeSignature").is_none());
        assert!(signature.get("activeParameter").is_none());
        assert!(signature.pointer("/signatures/0/activeParameter").is_none());
        assert_eq!(
            signature.pointer("/signatures/0/parameters/0/label"),
            Some(&json!({"start":5,"end":11}))
        );
        let capped_signatures = sanitize_signature_help(&json!({
            "signatures":(0..MAX_SIGNATURES + 1)
                .map(|index| json!({"label":format!("f{index}()"),"parameters":[]}))
                .collect::<Vec<_>>()
        }))
        .unwrap();
        assert_eq!(capped_signatures["isTruncated"], true);
        assert_eq!(
            capped_signatures["signatures"].as_array().unwrap().len(),
            MAX_SIGNATURES
        );
    }

    #[test]
    fn document_symbols_are_hierarchical_bounded_and_source_free() {
        let result = sanitize_document_symbols(&json!([
            {
                "name":"Main","kind":5,
                "range":{"start":{"line":0,"character":0},"end":{"line":8,"character":1}},
                "selectionRange":{"start":{"line":0,"character":13},"end":{"line":0,"character":17}},
                "children":[{
                    "name":"run","kind":6,"detail":"void run()","tags":[1],
                    "range":{"start":{"line":2,"character":2},"end":{"line":4,"character":3}},
                    "selectionRange":{"start":{"line":2,"character":7},"end":{"line":2,"character":10}}
                }],
                "command":{"command":"workspace.applyEdit","arguments":["SOURCE SECRET"]}
            },
            {
                "name":"outside","kind":6,
                "range":{"start":{"line":9,"character":0},"end":{"line":9,"character":1}},
                "selectionRange":{"start":{"line":10,"character":0},"end":{"line":10,"character":1}}
            }
        ]))
        .unwrap();
        assert_eq!(result.pointer("/symbols/0/kind"), Some(&json!("class")));
        assert_eq!(
            result.pointer("/symbols/0/children/0/kind"),
            Some(&json!("method"))
        );
        assert_eq!(
            result.pointer("/symbols/0/children/0/tags"),
            Some(&json!([1]))
        );
        assert_eq!(result["isTruncated"], true);
        assert_eq!(result["symbols"].as_array().unwrap().len(), 1);
        let encoded = serde_json::to_string(&result).unwrap();
        assert!(!encoded.contains("command"));
        assert!(!encoded.contains("SOURCE SECRET"));
        assert!(sanitize_document_symbols(&json!([
            {
                "name":"bad","kind":5,
                "range":{"start":{"line":2,"character":0},"end":{"line":1,"character":0}},
                "selectionRange":{"start":{"line":2,"character":0},"end":{"line":2,"character":1}}
            }
        ]))
        .is_some_and(|symbols| symbols["symbols"].as_array().unwrap().is_empty()));
        assert!(sanitize_document_symbols(&json!({"unexpected":[]})).is_none());
    }

    #[test]
    fn workspace_symbols_are_bounded_and_confined_to_java_files_in_the_workspace() {
        let root = temporary_workspace("workspace-symbols");
        let source = root.join("src/main/java/example/Order.java");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "package example; class Order {}\n").unwrap();
        let non_java = root.join("src/main/java/example/Order.txt");
        fs::write(&non_java, "not Java\n").unwrap();
        let outside = temporary_workspace("workspace-symbols-outside").join("Secret.java");
        fs::write(&outside, "class Secret {}\n").unwrap();
        let valid = json!({
            "name":"Order","kind":5,"containerName":"example",
            "location":{"uri":file_uri(&source),"range":{"start":{"line":0,"character":24},"end":{"line":0,"character":29}}}
        });
        let result = sanitize_workspace_symbols(
            &json!([
                valid,
                {"name":"Secret","kind":5,"location":{"uri":file_uri(&outside),"range":{"start":{"line":0,"character":6},"end":{"line":0,"character":12}}}},
                {"name":"NotJava","kind":5,"location":{"uri":file_uri(&non_java),"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}}}},
                {"name":"UnknownKind","kind":99,"location":{"uri":file_uri(&source),"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}}}}
            ]),
            &root,
        )
        .unwrap();
        assert_eq!(result["symbols"].as_array().unwrap().len(), 1);
        assert_eq!(result.pointer("/symbols/0/name"), Some(&json!("Order")));
        assert_eq!(
            result.pointer("/symbols/0/path"),
            Some(&json!("src/main/java/example/Order.java"))
        );
        assert_eq!(result.pointer("/symbols/0/kind"), Some(&json!("class")));
        assert_eq!(result["isTruncated"], true);
        let encoded = serde_json::to_string(&result).unwrap();
        assert!(!encoded.contains("Secret.java"));
        assert!(!encoded.contains(&root.to_string_lossy().to_string()));

        let many = (0..MAX_WORKSPACE_SYMBOLS + 1)
            .map(|_| {
                json!({"name":"Order","kind":5,"location":{"uri":file_uri(&source),"range":{"start":{"line":0,"character":24},"end":{"line":0,"character":29}}}})
            })
            .collect::<Vec<_>>();
        let capped = sanitize_workspace_symbols(&json!(many), &root).unwrap();
        assert_eq!(
            capped["symbols"].as_array().unwrap().len(),
            MAX_WORKSPACE_SYMBOLS
        );
        assert_eq!(capped["isTruncated"], true);
        assert_eq!(
            sanitize_workspace_symbols(&Value::Null, &root).unwrap(),
            json!({"symbols":[],"isTruncated":false})
        );

        assert_eq!(
            validate_workspace_symbol_query("  Order  ").unwrap(),
            "Order"
        );
        assert!(validate_workspace_symbol_query(" \n ").is_err());
        assert!(validate_workspace_symbol_query(&"x".repeat(257)).is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside.parent().unwrap());
    }

    #[test]
    fn call_hierarchy_is_bounded_deduplicated_and_confined_to_workspace_java_files() {
        let root = temporary_workspace("call-hierarchy");
        let service = root.join("src/main/java/example/Service.java");
        let caller = root.join("src/main/java/example/Caller.java");
        fs::create_dir_all(service.parent().unwrap()).unwrap();
        fs::write(
            &service,
            "package example; class Service { void run() {} }\n",
        )
        .unwrap();
        fs::write(
            &caller,
            "package example; class Caller { void call() {} }\n",
        )
        .unwrap();
        let method = |name: &str, path: &Path, start: u64, end: u64| {
            json!({
                "name":name,"kind":6,"detail":"void run()","uri":file_uri(path),
                "range":{"start":{"line":1,"character":0},"end":{"line":1,"character":80}},
                "selectionRange":{"start":{"line":1,"character":start},"end":{"line":1,"character":end}}
            })
        };
        let prepared = vec![method("run", &service, 20, 23)];
        let call_site = json!({
            "start":{"line":0,"character":42},"end":{"line":0,"character":45}
        });
        let caller_item = method("call", &caller, 37, 41);
        let incoming = sanitize_call_hierarchy(
            "incoming",
            &prepared,
            &[json!([{"from":caller_item,"fromRanges":[call_site.clone(),call_site.clone()]}])],
            false,
            &root,
        )
        .unwrap();
        assert_eq!(incoming.pointer("/entries/0/name"), Some(&json!("call")));
        assert_eq!(
            incoming.pointer("/entries/0/location/path"),
            Some(&json!("src/main/java/example/Caller.java"))
        );
        assert_eq!(
            incoming.pointer("/entries/0/callSites/0/range"),
            Some(&call_site)
        );
        assert_eq!(
            incoming
                .pointer("/entries/0/callSites")
                .and_then(Value::as_array)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(incoming["isTruncated"], false);

        let outgoing = sanitize_call_hierarchy(
            "outgoing",
            &prepared,
            &[json!([{"to":method("call", &caller, 37, 41),"fromRanges":[call_site]}])],
            false,
            &root,
        )
        .unwrap();
        assert_eq!(
            outgoing.pointer("/entries/0/location/path"),
            Some(&json!("src/main/java/example/Caller.java"))
        );
        assert_eq!(
            outgoing.pointer("/entries/0/callSites/0/path"),
            Some(&json!("src/main/java/example/Service.java"))
        );

        let outside = temporary_workspace("call-hierarchy-outside").join("Outside.java");
        fs::write(&outside, "class Outside {}\n").unwrap();
        let external = sanitize_call_hierarchy(
            "incoming",
            &prepared,
            &[json!([{"from":method("outside", &outside, 0, 7),"fromRanges":[call_site]}])],
            false,
            &root,
        )
        .unwrap();
        assert_eq!(external["entries"].as_array().unwrap().len(), 0);
        assert_eq!(external["isTruncated"], true);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside.parent().unwrap());
    }

    #[test]
    fn implementations_are_bounded_and_confined_to_workspace_java_files() {
        let root = temporary_workspace("implementations");
        let source = root.join("src/main/java/example/ServiceImpl.java");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "class ServiceImpl {}\n").unwrap();
        let outside = temporary_workspace("implementations-outside").join("Secret.java");
        fs::write(&outside, "class Secret {}\n").unwrap();
        let valid_uri = format!("file://{}", source.display());
        let outside_uri = format!("file://{}", outside.display());
        let result = sanitize_implementations(
            &json!([
                {
                    "targetUri":valid_uri,
                    "targetRange":{"start":{"line":8,"character":2},"end":{"line":8,"character":30}},
                    "targetSelectionRange":{"start":{"line":8,"character":13},"end":{"line":8,"character":25}}
                },
                {
                    "uri":outside_uri,
                    "range":{"start":{"line":0,"character":0},"end":{"line":0,"character":6}}
                },
                {
                    "uri":"file:///workspace/src/Bad.txt",
                    "range":{"start":{"line":0,"character":0},"end":{"line":0,"character":6}}
                }
            ]),
            &root,
        )
        .unwrap();
        assert_eq!(result["locations"].as_array().unwrap().len(), 1);
        assert_eq!(
            result["locations"][0]["path"],
            "src/main/java/example/ServiceImpl.java"
        );
        assert_eq!(result["locations"][0]["range"]["start"]["character"], 13);
        assert_eq!(result["isTruncated"], true);

        let link = sanitize_implementations(
            &json!({
                "targetUri":valid_uri,
                "targetRange":{"start":{"line":8,"character":2},"end":{"line":8,"character":30}},
                "targetSelectionRange":{"start":{"line":8,"character":13},"end":{"line":8,"character":25}}
            }),
            &root,
        )
        .unwrap();
        assert_eq!(link["locations"].as_array().unwrap().len(), 1);
        assert_eq!(link["isTruncated"], false);
    }

    #[test]
    fn references_are_bounded_and_confined_to_workspace_java_files() {
        let root = temporary_workspace("references");
        let source = root.join("src/main/java/example/Consumer.java");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "class Consumer {}\n").unwrap();
        let outside = temporary_workspace("references-outside").join("Secret.java");
        fs::write(&outside, "class Secret {}\n").unwrap();
        let result = sanitize_references(
            &json!([
                {"uri":file_uri(&source),"range":{"start":{"line":12,"character":3},"end":{"line":12,"character":15}}},
                {"uri":file_uri(&outside),"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":6}}},
                {"uri":"file:///workspace/src/Bad.txt","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":6}}}
            ]),
            &root,
        )
        .unwrap();
        assert_eq!(result["locations"].as_array().unwrap().len(), 1);
        assert_eq!(
            result["locations"][0]["path"],
            "src/main/java/example/Consumer.java"
        );
        assert_eq!(result["locations"][0]["range"]["start"]["character"], 3);
        assert_eq!(result["isTruncated"], true);

        let many = (0..MAX_WORKSPACE_SYMBOLS + 1)
            .map(|_| {
                json!({"uri":file_uri(&source),"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}}})
            })
            .collect::<Vec<_>>();
        let capped = sanitize_references(&json!(many), &root).unwrap();
        assert_eq!(
            capped["locations"].as_array().unwrap().len(),
            MAX_WORKSPACE_SYMBOLS
        );
        assert_eq!(capped["isTruncated"], true);
        assert_eq!(
            sanitize_references(&Value::Null, &root).unwrap(),
            json!({"locations":[],"isTruncated":false})
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside.parent().unwrap());
    }

    #[test]
    fn document_highlights_map_kinds_and_bound_occurrences() {
        let result = sanitize_document_highlights(&json!([
            {"range":{"start":{"line":0,"character":1},"end":{"line":0,"character":4}},"kind":1},
            {"range":{"start":{"line":2,"character":3},"end":{"line":2,"character":6}},"kind":2},
            {"range":{"start":{"line":4,"character":5},"end":{"line":4,"character":8}},"kind":3},
            {"range":{"start":{"line":5,"character":5},"end":{"line":5,"character":8}},"kind":9},
            {"range":{"start":{"line":6,"character":0},"end":{"line":5,"character":0}}}
        ]))
        .unwrap();
        assert_eq!(result["highlights"].as_array().unwrap().len(), 3);
        assert_eq!(result.pointer("/highlights/0/kind"), Some(&json!("text")));
        assert_eq!(result.pointer("/highlights/1/kind"), Some(&json!("read")));
        assert_eq!(result.pointer("/highlights/2/kind"), Some(&json!("write")));
        assert_eq!(result["isTruncated"], true);
        let many = json!((0..MAX_DOCUMENT_HIGHLIGHTS + 1)
            .map(|line| json!({"range":{"start":{"line":line,"character":0},"end":{"line":line,"character":1}}}))
            .collect::<Vec<_>>());
        let capped = sanitize_document_highlights(&many).unwrap();
        assert_eq!(
            capped["highlights"].as_array().unwrap().len(),
            MAX_DOCUMENT_HIGHLIGHTS
        );
        assert_eq!(capped["isTruncated"], true);
        assert_eq!(
            sanitize_document_highlights(&Value::Null).unwrap(),
            json!({"highlights":[],"isTruncated":false})
        );
    }

    #[test]
    fn inlay_hints_are_bounded_plain_text_and_confined_to_the_requested_range() {
        let document = OpenDocument {
            path: "src/Main.java".to_string(),
            uri: "file:///workspace/src/Main.java".to_string(),
            language_id: "java".to_string(),
            version: 4,
            text_hash: hash_text("class Main {}"),
            line_utf16_boundaries: line_utf16_boundaries("class Main {}").unwrap(),
        };
        let mut request = semantic_request_fixture();
        request.range = Some(JavaSemanticRange {
            start: JavaSemanticPosition {
                line: 0,
                character: 0,
            },
            end: JavaSemanticPosition {
                line: 0,
                character: 12,
            },
        });
        let result = sanitize_inlay_hints(
            &json!([
                {"position":{"line":0,"character":6},"label":[{"value":"name"},{"value":":"}],"kind":2,"paddingRight":true,"tooltip":"untrusted"},
                {"position":{"line":0,"character":13},"label":"outside","kind":1},
                {"position":{"line":0,"character":2},"label":"bad\nlabel","kind":1}
            ]),
            &request,
            &document,
        )
        .unwrap();
        assert_eq!(
            result,
            json!({"hints":[{"position":{"line":0,"character":6},"label":"name:","kind":"parameter","paddingRight":true}],"isTruncated":true})
        );
        assert_eq!(
            sanitize_inlay_hints(&Value::Null, &request, &document).unwrap(),
            json!({"hints":[],"isTruncated":false})
        );
    }

    #[test]
    fn semantic_tokens_decode_against_the_negotiated_legend_and_utf16_document() {
        let document = OpenDocument {
            path: "src/Main.java".to_string(),
            uri: "file:///workspace/src/Main.java".to_string(),
            language_id: "java".to_string(),
            version: 4,
            text_hash: hash_text("class Main {}"),
            line_utf16_boundaries: line_utf16_boundaries("class Main {}").unwrap(),
        };
        let legend = SemanticTokenLegend {
            token_types: vec!["class".to_string()],
            token_modifiers: vec!["declaration".to_string()],
        };
        let result =
            sanitize_semantic_tokens(&json!({"data":[0,6,4,0,1]}), &legend, &document).unwrap();
        assert_eq!(
            result,
            json!({"tokens":[{"range":{"start":{"line":0,"character":6},"end":{"line":0,"character":10}},"tokenType":"class","tokenModifiers":["declaration"]}],"isTruncated":false})
        );
        assert!(
            sanitize_semantic_tokens(&json!({"data":[0,6,4,1,0]}), &legend, &document).is_none()
        );
        assert!(
            sanitize_semantic_tokens(&json!({"data":[0,12,2,0,0]}), &legend, &document).is_none()
        );
        assert!(
            sanitize_semantic_tokens(&json!({"data":[0,6,4,0,2]}), &legend, &document).is_none()
        );
        assert!(sanitize_semantic_tokens(&json!({"data":[0,6,4,0]}), &legend, &document).is_none());
    }

    #[test]
    fn semantic_provider_errors_never_include_provider_message_or_source() {
        let request = semantic_request_fixture();
        let mut response = native_response(&request, Some("test".to_string()));
        response = semantic_failure(
            response,
            "provider-error",
            "Java semantic provider returned an error",
            false,
        );
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(!serialized.contains("class Secret"));
        assert!(serialized.contains("provider-error"));
    }

    #[test]
    fn document_limits_and_errors_never_echo_source_text() {
        let secret = "PRIVATE_SOURCE_TOKEN";
        let document = JavaLanguageDocument {
            workspace_id: "workspace".to_string(),
            generation: 1,
            path: "Main.java".to_string(),
            uri: "file:///Main.java".to_string(),
            version: 0,
            language_id: Some("java".to_string()),
            text: Some(format!("{secret}{}", "x".repeat(MAX_DOCUMENT_BYTES))),
        };
        let error = require_document_text(&document).unwrap_err();
        assert!(!error.contains(secret));
        assert_eq!(hash_text(secret).len(), 64);
    }
}
