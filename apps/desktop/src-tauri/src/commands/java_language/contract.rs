//! Stable serialized command request, response, status, and event contracts.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JavaLanguageCapabilities {
    pub document_sync: bool,
    pub diagnostics: bool,
    pub completion: bool,
    pub hover: bool,
    pub definition: bool,
    pub type_definition: bool,
    pub references: bool,
    pub document_symbols: bool,
    pub document_highlights: bool,
    pub implementation: bool,
    pub call_hierarchy: bool,
    pub workspace_symbols: bool,
    pub semantic_tokens: bool,
    pub inlay_hints: bool,
    pub rename: bool,
    pub code_actions: bool,
    pub formatting: bool,
    pub range_formatting: bool,
    pub on_type_formatting_triggers: Vec<String>,
    pub signature_help: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticTokenLegend {
    pub token_types: Vec<String>,
    pub token_modifiers: Vec<String>,
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
    pub server_jdk_home: Option<String>,
    pub project_jdk_home: Option<String>,
    pub project_jdk_version: Option<String>,
    pub gradle_import_enabled: bool,
    pub gradle_settings_configured: bool,
    pub project_path: Option<String>,
    pub maven_repository: Option<String>,
    pub active_maven_profiles: Vec<String>,
    pub inactive_maven_profiles: Vec<String>,
    pub java_formatter_profile: Option<JavaLanguageFormatterProfile>,
    pub capabilities: Option<JavaLanguageCapabilities>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaLanguageSessionRequest {
    pub workspace_id: String,
    pub generation: Option<u64>,
    pub project_jdk_home: Option<String>,
    #[serde(default)]
    pub server_jdk_home: Option<String>,
    pub gradle_import_enabled: Option<bool>,
    pub project_path: Option<String>,
    pub maven_repository: Option<String>,
    pub active_maven_profiles: Option<Vec<String>>,
    pub inactive_maven_profiles: Option<Vec<String>>,
    #[serde(default)]
    pub gradle: Option<JavaLanguageGradleSettings>,
    #[serde(default)]
    pub java_formatter_profile: Option<JavaLanguageFormatterProfile>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaLanguageFormatterProfile {
    pub path: String,
    pub profile_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaLanguageGradleSettings {
    pub executable: String,
    pub user_home: String,
    #[serde(default)]
    pub gradle_runtime_home: Option<String>,
    pub project_properties: BTreeMap<String, String>,
}

impl JavaLanguageGradleSettings {
    pub(crate) fn valid(&self) -> bool {
        fn absolute(path: &str) -> bool {
            path.len() <= 4096 && !path.contains('\0') && std::path::Path::new(path).is_absolute()
        }
        absolute(&self.executable)
            && (self.user_home.is_empty() || absolute(&self.user_home))
            && self.gradle_runtime_home.as_deref().is_none_or(|home| home.is_empty() || absolute(home))
            && self.project_properties.len() <= 64
            && self.project_properties.iter().all(|(key, value)| {
                key.len() <= 128
                    && key.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
                    && key.bytes().all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
                    && value.len() <= 1024
                    && !value.contains('\0')
            })
    }
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
pub struct JavaLanguageWorkspaceFile {
    pub workspace_id: String,
    pub generation: u64,
    pub path: String,
    pub uri: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaSemanticDocumentTarget {
    pub path: String,
    pub uri: String,
    pub version: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaSemanticPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaSemanticRange {
    pub start: JavaSemanticPosition,
    pub end: JavaSemanticPosition,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaCodeActionDiagnostic {
    pub range: JavaSemanticRange,
    pub severity: u8,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Value>,
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
    #[serde(default)]
    pub range: Option<JavaSemanticRange>,
    #[serde(default)]
    pub diagnostics: Option<Vec<JavaCodeActionDiagnostic>>,
    #[serde(default)]
    pub new_name: Option<String>,
    #[serde(default)]
    pub formatting_options: Option<JavaFormattingOptions>,
    #[serde(default)]
    pub formatting_character: Option<String>,
    #[serde(default)]
    pub generation_selection: Option<JavaCodeActionGenerationSelection>,
    #[serde(default)]
    pub include_declaration: Option<bool>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JavaCallHierarchyDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaCallHierarchyRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub document: JavaSemanticDocumentTarget,
    pub position: JavaSemanticPosition,
    pub request_id: String,
    pub cancellation_id: String,
    pub direction: JavaCallHierarchyDirection,
}

impl JavaCallHierarchyRequest {
    pub fn semantic_request(&self) -> JavaSemanticRequest {
        JavaSemanticRequest {
            workspace_id: self.workspace_id.clone(),
            generation: self.generation,
            document: self.document.clone(),
            position: self.position.clone(),
            request_id: self.request_id.clone(),
            cancellation_id: self.cancellation_id.clone(),
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

    pub fn direction(&self) -> &'static str {
        match self.direction {
            JavaCallHierarchyDirection::Incoming => "incoming",
            JavaCallHierarchyDirection::Outgoing => "outgoing",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JavaCodeActionGenerationKind {
    Constructors,
    HashCodeEquals,
    OverrideMethods,
    DelegateMethods,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaCodeActionGenerationSelection {
    pub kind: JavaCodeActionGenerationKind,
    pub selected_field_binding_keys: Vec<String>,
    pub selected_constructor_binding_keys: Vec<String>,
    pub selected_overridable_method_keys: Vec<String>,
    pub selected_delegate_method_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaFormattingOptions {
    pub tab_size: u8,
    pub insert_spaces: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaWorkspaceSymbolsRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub query: String,
    pub request_id: String,
    pub cancellation_id: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaWorkspaceSymbolsNativeResponse {
    pub provider: &'static str,
    pub provider_version: Option<String>,
    pub workspace_id: String,
    pub generation: u64,
    pub request_id: String,
    pub cancelled: bool,
    pub timeout: bool,
    pub error: Option<JavaSemanticNativeError>,
    pub result: Option<Value>,
}
