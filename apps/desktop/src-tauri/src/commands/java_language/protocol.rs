//! Bounded LSP frame codec and normalized inbound protocol messages/events.

use std::collections::VecDeque;
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::ChildStdin;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use super::contract::{
    JavaLanguageCapabilities, JavaLanguageServiceEvent, JavaLanguageServiceEventBatch,
};
use super::path_policy::{diagnostic_uri_in_workspace, file_uri};
use super::support::lock;

pub(super) const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 8 * 1024;
pub(super) const MAX_EVENTS: usize = 256;
pub(super) const MAX_POLL_LIMIT: usize = 100;
pub(super) const MAX_DIAGNOSTICS: usize = 200;
pub(super) const MAX_DIAGNOSTIC_MESSAGE_CHARS: usize = 4_096;
const MAX_RELATED_INFORMATION: usize = 16;
pub(super) const MAX_DIAGNOSTIC_URI_BYTES: usize = 4_096;

#[derive(Default)]
pub(super) struct EventQueue {
    pub(super) next_sequence: u64,
    pub(super) events: VecDeque<JavaLanguageServiceEvent>,
}

impl EventQueue {
    pub(super) fn push(&mut self, generation: u64, kind: impl Into<String>, payload: Value) {
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.events.push_back(JavaLanguageServiceEvent {
            sequence: self.next_sequence,
            generation,
            kind: kind.into(),
            payload,
        });
        while self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
    }

    pub(super) fn poll(&self, after: u64, limit: usize) -> JavaLanguageServiceEventBatch {
        let limit = limit.clamp(1, MAX_POLL_LIMIT);
        let events = self
            .events
            .iter()
            .filter(|event| event.sequence > after)
            .take(limit)
            .cloned()
            .collect();
        let first = self.events.front().map(|event| event.sequence);
        JavaLanguageServiceEventBatch {
            events,
            latest_sequence: self.next_sequence,
            dropped_before_sequence: first.filter(|first| after.saturating_add(1) < *first),
        }
    }
}

pub(super) fn respond_to_server_request(
    writer: &Arc<Mutex<ChildStdin>>,
    request: &Value,
) -> Result<(), String> {
    let id = request
        .get("id")
        .cloned()
        .ok_or_else(|| "JDT LS server request has no response ID".to_string())?;
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "workspace/configuration" => {
            let count = request
                .pointer("/params/items")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            Value::Array(vec![Value::Null; count])
        }
        "workspace/workspaceFolders" => Value::Array(Vec::new()),
        "window/workDoneProgress/create"
        | "client/registerCapability"
        | "client/unregisterCapability" => Value::Null,
        _ => {
            return write_message(
                writer,
                &json!({
                    "jsonrpc":"2.0",
                    "id":id,
                    "error":{"code":-32601,"message":"Method not supported by IDE Desktop"}
                }),
            );
        }
    };
    write_message(writer, &json!({"jsonrpc":"2.0","id":id,"result":result}))
}

pub(super) fn sanitize_diagnostics(
    message: Value,
    generation: u64,
    workspace_id: &str,
    workspace_root: &Path,
) -> Option<Value> {
    let params = message.get("params")?.as_object()?;
    let uri = params.get("uri")?.as_str()?;
    if uri.len() > MAX_DIAGNOSTIC_URI_BYTES || !diagnostic_uri_in_workspace(uri, workspace_root) {
        return None;
    }
    let input = params.get("diagnostics")?.as_array()?;
    let mut diagnostics = input
        .iter()
        .take(MAX_DIAGNOSTICS)
        .filter_map(|diagnostic| sanitize_diagnostic(diagnostic, workspace_root))
        .collect::<Vec<_>>();
    let mut clean_params = Map::new();
    clean_params.insert("uri".to_string(), Value::String(uri.to_string()));
    if let Some(version) = params.get("version").and_then(Value::as_i64) {
        if version >= 0 {
            clean_params.insert("version".to_string(), Value::from(version));
        }
    }
    clean_params.insert("diagnostics".to_string(), Value::Array(diagnostics.clone()));
    let mut payload = json!({
        "jsonrpc":"2.0","method":"textDocument/publishDiagnostics",
        "workspaceId":workspace_id,"generation":generation,"params":clean_params
    });
    while serde_json::to_vec(&payload).map_or(true, |bytes| bytes.len() > 64 * 1024) {
        diagnostics.pop()?;
        payload["params"]["diagnostics"] = Value::Array(diagnostics.clone());
    }
    Some(payload)
}

pub(super) fn sanitize_diagnostic(value: &Value, workspace_root: &Path) -> Option<Value> {
    let diagnostic = value.as_object()?;
    let range = sanitize_range(diagnostic.get("range")?)?;
    let message = diagnostic.get("message")?.as_str()?;
    let mut clean = Map::new();
    clean.insert("range".to_string(), range);
    clean.insert(
        "message".to_string(),
        Value::String(message.chars().take(MAX_DIAGNOSTIC_MESSAGE_CHARS).collect()),
    );
    if let Some(severity @ 1..=4) = diagnostic.get("severity").and_then(Value::as_u64) {
        clean.insert("severity".to_string(), Value::from(severity));
    }
    if let Some(code) = diagnostic.get("code") {
        if code.is_string() || code.is_i64() || code.is_u64() {
            clean.insert("code".to_string(), code.clone());
        }
    }
    if let Some(source) = diagnostic.get("source").and_then(Value::as_str) {
        clean.insert(
            "source".to_string(),
            Value::String(source.chars().take(256).collect()),
        );
    }
    if let Some(items) = diagnostic
        .get("relatedInformation")
        .and_then(Value::as_array)
    {
        let related = items
            .iter()
            .take(MAX_RELATED_INFORMATION)
            .filter_map(|item| {
                let item = item.as_object()?;
                let location = item.get("location")?.as_object()?;
                let uri = location.get("uri")?.as_str()?;
                if uri.len() > MAX_DIAGNOSTIC_URI_BYTES
                    || !diagnostic_uri_in_workspace(uri, workspace_root)
                {
                    return None;
                }
                let range = sanitize_range(location.get("range")?)?;
                let message = item.get("message")?.as_str()?;
                Some(json!({"location":{"uri":uri,"range":range},
                    "message":message.chars().take(MAX_DIAGNOSTIC_MESSAGE_CHARS).collect::<String>()}))
            })
            .collect::<Vec<_>>();
        if !related.is_empty() {
            clean.insert("relatedInformation".to_string(), Value::Array(related));
        }
    }
    Some(Value::Object(clean))
}

pub(super) fn sanitize_range(value: &Value) -> Option<Value> {
    let range = value.as_object()?;
    let position = |value: &Value| -> Option<Value> {
        let position = value.as_object()?;
        let line = position.get("line")?.as_u64()?;
        let character = position.get("character")?.as_u64()?;
        if line > u64::from(u32::MAX) || character > u64::from(u32::MAX) {
            return None;
        }
        Some(json!({"line":line,"character":character}))
    };
    Some(json!({
        "start":position(range.get("start")?)?,
        "end":position(range.get("end")?)?
    }))
}

pub(super) fn bounded_payload(value: Value) -> Value {
    match serde_json::to_vec(&value) {
        Ok(bytes) if bytes.len() <= 64 * 1024 => value,
        _ => json!({"truncated":true}),
    }
}

pub(super) fn push_event(
    events: &Arc<Mutex<EventQueue>>,
    generation: u64,
    kind: &str,
    payload: Value,
) {
    if let Ok(mut queue) = events.lock() {
        queue.push(generation, kind, payload);
    }
}

#[derive(Debug)]
pub(super) enum Incoming {
    Message(Value),
    Closed(String),
}

pub(super) fn wait_for_initialize(
    incoming: &mpsc::Receiver<Incoming>,
    expected_id: u64,
    timeout: Duration,
) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let incoming = incoming
            .recv_timeout(remaining)
            .map_err(|_| "Timed out waiting for JDT LS initialize response".to_string())?;
        match incoming {
            Incoming::Closed(detail) => return Err(detail),
            Incoming::Message(message) => {
                if message.get("id").is_none() || message.get("method").is_some() {
                    continue;
                }
                let id = response_id(&message).ok_or_else(|| {
                    "JDT LS returned a malformed JSON-RPC response ID".to_string()
                })?;
                if id != expected_id {
                    return Err(format!(
                        "JDT LS initialize response ID mismatch: expected {expected_id}, got {id}"
                    ));
                }
                if let Some(error) = message.get("error") {
                    return Err(format!(
                        "JDT LS initialize failed: {}",
                        summarize_rpc_error(error)
                    ));
                }
                return message
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "JDT LS initialize response has no result".to_string());
            }
        }
    }
}

pub(super) fn response_id(message: &Value) -> Option<u64> {
    message.get("id").and_then(|id| {
        id.as_u64()
            .or_else(|| id.as_str().and_then(|value| value.parse().ok()))
    })
}

pub(super) fn summarize_rpc_error(error: &Value) -> String {
    let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown JSON-RPC error");
    format!(
        "code {code}: {}",
        message.chars().take(300).collect::<String>()
    )
}

pub(super) fn initialize_request(id: u64, root: &Path) -> Value {
    let uri = file_uri(root);
    json!({
        "jsonrpc":"2.0",
        "id":id,
        "method":"initialize",
        "params":{
            "processId":std::process::id(),
            "clientInfo":{"name":"IDE Desktop","version":env!("CARGO_PKG_VERSION")},
            "rootUri":uri,
            "workspaceFolders":[{"uri":uri,"name":root.file_name().and_then(|v|v.to_str()).unwrap_or("workspace")}],
            "capabilities":{
                "workspace":{"workspaceFolders":true,"symbol":{"dynamicRegistration":false}},
                "window":{"workDoneProgress":true},
                "textDocument":{
                    "publishDiagnostics":{"relatedInformation":true,"versionSupport":true},
                    "completion":{"completionItem":{"snippetSupport":false}},
                    "hover":{"contentFormat":["markdown","plaintext"]},
                    "definition":{},"references":{},"documentSymbol":{},"rename":{},
                    "codeAction":{},"formatting":{},"signatureHelp":{}
                }
            }
        }
    })
}

pub(super) fn normalize_capabilities(result: &Value) -> JavaLanguageCapabilities {
    let capabilities = result.get("capabilities").unwrap_or(&Value::Null);
    JavaLanguageCapabilities {
        document_sync: true,
        diagnostics: true,
        completion: capability(capabilities, "completionProvider"),
        hover: capability(capabilities, "hoverProvider"),
        definition: capability(capabilities, "definitionProvider"),
        references: capability(capabilities, "referencesProvider"),
        document_symbols: capability(capabilities, "documentSymbolProvider"),
        workspace_symbols: capability(capabilities, "workspaceSymbolProvider"),
        rename: capability(capabilities, "renameProvider"),
        code_actions: capability(capabilities, "codeActionProvider"),
        formatting: capability(capabilities, "documentFormattingProvider"),
        signature_help: capability(capabilities, "signatureHelpProvider"),
    }
}

pub(super) fn capability(capabilities: &Value, key: &str) -> bool {
    match capabilities.get(key) {
        Some(Value::Bool(value)) => *value,
        Some(Value::Object(_)) => true,
        _ => false,
    }
}

pub(super) fn write_message(writer: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<(), String> {
    let body =
        serde_json::to_vec(value).map_err(|error| format!("Cannot encode LSP JSON: {error}"))?;
    let frame = encode_frame(&body)?;
    let mut writer = lock(writer, "JDT LS stdin")?;
    writer
        .write_all(&frame)
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Cannot write to JDT LS: {error}"))
}

pub(super) fn encode_frame(body: &[u8]) -> Result<Vec<u8>, String> {
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(format!(
            "LSP message exceeds {MAX_MESSAGE_BYTES} byte limit"
        ));
    }
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(body);
    Ok(frame)
}

pub(super) fn read_frame<R: BufRead>(
    reader: &mut R,
    max_size: usize,
) -> Result<Option<Value>, String> {
    let mut content_length = None;
    let mut header_bytes = 0usize;
    loop {
        let mut line = Vec::new();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|error| format!("Cannot read LSP header: {error}"))?;
        if read == 0 {
            return if header_bytes == 0 {
                Ok(None)
            } else {
                Err("Unexpected EOF in LSP header".to_string())
            };
        }
        header_bytes = header_bytes.saturating_add(read);
        if header_bytes > MAX_HEADER_BYTES {
            return Err("LSP header exceeds size limit".to_string());
        }
        if line == b"\r\n" || line == b"\n" {
            break;
        }
        let text = std::str::from_utf8(&line)
            .map_err(|_| "LSP header is not valid UTF-8".to_string())?
            .trim_end_matches(['\r', '\n']);
        let (name, value) = text
            .split_once(':')
            .ok_or_else(|| "Malformed LSP header".to_string())?;
        if name.eq_ignore_ascii_case("Content-Length") {
            if content_length.is_some() {
                return Err("Duplicate LSP Content-Length header".to_string());
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "Invalid LSP Content-Length header".to_string())?,
            );
        }
    }
    let length = content_length.ok_or_else(|| "Missing LSP Content-Length header".to_string())?;
    if length > max_size {
        return Err(format!("LSP message exceeds {max_size} byte limit"));
    }
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| format!("Cannot read complete LSP message: {error}"))?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| format!("Malformed LSP JSON: {error}"))
}

#[cfg(test)]
mod tests {
    use super::super::path_policy::file_uri;
    use super::*;
    use std::env;
    use std::fs;
    use std::io::{self, BufRead, Cursor, Read};
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{SystemTime, UNIX_EPOCH};

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

    struct ChunkedReader {
        data: Cursor<Vec<u8>>,
        chunk: usize,
    }

    impl Read for ChunkedReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let length = buffer.len().min(self.chunk);
            self.data.read(&mut buffer[..length])
        }
    }
    impl BufRead for ChunkedReader {
        fn fill_buf(&mut self) -> io::Result<&[u8]> {
            self.data.fill_buf()
        }
        fn consume(&mut self, amount: usize) {
            self.data.consume(amount);
        }
    }
    #[test]
    fn frame_round_trip_and_partial_reads() {
        let value = json!({"jsonrpc":"2.0","id":1,"result":{}});
        let body = serde_json::to_vec(&value).unwrap();
        let frame = encode_frame(&body).unwrap();
        let mut reader = ChunkedReader {
            data: Cursor::new(frame),
            chunk: 2,
        };
        assert_eq!(
            read_frame(&mut reader, MAX_MESSAGE_BYTES).unwrap(),
            Some(value)
        );
    }

    #[test]
    fn malformed_and_oversized_frames_are_rejected() {
        let mut malformed = Cursor::new(b"Bad header\r\n\r\n{}".to_vec());
        assert!(read_frame(&mut malformed, 100).is_err());
        let mut oversized = Cursor::new(b"Content-Length: 101\r\n\r\n".to_vec());
        assert!(read_frame(&mut oversized, 100).is_err());
        let mut duplicate =
            Cursor::new(b"Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}".to_vec());
        assert!(read_frame(&mut duplicate, 100).is_err());
    }

    #[test]
    fn initialize_response_validation_and_capability_normalization() {
        let (tx, rx) = mpsc::channel();
        tx.send(Incoming::Message(json!({"jsonrpc":"2.0","id":11,"result":{"capabilities":{"hoverProvider":true,"completionProvider":{},"renameProvider":false}}}))).unwrap();
        let result = wait_for_initialize(&rx, 11, Duration::from_secs(1)).unwrap();
        let capabilities = normalize_capabilities(&result);
        assert!(capabilities.hover && capabilities.completion);
        assert!(!capabilities.rename && !capabilities.definition);

        let (tx, rx) = mpsc::channel();
        tx.send(Incoming::Message(
            json!({"jsonrpc":"2.0","id":12,"error":{"code":-32603,"message":"failed"}}),
        ))
        .unwrap();
        assert!(wait_for_initialize(&rx, 12, Duration::from_secs(1)).is_err());
    }

    #[test]
    fn event_queue_is_bounded_sequenced_and_generation_tagged() {
        let mut queue = EventQueue::default();
        for index in 0..(MAX_EVENTS + 5) {
            queue.push(7, "test", json!({"index":index}));
        }
        assert_eq!(queue.events.len(), MAX_EVENTS);
        let batch = queue.poll(0, MAX_POLL_LIMIT);
        assert_eq!(batch.events[0].generation, 7);
        assert!(batch.dropped_before_sequence.is_some());
        assert!(batch
            .events
            .windows(2)
            .all(|pair| pair[0].sequence < pair[1].sequence));
    }

    #[test]
    fn diagnostics_are_workspace_scoped_bounded_sanitized_and_versioned() {
        let root = temp_dir("diagnostics");
        fs::write(root.join("Main.java"), "class Main {}").unwrap();
        let uri = file_uri(&root.join("Main.java"));
        let outside = file_uri(&env::temp_dir().join("Outside.java"));
        let diagnostic = json!({
            "range":{"start":{"line":0,"character":1},"end":{"line":0,"character":2}},
            "severity":1,"message":"x".repeat(MAX_DIAGNOSTIC_MESSAGE_CHARS + 20),
            "source":"jdtls",
            "relatedInformation":[
                {"location":{"uri":uri,"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":1}}},"message":"inside"},
                {"location":{"uri":outside,"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":1}}},"message":"outside"}
            ]
        });
        let payload = sanitize_diagnostics(
        json!({"params":{"uri":uri,"version":7,"diagnostics":vec![diagnostic; MAX_DIAGNOSTICS + 20]}}),
        9,
        "workspace-test",
        &root,
    )
    .unwrap();
        assert_eq!(payload["generation"], 9);
        assert_eq!(payload["workspaceId"], "workspace-test");
        assert_eq!(payload["params"]["version"], 7);
        let diagnostics = payload["params"]["diagnostics"].as_array().unwrap();
        assert!(!diagnostics.is_empty() && diagnostics.len() <= MAX_DIAGNOSTICS);
        assert_eq!(
            diagnostics[0]["message"].as_str().unwrap().chars().count(),
            MAX_DIAGNOSTIC_MESSAGE_CHARS
        );
        assert_eq!(
            diagnostics[0]["relatedInformation"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(serde_json::to_vec(&payload).unwrap().len() <= 64 * 1024);

        assert!(sanitize_diagnostics(
            json!({"params":{"uri":outside,"version":1,"diagnostics":[]}}),
            9,
            "workspace-test",
            &root,
        )
        .is_none());
        assert!(sanitize_diagnostics(
            json!({"params":{"uri":uri,"diagnostics":"malformed"}}),
            9,
            "workspace-test",
            &root,
        )
        .is_none());
        let _ = fs::remove_dir_all(root);
    }
}
