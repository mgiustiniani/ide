//! Stable serialized command request, response, status, and event contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JavaLanguageCapabilities {
    pub document_sync: bool,
    pub diagnostics: bool,
    pub completion: bool,
    pub hover: bool,
    pub definition: bool,
    pub references: bool,
    pub document_symbols: bool,
    pub workspace_symbols: bool,
    pub rename: bool,
    pub code_actions: bool,
    pub formatting: bool,
    pub signature_help: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaLanguageServiceStatus {
    pub provider: &'static str,
    pub available: bool,
    pub lifecycle: String,
    pub generation: u64,
    pub workspace_id: Option<String>,
    pub workspace_root: Option<String>,
    pub jdtls_home: Option<String>,
    pub jdtls_version: Option<String>,
    pub java_executable: Option<String>,
    pub java_version: Option<String>,
    pub capabilities: Option<JavaLanguageCapabilities>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaLanguageServiceEvent {
    pub sequence: u64,
    pub generation: u64,
    pub kind: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaLanguageServiceEventBatch {
    pub events: Vec<JavaLanguageServiceEvent>,
    pub latest_sequence: u64,
    pub dropped_before_sequence: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaLanguageDocument {
    pub workspace_id: String,
    pub generation: u64,
    pub path: String,
    pub uri: String,
    pub version: i64,
    pub language_id: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaSemanticDocumentTarget {
    pub path: String,
    pub uri: String,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaSemanticPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaCompletionTriggerContext {
    pub kind: String,
    pub character: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaSemanticRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub document: JavaSemanticDocumentTarget,
    pub position: JavaSemanticPosition,
    pub request_id: String,
    pub cancellation_id: String,
    #[serde(default)]
    pub trigger: Option<JavaCompletionTriggerContext>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JavaSemanticNativeError {
    pub kind: String,
    pub summary: Option<String>,
    pub provider_code: Option<Value>,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JavaSemanticNativeResponse {
    pub provider: &'static str,
    pub provider_version: Option<String>,
    pub workspace_id: String,
    pub generation: u64,
    pub path: String,
    pub uri: String,
    pub version: i64,
    pub request_id: String,
    pub cancelled: bool,
    pub timeout: bool,
    pub error: Option<JavaSemanticNativeError>,
    pub result: Option<Value>,
}
