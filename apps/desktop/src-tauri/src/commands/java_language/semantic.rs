//! Tauri-free semantic request validation, cancellation, and result sanitization.

use std::collections::HashMap;
use std::path::Path;
use std::process::ChildStdin;
use std::sync::{mpsc, Arc, Mutex};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::contract::{
    JavaLanguageDocument, JavaSemanticNativeError, JavaSemanticNativeResponse, JavaSemanticRequest,
};
use super::path_policy::diagnostic_uri_in_workspace;
use super::protocol::{response_id, sanitize_range, write_message};
use super::support::lock;

pub(super) const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_OPEN_DOCUMENTS: usize = 128;
pub(super) const MAX_SEMANTIC_REQUESTS: usize = 16;
const MAX_SEMANTIC_ID_BYTES: usize = 256;
const MAX_SEMANTIC_RESPONSE_BYTES: usize = 256 * 1024;
pub(super) const MAX_COMPLETION_ITEMS: usize = 200;
const MAX_ADDITIONAL_EDITS: usize = 16;
const MAX_COMMIT_CHARACTERS: usize = 16;
const MAX_HOVER_CONTENTS: usize = 8;
pub(super) const MAX_SIGNATURES: usize = 32;
const MAX_PARAMETERS: usize = 64;
pub(super) const MAX_SEMANTIC_STRING_CHARS: usize = 8_192;
const MAX_LABEL_CHARS: usize = 1_024;

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
}

impl SemanticKind {
    pub(super) fn method(self) -> &'static str {
        match self {
            Self::Completion => "textDocument/completion",
            Self::Hover => "textDocument/hover",
            Self::SignatureHelp => "textDocument/signatureHelp",
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
    Ok(())
}

pub(super) fn semantic_params(
    request: &JavaSemanticRequest,
    kind: SemanticKind,
) -> Result<Value, String> {
    let mut params = json!({
        "textDocument":{"uri":request.document.uri},
        "position":{"line":request.position.line,"character":request.position.character}
    });
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

pub(super) fn sanitize_semantic_result(
    kind: SemanticKind,
    value: &Value,
    request: &JavaSemanticRequest,
    workspace_root: &Path,
) -> Option<Value> {
    if !diagnostic_uri_in_workspace(&request.document.uri, workspace_root) {
        return None;
    }
    match kind {
        SemanticKind::Completion => sanitize_completion(value, request),
        SemanticKind::Hover => sanitize_hover(value),
        SemanticKind::SignatureHelp => sanitize_signature_help(value),
    }
}

#[cfg(test)]
mod tests {
    use super::super::contract::{
        JavaCompletionTriggerContext, JavaSemanticDocumentTarget, JavaSemanticPosition,
    };
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::Duration;
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
        assert_eq!(SemanticKind::Completion.method(), "textDocument/completion");
        assert_eq!(SemanticKind::Hover.method(), "textDocument/hover");
        assert_eq!(
            SemanticKind::SignatureHelp.method(),
            "textDocument/signatureHelp"
        );
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
