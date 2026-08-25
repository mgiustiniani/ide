//! Capability DTOs and strict provider-neutral language-kernel policy.

use std::collections::{BTreeMap, HashSet};

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
const MAX_METHOD_STRING_BYTES: usize = 256;
const DIAGNOSTICS_V2_METHOD: &str = "diagnostics.v2";
const DIAGNOSTICS_V2_STABILITY: &str = "additive-api-0.2";
const DIAGNOSTICS_V2_FEATURES: [&str; 8] = [
    "requestCorrelation",
    "semanticLease",
    "savedDiskAuthority",
    "immutableEditorOverlay",
    "exactUtf16Ranges",
    "structuredReadiness",
    "compilerAttestation",
    "boundedResponse",
];
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
const DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY: [&str; 2] = ["saved-disk", "immutable-editor-overlay"];
const DIAGNOSTIC_RANGE_CAPABILITY_VOCABULARY: [&str; 1] = ["exact-utf16-or-explicit-partial"];
const DIAGNOSTICS_V2_SNAPSHOT_MODES: [&str; 2] = ["immutable-editor-overlay", "saved-disk"];
const DIAGNOSTICS_V2_RANGE_CAPABILITY: &str = "exact-utf16-or-explicit-partial";
const DIAGNOSTICS_V2_BACKEND: &str = "typescript-compiler-exact-v1";

pub(super) const GENERAL_REFACTORING_OPERATIONS: [&str; 6] = [
    "rename-class",
    "rename-member",
    "rename-local-variable",
    "move-class",
    "change-method-signature",
    "safe-delete",
];
const GENERAL_REFACTORING_METHODS: [&str; 4] = [
    "java.refactor.preview",
    "java.refactor.apply",
    "java.refactor.rollback",
    "java.refactor.discard",
];
const GENERAL_REFACTORING_UNAVAILABLE: &str =
    "RefactorKit general Java refactoring is unavailable. The daemon did not advertise the general-refactoring operation set.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefactorKitCapabilities {
    pub(super) api: &'static str,
    pub(super) api_version: String,
    pub(super) provider: &'static str,
    pub(super) provider_version: Option<String>,
    pub(super) java_import_external_class: ExternalImportCapability,
    pub(super) general_refactoring: GeneralRefactoringCapability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) methods: Option<Vec<MethodCapability>>,
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
pub(super) struct GeneralRefactoringCapability {
    pub(super) supported: bool,
    pub(super) operations: Vec<String>,
    pub(super) preview: bool,
    pub(super) apply: bool,
    pub(super) rollback: bool,
    pub(super) discard: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) diagnostic_snapshot_mode: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) diagnostic_range_capability: Option<Vec<String>>,
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
    pub(super) backend: String,
    pub(super) runtime: LanguageAdapterRuntime,
    pub(super) extensions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) diagnostic_snapshot_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) diagnostic_range_capability: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MethodCapability {
    pub(super) name: String,
    pub(super) stability: String,
    pub(super) requires_project: bool,
    pub(super) writes_workspace: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) features: Option<BTreeMap<String, bool>>,
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
    pub(super) general_refactoring: GeneralRefactoringCapability,
    pub(super) methods: Option<Vec<MethodCapability>>,
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
    let normalized_methods = normalize_method_capabilities(methods)?;
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
    let general_refactoring = normalize_general_refactoring(object.get("javaRefactor"), methods)?;
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

    let normalized = ManagedCapabilityMetadata {
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
        general_refactoring,
        methods: normalized_methods,
        language_kernel,
        safety,
    };
    if normalized.methods.as_ref().is_some_and(|methods| {
        methods
            .iter()
            .any(|method| method.name == DIAGNOSTICS_V2_METHOD)
    }) && !diagnostics_v2_is_authorized(&normalized)
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    Ok(normalized)
}

fn normalize_method_capabilities(
    methods: &[Value],
) -> Result<Option<Vec<MethodCapability>>, String> {
    let mut names = HashSet::with_capacity(methods.len());
    let mut has_diagnostics_v2 = false;
    for method in methods {
        let object = method
            .as_object()
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
        let name = bounded_method_string(object.get("name"))?;
        if !names.insert(name.clone()) {
            return Err(PROTOCOL_FAILED.to_string());
        }
        has_diagnostics_v2 |= name == DIAGNOSTICS_V2_METHOD;
    }

    // RefactorKit 0.6.2 and older providers predate the complete public method DTO. Their
    // operation list remains useful for the legacy import gate but must not be re-advertised as
    // richer metadata that the provider never supplied.
    if !has_diagnostics_v2 {
        return Ok(None);
    }

    methods
        .iter()
        .map(normalize_method_capability)
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

fn normalize_method_capability(value: &Value) -> Result<MethodCapability, String> {
    let object = value
        .as_object()
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    if object.len() < 4
        || object.len() > 5
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "name" | "stability" | "requiresProject" | "writesWorkspace" | "features"
            )
        })
    {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let name = bounded_method_string(object.get("name"))?;
    let stability = bounded_method_string(object.get("stability"))?;
    let requires_project = required_bool(object, "requiresProject")?;
    let writes_workspace = required_bool(object, "writesWorkspace")?;
    let features = match object.get("features") {
        None => None,
        Some(value) => Some(normalize_method_features(value)?),
    };

    if name == DIAGNOSTICS_V2_METHOD
        && (stability != DIAGNOSTICS_V2_STABILITY
            || !requires_project
            || writes_workspace
            || !diagnostics_v2_features_are_exact(features.as_ref()))
    {
        return Err(PROTOCOL_FAILED.to_string());
    }

    Ok(MethodCapability {
        name,
        stability,
        requires_project,
        writes_workspace,
        features,
    })
}

fn normalize_method_features(value: &Value) -> Result<BTreeMap<String, bool>, String> {
    let object = value
        .as_object()
        .filter(|features| !features.is_empty() && features.len() <= MAX_ITEMS)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    object
        .iter()
        .map(|(name, value)| {
            if name.trim() != name
                || name.is_empty()
                || name.len() > MAX_METHOD_STRING_BYTES
                || name.chars().any(char::is_control)
            {
                return Err(PROTOCOL_FAILED.to_string());
            }
            value
                .as_bool()
                .map(|enabled| (name.clone(), enabled))
                .ok_or_else(|| PROTOCOL_FAILED.to_string())
        })
        .collect()
}

fn bounded_method_string(value: Option<&Value>) -> Result<String, String> {
    value
        .and_then(Value::as_str)
        .filter(|value| {
            value.trim() == *value
                && !value.is_empty()
                && value.len() <= MAX_METHOD_STRING_BYTES
                && !value.chars().any(char::is_control)
        })
        .map(ToString::to_string)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())
}

fn diagnostics_v2_features_are_exact(features: Option<&BTreeMap<String, bool>>) -> bool {
    features.is_some_and(|features| {
        features.len() == DIAGNOSTICS_V2_FEATURES.len()
            && DIAGNOSTICS_V2_FEATURES
                .iter()
                .all(|feature| features.get(*feature) == Some(&true))
    })
}

pub(super) fn diagnostics_v2_is_authorized(capabilities: &ManagedCapabilityMetadata) -> bool {
    let method_authorized = capabilities.methods.as_ref().is_some_and(|methods| {
        let matches: Vec<_> = methods
            .iter()
            .filter(|method| method.name == DIAGNOSTICS_V2_METHOD)
            .collect();
        matches.len() == 1
            && matches[0].stability == DIAGNOSTICS_V2_STABILITY
            && matches[0].requires_project
            && !matches[0].writes_workspace
            && diagnostics_v2_features_are_exact(matches[0].features.as_ref())
    });
    if !capabilities.language_kernel.available || capabilities.language_kernel.reason.is_some() {
        return false;
    }
    let Some(schema) = capabilities.language_kernel.schema.as_ref() else {
        return false;
    };
    let vocabulary_authorized = strings_are_exact(
        schema.vocabulary.diagnostic_snapshot_mode.as_deref(),
        &DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY,
    ) && strings_are_exact(
        schema.vocabulary.diagnostic_range_capability.as_deref(),
        &DIAGNOSTIC_RANGE_CAPABILITY_VOCABULARY,
    );
    let diagnostics: Vec<_> = schema
        .adapters
        .iter()
        .flat_map(|adapter| &adapter.capabilities)
        .filter(|capability| {
            capability.operation == "diagnostics" && capability.backend == DIAGNOSTICS_V2_BACKEND
        })
        .collect();
    method_authorized
        && vocabulary_authorized
        && !diagnostics.is_empty()
        && diagnostics
            .iter()
            .all(|capability| diagnostics_operation_is_v2_authorized(capability))
}

pub(super) fn diagnostics_operation_is_v2_authorized(
    capability: &LanguageOperationCapability,
) -> bool {
    capability.operation == "diagnostics"
        && strings_are_exact(
            capability.diagnostic_snapshot_modes.as_deref(),
            &DIAGNOSTICS_V2_SNAPSHOT_MODES,
        )
        && capability.diagnostic_range_capability.as_deref()
            == Some(DIAGNOSTICS_V2_RANGE_CAPABILITY)
}

fn strings_are_exact(actual: Option<&[String]>, expected: &[&str]) -> bool {
    actual.is_some_and(|actual| {
        actual.len() == expected.len()
            && actual
                .iter()
                .zip(expected)
                .all(|(actual, expected)| actual == expected)
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
    if vocabulary.keys().any(|key| {
        !matches!(
            key.as_str(),
            "stability"
                | "evidence"
                | "mutationAuthority"
                | "executionMode"
                | "diagnosticSnapshotMode"
                | "diagnosticRangeCapability"
        )
    }) {
        return Err(PROTOCOL_FAILED.to_string());
    }
    let diagnostic_vocabulary = match (
        vocabulary.get("diagnosticSnapshotMode"),
        vocabulary.get("diagnosticRangeCapability"),
    ) {
        (None, None) => None,
        (Some(_), Some(_)) => {
            require_exact_vocabulary(
                vocabulary,
                "diagnosticSnapshotMode",
                &DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY,
            )?;
            require_exact_vocabulary(
                vocabulary,
                "diagnosticRangeCapability",
                &DIAGNOSTIC_RANGE_CAPABILITY_VOCABULARY,
            )?;
            Some((
                retain_vocabulary(vocabulary, "diagnosticSnapshotMode")?,
                retain_vocabulary(vocabulary, "diagnosticRangeCapability")?,
            ))
        }
        _ => return Err(PROTOCOL_FAILED.to_string()),
    };

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

        let extensions = normalize_language_extensions(adapter.get("extensions"))?;
        for extension in &extensions {
            if !owned_extensions.insert(extension.clone()) {
                return Err(PROTOCOL_FAILED.to_string());
            }
        }

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
            let diagnostic_snapshot_modes =
                normalize_diagnostic_snapshot_modes(capability.get("diagnosticSnapshotModes"))?;
            let diagnostic_range_capability =
                normalize_diagnostic_range_capability(capability.get("diagnosticRangeCapability"))?;
            if operation != "diagnostics"
                && (diagnostic_snapshot_modes.is_some() || diagnostic_range_capability.is_some())
            {
                return Err(PROTOCOL_FAILED.to_string());
            }
            if operation == "diagnostics"
                && (capability.keys().any(|key| {
                    !matches!(
                        key.as_str(),
                        "operation"
                            | "stability"
                            | "evidence"
                            | "mutationAuthority"
                            | "backend"
                            | "runtime"
                            | "extensions"
                            | "diagnosticSnapshotModes"
                            | "diagnosticRangeCapability"
                    )
                }) || diagnostic_range_capability.is_some()
                    && diagnostic_snapshot_modes.is_none()
                    || diagnostic_snapshot_modes.as_ref().is_some_and(|modes| {
                        modes.iter().any(|mode| mode == "immutable-editor-overlay")
                            && diagnostic_range_capability.as_deref()
                                != Some(DIAGNOSTICS_V2_RANGE_CAPABILITY)
                    }))
            {
                return Err(PROTOCOL_FAILED.to_string());
            }
            capabilities.push(LanguageOperationCapability {
                operation,
                stability,
                evidence,
                mutation_authority,
                backend: bounded_language_string(capability.get("backend"))?,
                runtime: normalize_language_runtime(capability.get("runtime"))?,
                extensions: normalize_language_extensions(capability.get("extensions"))?,
                diagnostic_snapshot_modes,
                diagnostic_range_capability,
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
            diagnostic_snapshot_mode: diagnostic_vocabulary
                .as_ref()
                .map(|(snapshot_modes, _)| snapshot_modes.clone()),
            diagnostic_range_capability: diagnostic_vocabulary
                .map(|(_, range_capabilities)| range_capabilities),
        },
    })
}

fn normalize_diagnostic_snapshot_modes(
    value: Option<&Value>,
) -> Result<Option<Vec<String>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let raw_modes = value
        .as_array()
        .filter(|modes| {
            !modes.is_empty() && modes.len() <= DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY.len()
        })
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let mut unique = HashSet::with_capacity(raw_modes.len());
    raw_modes
        .iter()
        .map(|mode| {
            let mode = protocol_enum(mode.as_str(), &DIAGNOSTIC_SNAPSHOT_MODE_VOCABULARY)?;
            if !unique.insert(mode) {
                return Err(PROTOCOL_FAILED.to_string());
            }
            Ok(mode.to_string())
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

fn normalize_diagnostic_range_capability(value: Option<&Value>) -> Result<Option<String>, String> {
    value
        .map(|value| {
            protocol_enum(value.as_str(), &DIAGNOSTIC_RANGE_CAPABILITY_VOCABULARY)
                .map(ToString::to_string)
        })
        .transpose()
}

pub(super) fn normalize_language_extensions(value: Option<&Value>) -> Result<Vec<String>, String> {
    let raw_extensions = value
        .and_then(Value::as_array)
        .filter(|extensions| !extensions.is_empty() && extensions.len() <= MAX_LANGUAGE_EXTENSIONS)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
    let mut unique_extensions = HashSet::with_capacity(raw_extensions.len());
    let mut extensions = Vec::with_capacity(raw_extensions.len());
    for raw_extension in raw_extensions {
        let extension = raw_extension
            .as_str()
            .filter(|value| canonical_extension(value))
            .ok_or_else(|| PROTOCOL_FAILED.to_string())?
            .to_string();
        if !unique_extensions.insert(extension.clone()) {
            return Err(PROTOCOL_FAILED.to_string());
        }
        extensions.push(extension);
    }
    extensions.sort_unstable();
    Ok(extensions)
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

/// Capability-before-offer: general refactoring is advertised only when the daemon
/// explicitly advertises the operation set and the supporting methods. Support is
/// never inferred from a version number, a generic apply button, or the import API.
pub(super) fn normalize_general_refactoring(
    value: Option<&Value>,
    methods: &[Value],
) -> Result<GeneralRefactoringCapability, String> {
    let Some(value) = value else {
        return Ok(unavailable_general_refactoring());
    };
    let object = value
        .as_object()
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    for required in GENERAL_REFACTORING_METHODS {
        if !methods
            .iter()
            .any(|method| method.get("name").and_then(Value::as_str) == Some(required))
        {
            return Err(UNAVAILABLE.to_string());
        }
    }
    let operations = object
        .get("operations")
        .and_then(Value::as_array)
        .filter(|operations| !operations.is_empty() && operations.len() <= MAX_ITEMS)
        .ok_or_else(|| UNAVAILABLE.to_string())?;
    let mut seen = HashSet::with_capacity(operations.len());
    for operation in operations {
        let name = operation
            .as_str()
            .filter(|name| {
                !name.is_empty()
                    && name.len() <= MAX_METHOD_STRING_BYTES
                    && !name.chars().any(char::is_control)
            })
            .ok_or_else(|| UNAVAILABLE.to_string())?;
        if !GENERAL_REFACTORING_OPERATIONS.contains(&name) || !seen.insert(name) {
            return Err(UNAVAILABLE.to_string());
        }
    }
    if GENERAL_REFACTORING_OPERATIONS
        .iter()
        .any(|required| !seen.contains(*required))
    {
        return Err(UNAVAILABLE.to_string());
    }
    let stability = protocol_enum(
        object.get("stability").and_then(Value::as_str),
        &["experimental", "preview", "stable"],
    )
    .map_err(|_| UNAVAILABLE.to_string())?;
    for feature in ["preview", "apply", "rollback", "discard"] {
        if object.get(feature).and_then(Value::as_bool) != Some(true) {
            return Err(UNAVAILABLE.to_string());
        }
    }
    Ok(GeneralRefactoringCapability {
        supported: true,
        operations: GENERAL_REFACTORING_OPERATIONS
            .iter()
            .map(|operation| operation.to_string())
            .collect(),
        preview: true,
        apply: true,
        rollback: true,
        discard: true,
        stability,
        reason: None,
        update_guidance: None,
    })
}

pub(super) fn unavailable_general_refactoring() -> GeneralRefactoringCapability {
    GeneralRefactoringCapability {
        supported: false,
        operations: GENERAL_REFACTORING_OPERATIONS
            .iter()
            .map(|operation| operation.to_string())
            .collect(),
        preview: false,
        apply: false,
        rollback: false,
        discard: false,
        stability: "experimental",
        reason: Some(GENERAL_REFACTORING_UNAVAILABLE.to_string()),
        update_guidance: None,
    }
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

fn retain_vocabulary(object: &Map<String, Value>, field: &str) -> Result<Vec<String>, String> {
    object
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| PROTOCOL_FAILED.to_string())?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .ok_or_else(|| PROTOCOL_FAILED.to_string())
        })
        .collect()
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
        general_refactoring: capabilities.general_refactoring,
        methods: capabilities.methods,
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
        general_refactoring: unavailable_general_refactoring(),
        methods: None,
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
        general_refactoring: unavailable_general_refactoring(),
        methods: None,
        language_kernel: unavailable_language_kernel(),
        safety: None,
    }
}
