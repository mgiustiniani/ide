//! Capability DTOs and strict provider-neutral language-kernel policy.

use std::collections::HashSet;

use serde::Serialize;
use serde_json::{Map, Value};

use super::contract::PROTOCOL_FAILED;

pub(super) const API_VERSION: &str = "0.2";
pub(super) const UNAVAILABLE: &str = "RefactorKit managed external Java import is unavailable. Update the installed RefactorKit daemon.";
pub(super) const LANGUAGE_KERNEL_UNAVAILABLE: &str =
    "RefactorKit language-kernel capability metadata is unavailable.";
const UPDATE_GUIDANCE: &str =
    "Update RefactorKit to 0.5.0-SNAPSHOT or newer with managed daemon API 0.2 support.";
const MAX_ITEMS: usize = 512;
pub(super) const MAX_LANGUAGE_ADAPTERS: usize = 64;
pub(super) const MAX_LANGUAGE_EXTENSIONS: usize = 64;
pub(super) const MAX_LANGUAGE_CAPABILITIES: usize = 512;
const MAX_LANGUAGE_STRING_BYTES: usize = 256;
const MAX_RUNTIME_TIMEOUT_MILLIS: u64 = 300_000;
pub(super) const MAX_RUNTIME_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_RUNTIME_PROCESSES: u64 = 64;
const STABILITY_VOCABULARY: [&str; 5] = [
    "stable",
    "experimental",
    "structural",
    "refused",
    "not-applicable",
];
const EVIDENCE_VOCABULARY: [&str; 6] = [
    "compiler",
    "language-server",
    "native-ast",
    "structural-parse",
    "lexical",
    "none",
];
const MUTATION_VOCABULARY: [&str; 3] = ["managed-stable", "proposal-only", "none"];
const EXECUTION_VOCABULARY: [&str; 2] = ["in-process", "external-process"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitCapabilities {
    pub(super) api: &'static str,
    pub(super) api_version: String,
    pub(super) provider: &'static str,
    pub(super) provider_version: Option<String>,
    pub(super) java_import_external_class: ExternalImportCapability,
    pub(super) language_kernel: LanguageKernelStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) safety: Option<SafetyCapabilities>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExternalImportCapability {
    pub(super) supported: bool,
    pub(super) target_directory: bool,
    pub(super) preview: bool,
    pub(super) apply: bool,
    pub(super) rollback: bool,
    pub(super) stability: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) update_guidance: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageKernelStatus {
    pub(super) available: bool,
    pub(super) schema: Option<LanguageKernelSchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reason: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageKernelSchema {
    pub(super) schema_version: u8,
    pub(super) adapters: Vec<LanguageAdapterCapability>,
    pub(super) vocabulary: LanguageKernelVocabulary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageKernelVocabulary {
    pub(super) stability: [&'static str; 5],
    pub(super) evidence: [&'static str; 6],
    pub(super) mutation_authority: [&'static str; 3],
    pub(super) execution_mode: [&'static str; 2],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageAdapterCapability {
    pub(super) language_id: String,
    pub(super) extensions: Vec<String>,
    pub(super) backend: String,
    pub(super) runtime: LanguageAdapterRuntime,
    pub(super) capabilities: Vec<LanguageOperationCapability>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageAdapterRuntime {
    pub(super) execution_mode: &'static str,
    pub(super) supports_timeout: bool,
    pub(super) supports_cancellation: bool,
    pub(super) uses_workspace_overlay: bool,
    pub(super) records_process_provenance: bool,
    pub(super) limits: LanguageAdapterResourceLimits,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageAdapterResourceLimits {
    pub(super) request_timeout_millis: Option<u64>,
    pub(super) max_input_bytes: Option<u64>,
    pub(super) max_output_bytes: Option<u64>,
    pub(super) max_processes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LanguageOperationCapability {
    pub(super) operation: String,
    pub(super) stability: &'static str,
    pub(super) evidence: &'static str,
    pub(super) mutation_authority: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SafetyCapabilities {
    pub(super) preview_before_apply: bool,
    pub(super) snapshot_validation: bool,
    pub(super) transaction_rollback: bool,
    pub(super) workspace_scoped_writes: bool,
}

#[derive(Clone)]
pub(super) struct ManagedCapabilityMetadata {
    pub(super) provider_version: String,
    pub(super) java_import_external_class: ExternalImportCapability,
    pub(super) language_kernel: LanguageKernelStatus,
    pub(super) safety: Option<SafetyCapabilities>,
}

pub(super) fn normalize_server_capabilities(
    value: &Value,
) -> Result<ManagedCapabilityMetadata, String> {
    let object = value
        .as_object()
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if object.get("apiVersion").and_then(Value::as_str) != Some(API_VERSION)
        || object.get("protocol").and_then(Value::as_str) != Some("json-rpc-2.0")
        || object.get("transport").and_then(Value::as_str) != Some("stdio")
    {
        return Err(UNAVAILABLE.to_string());
    }
    let methods = object
        .get("methods")
        .and_then(Value::as_array)
        .filter(|methods| methods.len() <= MAX_ITEMS)
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    for required in ["refactor.apply", "refactor.discard", "patch.rollback"] {
        if !methods
            .iter()
            .any(|method| method.get("name").and_then(Value::as_str) == Some(required))
        {
            return Err(UNAVAILABLE.to_string());
        }
    }
    let import = methods
        .iter()
        .find(|method| {
            method.get("name").and_then(Value::as_str) == Some("java.importExternalClass")
        })
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    let import_stability = protocol_enum(
        import.get("stability").and_then(Value::as_str),
        &["experimental", "preview", "stable"],
    )
    .map_err(|_| UNAVAILABLE.to_string())?;
    let features = import
        .get("features")
        .and_then(Value::as_object)
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    for feature in ["targetDirectory", "preview", "apply", "discard", "rollback"] {
        if features.get(feature).and_then(Value::as_bool) != Some(true) {
            return Err(UNAVAILABLE.to_string());
        }
    }
    let provider_version = object
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
        })
        .map(ToString::to_string)
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    let language_kernel = match object.get("languageKernel") {
        None | Some(Value::Null) => unavailable_language_kernel(),
        Some(value) => LanguageKernelStatus {
            available: true,
            schema: Some(normalize_language_kernel(value)?),
            reason: None,
        },
    };
    let safety = match object.get("safety") {
        None | Some(Value::Null) => None,
        Some(value) => Some(normalize_safety(value)?),
    };

    Ok(ManagedCapabilityMetadata {
        provider_version,
        java_import_external_class: ExternalImportCapability {
            supported: true,
            target_directory: true,
            preview: true,
            apply: true,
            rollback: true,
            stability: import_stability,
            reason: None,
            update_guidance: None,
        },
        language_kernel,
        safety,
    })
}

pub(super) fn normalize_language_kernel(value: &Value) -> Result<LanguageKernelSchema, String> {
    let object = value
        .as_object()
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let vocabulary = object
        .get("vocabulary")
        .and_then(Value::as_object)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    require_exact_vocabulary(vocabulary, "stability", &STABILITY_VOCABULARY)?;
    require_exact_vocabulary(vocabulary, "evidence", &EVIDENCE_VOCABULARY)?;
    require_exact_vocabulary(vocabulary, "mutationAuthority", &MUTATION_VOCABULARY)?;
    require_exact_vocabulary(vocabulary, "executionMode", &EXECUTION_VOCABULARY)?;

    let raw_adapters = object
        .get("adapters")
        .and_then(Value::as_array)
        .filter(|adapters| adapters.len() <= MAX_LANGUAGE_ADAPTERS)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let mut language_ids = HashSet::with_capacity(raw_adapters.len());
    let mut owned_extensions = HashSet::new();
    let mut adapters = Vec::with_capacity(raw_adapters.len());
    for raw_adapter in raw_adapters {
        let adapter = raw_adapter
            .as_object()
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let language_id = adapter
            .get("languageId")
            .and_then(Value::as_str)
            .filter(|value| canonical_language_id(value))
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?
            .to_string();
        if !language_ids.insert(language_id.clone()) {
            return Err(PROTOCOL_FAILED.to_string());
        }

        let raw_extensions = adapter
            .get("extensions")
            .and_then(Value::as_array)
            .filter(|extensions| {
                !extensions.is_empty() && extensions.len() <= MAX_LANGUAGE_EXTENSIONS
            })
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let mut adapter_extensions = HashSet::with_capacity(raw_extensions.len());
        let mut extensions = Vec::with_capacity(raw_extensions.len());
        for raw_extension in raw_extensions {
            let extension = raw_extension
                .as_str()
                .filter(|value| canonical_extension(value))
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?
                .to_string();
            if !adapter_extensions.insert(extension.clone())
                || !owned_extensions.insert(extension.clone())
            {
                return Err(PROTOCOL_FAILED.to_string());
            }
            extensions.push(extension);
        }
        extensions.sort_unstable();

        let backend = bounded_language_string(adapter.get("backend"))?;
        let raw_capabilities = adapter
            .get("capabilities")
            .and_then(Value::as_array)
            .filter(|capabilities| capabilities.len() <= MAX_LANGUAGE_CAPABILITIES)
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let mut operations = HashSet::with_capacity(raw_capabilities.len());
        let mut capabilities = Vec::with_capacity(raw_capabilities.len());
        for raw_capability in raw_capabilities {
            let capability = raw_capability
                .as_object()
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            let operation = bounded_language_string(capability.get("operation"))?;
            if !operations.insert(operation.clone()) {
                return Err(PROTOCOL_FAILED.to_string());
            }
            let stability = protocol_enum(
                capability.get("stability").and_then(Value::as_str),
                &STABILITY_VOCABULARY,
            )?;
            let evidence = protocol_enum(
                capability.get("evidence").and_then(Value::as_str),
                &EVIDENCE_VOCABULARY,
            )?;
            let mutation_authority = protocol_enum(
                capability.get("mutationAuthority").and_then(Value::as_str),
                &MUTATION_VOCABULARY,
            )?;
            if mutation_authority == "managed-stable"
                && (stability != "stable" || matches!(evidence, "lexical" | "none"))
            {
                return Err(PROTOCOL_FAILED.to_string());
            }
            capabilities.push(LanguageOperationCapability {
                operation,
                stability,
                evidence,
                mutation_authority,
            });
        }
        capabilities.sort_unstable_by(|left, right| left.operation.cmp(&right.operation));

        adapters.push(LanguageAdapterCapability {
            language_id,
            extensions,
            backend,
            runtime: normalize_language_runtime(adapter.get("runtime"))?,
            capabilities,
        });
    }
    adapters.sort_unstable_by(|left, right| left.language_id.cmp(&right.language_id));

    Ok(LanguageKernelSchema {
        schema_version: 1,
        adapters,
        vocabulary: LanguageKernelVocabulary {
            stability: STABILITY_VOCABULARY,
            evidence: EVIDENCE_VOCABULARY,
            mutation_authority: MUTATION_VOCABULARY,
            execution_mode: EXECUTION_VOCABULARY,
        },
    })
}

pub(super) fn normalize_language_runtime(
    value: Option<&Value>,
) -> Result<LanguageAdapterRuntime, String> {
    let object = value
        .and_then(Value::as_object)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let execution_mode = protocol_enum(
        object.get("executionMode").and_then(Value::as_str),
        &EXECUTION_VOCABULARY,
    )?;
    let supports_timeout = required_bool(object, "supportsTimeout")?;
    let supports_cancellation = required_bool(object, "supportsCancellation")?;
    let uses_workspace_overlay = required_bool(object, "usesWorkspaceOverlay")?;
    let records_process_provenance = required_bool(object, "recordsProcessProvenance")?;
    let limits_object = object
        .get("limits")
        .and_then(Value::as_object)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let limits = LanguageAdapterResourceLimits {
        request_timeout_millis: nullable_bounded_u64(
            limits_object,
            "requestTimeoutMillis",
            MAX_RUNTIME_TIMEOUT_MILLIS,
        )?,
        max_input_bytes: nullable_bounded_u64(limits_object, "maxInputBytes", MAX_RUNTIME_BYTES)?,
        max_output_bytes: nullable_bounded_u64(limits_object, "maxOutputBytes", MAX_RUNTIME_BYTES)?,
        max_processes: nullable_bounded_u64(limits_object, "maxProcesses", MAX_RUNTIME_PROCESSES)?,
    };
    if (execution_mode == "in-process" && (records_process_provenance || uses_workspace_overlay))
        || (supports_timeout && limits.request_timeout_millis.is_none())
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    Ok(LanguageAdapterRuntime {
        execution_mode,
        supports_timeout,
        supports_cancellation,
        uses_workspace_overlay,
        records_process_provenance,
        limits,
    })
}

pub(super) fn normalize_safety(value: &Value) -> Result<SafetyCapabilities, String> {
    let object = value
        .as_object()
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    Ok(SafetyCapabilities {
        preview_before_apply: required_bool(object, "previewBeforeApply")?,
        snapshot_validation: required_bool(object, "snapshotValidation")?,
        transaction_rollback: required_bool(object, "transactionRollback")?,
        workspace_scoped_writes: required_bool(object, "workspaceScopedWrites")?,
    })
}

pub(super) fn require_exact_vocabulary(
    object: &Map<String, Value>,
    field: &str,
    expected: &[&str],
) -> Result<(), String> {
    let actual = object
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if actual.len() != expected.len()
        || actual
            .iter()
            .zip(expected)
            .any(|(actual, expected)| actual.as_str() != Some(*expected))
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    Ok(())
}

pub(super) fn protocol_enum(
    value: Option<&str>,
    allowed: &'static [&'static str],
) -> Result<&'static str, String> {
    let value = value.ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    allowed
        .iter()
        .copied()
        .find(|allowed| *allowed == value)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}

pub(super) fn required_bool(object: &Map<String, Value>, field: &str) -> Result<bool, String> {
    object
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}

pub(super) fn nullable_bounded_u64(
    object: &Map<String, Value>,
    field: &str,
    max: u64,
) -> Result<Option<u64>, String> {
    match object.get(field) {
        Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|value| (1..=max).contains(value))
            .map(Some)
            .ok_or_else(|| PROTOCOL_FAILED.to_string()),
        None => Err(PROTOCOL_FAILED.to_string()),
    }
}

pub(super) fn bounded_language_string(value: Option<&Value>) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .filter(|value| {
            !value.trim().is_empty()
                && value.len() <= MAX_LANGUAGE_STRING_BYTES
                && !value.chars().any(char::is_control)
        })
        .map(ToString::to_string)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}

pub(super) fn canonical_language_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

pub(super) fn canonical_extension(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=16).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes[1..].iter().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(*byte, b'+' | b'_' | b'-')
        })
}

pub(super) fn unavailable_language_kernel() -> LanguageKernelStatus {
    LanguageKernelStatus {
        available: false,
        schema: None,
        reason: Some(LANGUAGE_KERNEL_UNAVAILABLE),
    }
}

pub(super) fn available_managed_capabilities(
    capabilities: ManagedCapabilityMetadata,
) -> RefactorKitCapabilities {
    RefactorKitCapabilities {
        api: "refactorkit",
        api_version: API_VERSION.to_string(),
        provider: "refactorkit",
        provider_version: Some(capabilities.provider_version),
        java_import_external_class: capabilities.java_import_external_class,
        language_kernel: capabilities.language_kernel,
        safety: capabilities.safety,
    }
}

#[cfg(test)]
pub(super) fn validate_capabilities(value: &Value) -> Result<String, String> {
    normalize_server_capabilities(value).map(|capabilities| capabilities.provider_version)
}

#[cfg(test)]
pub(super) fn available_capabilities(version: Option<String>) -> RefactorKitCapabilities {
    RefactorKitCapabilities {
        api: "refactorkit",
        api_version: API_VERSION.to_string(),
        provider: "refactorkit",
        provider_version: version,
        java_import_external_class: ExternalImportCapability {
            supported: true,
            target_directory: true,
            preview: true,
            apply: true,
            rollback: true,
            stability: "experimental",
            reason: None,
            update_guidance: None,
        },
        language_kernel: unavailable_language_kernel(),
        safety: None,
    }
}

pub(super) fn unavailable_capabilities() -> RefactorKitCapabilities {
    RefactorKitCapabilities {
        api: "refactorkit",
        api_version: "unknown".to_string(),
        provider: "refactorkit",
        provider_version: None,
        java_import_external_class: ExternalImportCapability {
            supported: false,
            target_directory: false,
            preview: false,
            apply: false,
            rollback: false,
            stability: "experimental",
            reason: Some(UNAVAILABLE.to_string()),
            update_guidance: Some(UPDATE_GUIDANCE.to_string()),
        },
        language_kernel: unavailable_language_kernel(),
        safety: None,
    }
}
