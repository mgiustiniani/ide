use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use super::contract::{
    clone_configuration, AcknowledgmentDecision, AcknowledgmentRefusalCode,
    ActivationAcknowledgment, ActivationEvidenceState, ActivationLifecycleDecision,
    ActivationLifecycleEvent, ActivationRevocationCode, BeginActivationEvidenceRequest,
    BuildPrefixDependency, BuildRecipeArgument, BuildRecipeCandidate, BuildRecipeDependencies,
    BuildRecipeInspectionRequest, BuildRecipeModule, BuildRecipeNotice, BuildRecipeProvenance,
    BuildRecipeScript, BuildRecipeWorkspace, HighlanderRuntimeDependency,
    HighlanderSourceDependency, NativeActivationCandidate, NativeActivationEvidenceHandle,
    NativeModuleConfigurationReadResult, NativeModuleScanSnapshot, UnresolvedPrerequisite,
};
use super::filesystem::{
    bind_workspace, binding_is_current, inspect_recipe, module_directory_identity,
    portable_relative_path, HIGHLANDER_SOURCE_RELATIVE_PATH, SCRIPT_RELATIVE_PATH,
};
use super::policy::{
    expected_active_handles, has_weak_evidence, retained_modules, valid_generation, valid_id,
    validate_begin_request, JS_MAX_SAFE_INTEGER,
};
use super::state::{AcceptedAuthority, Authority, PendingAuthority, Xcom2NativeActivationState};
use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current,
};
use crate::commands::xcom2_module_configuration::{
    read_configuration_at, validate_request as validate_configuration_request,
    Xcom2ModuleConfigurationReadRequest,
};
use crate::commands::xcom2_module_evidence::{
    scan_workspace_with_limits, validate_request as validate_scan_request, Xcom2ModuleScanRequest,
    REQUIRED_LIMITS,
};

pub(super) fn begin(
    state: &Xcom2NativeActivationState,
    root: &Path,
    request: BeginActivationEvidenceRequest,
) -> Result<NativeActivationCandidate, String> {
    let registry_path = match workspace_registry_path() {
        Ok(path) => path,
        Err(_) => {
            state.revoke(ActivationRevocationCode::WorkspaceActivationStarted);
            return Err("workspace-authority-unavailable".to_string());
        }
    };
    begin_with_registry(state, root, &registry_path, request)
}

pub(super) fn begin_with_registry(
    state: &Xcom2NativeActivationState,
    root: &Path,
    registry_path: &Path,
    request: BeginActivationEvidenceRequest,
) -> Result<NativeActivationCandidate, String> {
    // Every begin call is a revocation boundary, including malformed or failed attempts.
    state.revoke(ActivationRevocationCode::WorkspaceActivationStarted);
    validate_begin_request(&request)?;
    if !cfg!(target_os = "linux") {
        state.revoke(ActivationRevocationCode::ActivationAttemptFailed);
        return Err("xcom2-native-activation-unavailable".to_string());
    }
    if request.limits != REQUIRED_LIMITS {
        state.revoke(ActivationRevocationCode::CandidateInvalid);
        return Err("candidate-invalid".to_string());
    }
    let binding = bind_workspace(root)?;
    let registry_binding = current_workspace_binding_at(&binding.canonical_root, registry_path)
        .map_err(|_| "workspace-authority-unavailable".to_string())?;
    if registry_binding.workspace_id != request.workspace_id {
        state.revoke(ActivationRevocationCode::MixedActivationAttempt);
        return Err("workspace-identity-mismatch".to_string());
    }

    let receipt = mint_opaque("xcom2-attempt")?;
    let (activation_generation, inspection_generation) = {
        let mut inner = state
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let activation_generation = inner
            .next_activation_generation
            .checked_add(1)
            .filter(|generation| *generation <= JS_MAX_SAFE_INTEGER)
            .ok_or_else(|| "activation-generation-exhausted".to_string())?;
        let inspection_generation = inner
            .next_inspection_generation
            .checked_add(1)
            .filter(|generation| *generation <= JS_MAX_SAFE_INTEGER)
            .ok_or_else(|| "inspection-generation-exhausted".to_string())?;
        inner.next_activation_generation = activation_generation;
        inner.next_inspection_generation = inspection_generation;
        inner.authority = Authority::Preparing {
            activation_generation,
            activation_attempt_receipt: receipt.clone(),
        };
        (activation_generation, inspection_generation)
    };

    let attempt = build_candidate(&binding, &request, activation_generation, receipt.clone());
    let (candidate, modules) = match attempt {
        Ok(value) => value,
        Err(error) => {
            revoke_matching_preparation(state, activation_generation, &receipt);
            return Err(error);
        }
    };

    if !binding_is_current(&binding) || !current_workspace_binding_is_current(&registry_binding) {
        revoke_matching_preparation(state, activation_generation, &receipt);
        return Err("activation-attempt-stale".to_string());
    }

    let mut inner = state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !matches!(
        &inner.authority,
        Authority::Preparing {
            activation_generation: generation,
            activation_attempt_receipt,
        } if *generation == activation_generation && activation_attempt_receipt == &receipt
    ) {
        return Err("activation-attempt-stale".to_string());
    }
    inner.authority = Authority::Pending(Box::new(PendingAuthority {
        workspace_id: request.workspace_id,
        workspace_generation: request.workspace_generation,
        activation_generation,
        inspection_generation,
        activation_attempt_receipt: receipt,
        binding,
        registry_binding,
        candidate: candidate.clone(),
        modules,
    }));
    Ok(candidate)
}

fn build_candidate(
    binding: &super::filesystem::WorkspaceBinding,
    request: &BeginActivationEvidenceRequest,
    activation_generation: u64,
    receipt: String,
) -> Result<
    (
        NativeActivationCandidate,
        BTreeMap<String, super::state::RetainedModule>,
    ),
    String,
> {
    let scan_request = Xcom2ModuleScanRequest {
        workspace_id: request.workspace_id.clone(),
        workspace_generation: request.workspace_generation,
        scan_id: request.scan_id.clone(),
        scan_generation: request.scan_generation,
        limits: request.limits,
    };
    validate_scan_request(&scan_request).map_err(|_| "candidate-invalid".to_string())?;
    let scan = scan_workspace_with_limits(&binding.canonical_root, scan_request, REQUIRED_LIMITS)?;

    let configuration_request = Xcom2ModuleConfigurationReadRequest {
        workspace_id: request.workspace_id.clone(),
        workspace_generation: request.workspace_generation,
        activation_generation,
        configuration_read_id: request.configuration_read_id.clone(),
    };
    validate_configuration_request(&configuration_request)
        .map_err(|_| "candidate-invalid".to_string())?;
    let configuration = read_configuration_at(&binding.canonical_root, &configuration_request);

    let scan_roots = scan
        .observations
        .iter()
        .map(|observation| observation.module_root.clone())
        .collect::<BTreeSet<_>>();
    let configuration_roots = match &configuration.outcome {
        crate::commands::xcom2_module_configuration::Xcom2ModuleConfigurationReadOutcome::Ready {
            configuration,
        } => configuration.module_roots.iter().cloned().collect::<BTreeSet<_>>(),
        _ => BTreeSet::new(),
    };
    let all_roots = scan_roots
        .union(&configuration_roots)
        .cloned()
        .collect::<Vec<_>>();
    if all_roots.len() > 64 {
        return Err("candidate-invalid".to_string());
    }

    let mut handles = BTreeMap::new();
    for module_root in all_roots {
        handles.insert(module_root, mint_opaque("xcom2-evidence")?);
    }
    let scan_handles = scan_roots
        .iter()
        .map(|module_root| NativeActivationEvidenceHandle {
            module_root: module_root.clone(),
            evidence_handle: handles[module_root].clone(),
        })
        .collect();
    let configuration_handles = configuration_roots
        .iter()
        .map(|module_root| NativeActivationEvidenceHandle {
            module_root: module_root.clone(),
            evidence_handle: handles[module_root].clone(),
        })
        .collect();

    let native_scan = NativeModuleScanSnapshot {
        workspace_id: scan.workspace_id,
        workspace_generation: scan.workspace_generation,
        activation_generation,
        activation_attempt_receipt: receipt.clone(),
        scan_id: scan.scan_id,
        scan_generation: scan.scan_generation,
        completeness: scan.completeness,
        issues: scan.issues,
        limits: scan.limits,
        observations: scan.observations,
        evidence_handles: scan_handles,
    };
    let native_configuration = NativeModuleConfigurationReadResult {
        workspace_id: configuration.workspace_id,
        workspace_generation: configuration.workspace_generation,
        activation_generation,
        activation_attempt_receipt: receipt,
        configuration_read_id: configuration.configuration_read_id,
        evidence_handles: configuration_handles,
        outcome: clone_configuration(&configuration.outcome),
    };
    let modules = retained_modules(binding, &native_scan, &native_configuration, &handles)?;
    Ok((
        NativeActivationCandidate {
            scan: native_scan,
            configuration: native_configuration,
        },
        modules,
    ))
}

fn revoke_matching_preparation(state: &Xcom2NativeActivationState, generation: u64, receipt: &str) {
    let mut inner = state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if matches!(
        &inner.authority,
        Authority::Preparing {
            activation_generation,
            activation_attempt_receipt,
        } if *activation_generation == generation && activation_attempt_receipt == receipt
    ) {
        inner.authority = Authority::Revoked(ActivationRevocationCode::ActivationAttemptFailed);
    }
}

pub(super) fn acknowledge(
    state: &Xcom2NativeActivationState,
    acknowledgment: ActivationAcknowledgment,
) -> AcknowledgmentDecision {
    let mut inner = state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let snapshot = Xcom2NativeActivationState::state_snapshot(&inner);
    let Authority::Pending(pending) = &inner.authority else {
        return refused(AcknowledgmentRefusalCode::AuthorityUnavailable, snapshot);
    };
    if !valid_id(&acknowledgment.activation_attempt_receipt)
        || acknowledgment.evidence_handles.len() > 64
        || acknowledgment
            .evidence_handles
            .iter()
            .any(|handle| !valid_id(handle))
    {
        return refused(AcknowledgmentRefusalCode::EvaluationInvalid, snapshot);
    }
    if acknowledgment.activation_attempt_receipt != pending.activation_attempt_receipt {
        return refused(AcknowledgmentRefusalCode::StaleCorrelation, snapshot);
    }
    if pending.candidate.scan.completeness
        != crate::commands::xcom2_module_evidence::Xcom2ModuleScanCompleteness::Complete
    {
        return refused(AcknowledgmentRefusalCode::IncompleteEvidence, snapshot);
    }
    let selected = acknowledgment
        .evidence_handles
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if selected.len() != acknowledgment.evidence_handles.len() {
        return refused(AcknowledgmentRefusalCode::DuplicateEvidenceHandle, snapshot);
    }
    if selected.is_empty() {
        return refused(
            if has_weak_evidence(&pending.modules) {
                AcknowledgmentRefusalCode::NeedsConfirmation
            } else {
                AcknowledgmentRefusalCode::Inactive
            },
            snapshot,
        );
    }
    if selected
        .iter()
        .any(|handle| !pending.modules.contains_key(handle))
    {
        return refused(AcknowledgmentRefusalCode::UnknownEvidenceHandle, snapshot);
    }
    if selected.iter().any(|handle| {
        pending
            .modules
            .get(handle)
            .is_some_and(|module| !module.strong)
    }) {
        return refused(AcknowledgmentRefusalCode::WeakEvidence, snapshot);
    }
    if selected != expected_active_handles(&pending.modules) {
        return refused(AcknowledgmentRefusalCode::IncompleteEvidence, snapshot);
    }
    if !binding_is_current(&pending.binding)
        || !current_workspace_binding_is_current(&pending.registry_binding)
    {
        return refused(AcknowledgmentRefusalCode::StaleCorrelation, snapshot);
    }

    let mut modules = selected
        .iter()
        .filter_map(|handle| pending.modules.get(handle).cloned())
        .collect::<Vec<_>>();
    modules.sort_by(|left, right| left.module_root.cmp(&right.module_root));
    if modules.iter().any(|module| {
        module_directory_identity(&pending.binding, &module.module_root)
            .map_or(true, |identity| identity != module.module_identity)
    }) {
        return refused(AcknowledgmentRefusalCode::StaleCorrelation, snapshot);
    }

    let acknowledgment = ActivationAcknowledgment {
        activation_attempt_receipt: pending.activation_attempt_receipt.clone(),
        evidence_handles: modules
            .iter()
            .map(|module| module.evidence_handle.clone())
            .collect(),
    };
    let accepted = AcceptedAuthority {
        workspace_id: pending.workspace_id.clone(),
        workspace_generation: pending.workspace_generation,
        activation_generation: pending.activation_generation,
        inspection_generation: pending.inspection_generation,
        activation_attempt_receipt: pending.activation_attempt_receipt.clone(),
        binding: pending.binding.clone(),
        registry_binding: pending.registry_binding.clone(),
        acknowledgment: acknowledgment.clone(),
        modules,
    };
    inner.authority = Authority::Accepted(Box::new(accepted));
    let state_snapshot = Xcom2NativeActivationState::state_snapshot(&inner);
    AcknowledgmentDecision::Acknowledged {
        acknowledgment,
        state: state_snapshot,
    }
}

fn refused(
    code: AcknowledgmentRefusalCode,
    state: ActivationEvidenceState,
) -> AcknowledgmentDecision {
    AcknowledgmentDecision::Refused { code, state }
}

pub(super) fn transition(
    state: &Xcom2NativeActivationState,
    event: ActivationLifecycleEvent,
) -> ActivationLifecycleDecision {
    let mut inner = state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let ActivationLifecycleEvent::NewerActivationGeneration {
        activation_generation,
    } = event
    {
        if !valid_generation(activation_generation) {
            return ActivationLifecycleDecision::Refused {
                code: "event-invalid",
                state: Xcom2NativeActivationState::state_snapshot(&inner),
            };
        }
        let current_generation = match &inner.authority {
            Authority::Preparing {
                activation_generation,
                ..
            } => Some(*activation_generation),
            Authority::Pending(pending) => Some(pending.activation_generation),
            Authority::Accepted(accepted) => Some(accepted.activation_generation),
            Authority::Revoked(_) => None,
        };
        if current_generation.is_none_or(|current| activation_generation <= current) {
            return ActivationLifecycleDecision::Retained {
                state: Xcom2NativeActivationState::state_snapshot(&inner),
            };
        }
        inner.authority = Authority::Revoked(ActivationRevocationCode::NewerActivationGeneration);
    } else {
        inner.authority = Authority::Revoked(event.revocation_code());
    }
    ActivationLifecycleDecision::Revoked {
        state: Xcom2NativeActivationState::state_snapshot(&inner),
    }
}

pub(super) fn inspect(
    state: &Xcom2NativeActivationState,
    request: BuildRecipeInspectionRequest,
) -> Result<BuildRecipeCandidate, String> {
    if !valid_id(&request.workspace_id)
        || !valid_generation(request.generation)
        || !portable_relative_path(&request.module_root, true)
    {
        return Err("request-invalid".to_string());
    }

    let (accepted, module) = {
        let inner = state
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let accepted = match &inner.authority {
            Authority::Accepted(accepted) => accepted.as_ref().clone(),
            _ => return Err("authority-unavailable".to_string()),
        };
        if request.workspace_id != accepted.workspace_id
            || request.generation != accepted.workspace_generation
        {
            return Err("stale-workspace".to_string());
        }
        let module = accepted
            .modules
            .iter()
            .find(|module| module.module_root == request.module_root)
            .cloned()
            .ok_or_else(|| "module-not-active".to_string())?;
        if module.source_hash.len() != 64 || (!module.configured && !module.strong) {
            return Err("accepted-snapshot-invalid".to_string());
        }
        (accepted, module)
    };

    if !current_workspace_binding_is_current(&accepted.registry_binding) {
        return Err("stale-workspace".to_string());
    }
    let facts = inspect_recipe(
        &accepted.binding,
        &module.module_root,
        &module.module_identity,
    )?;
    if !current_workspace_binding_is_current(&accepted.registry_binding) {
        return Err("stale-workspace".to_string());
    }
    let inner = state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !matches!(
        &inner.authority,
        Authority::Accepted(current)
            if current.activation_generation == accepted.activation_generation
                && current.inspection_generation == accepted.inspection_generation
                && current.activation_attempt_receipt == accepted.activation_attempt_receipt
    ) {
        return Err("authority-stale".to_string());
    }
    Ok(candidate_from_facts(
        &accepted,
        &module.module_root,
        accepted.inspection_generation,
        facts,
    ))
}

fn candidate_from_facts(
    accepted: &AcceptedAuthority,
    module_root: &str,
    inspection_generation: u64,
    facts: super::filesystem::InspectedRecipeFacts,
) -> BuildRecipeCandidate {
    const RUNTIME: &str = "workshop:1134256495";
    let arguments = vec![
        argument("source-directory", "current-module", module_root),
        argument(
            "sdk-directory",
            "unresolved",
            "separate-machine-authorization-required",
        ),
        argument(
            "game-directory",
            "unresolved",
            "separate-machine-authorization-required",
        ),
        argument("configuration", "declared", "Default"),
        argument("build-prefix", "unresolved", "pfx_copy"),
        argument(
            "highlander-source",
            "project-local",
            HIGHLANDER_SOURCE_RELATIVE_PATH,
        ),
        argument("highlander-runtime", "unresolved", RUNTIME),
    ];
    BuildRecipeCandidate {
        schema_version: 1,
        canonicalization: "RFC 8785",
        digest_algorithm: "SHA-256",
        workspace: BuildRecipeWorkspace {
            id: accepted.workspace_id.clone(),
            generation: accepted.workspace_generation,
        },
        module: BuildRecipeModule {
            id: facts.module_identity,
            root: module_root.to_string(),
            activation_generation: accepted.activation_generation,
            entry_type: "directory",
            contains_symlink: false,
        },
        inspection_generation,
        script: BuildRecipeScript {
            relative_path: SCRIPT_RELATIVE_PATH,
            entry_type: "regular-file",
            contains_symlink: false,
            trust: "untrusted-project-input",
            sha256: facts.script_sha256,
            byte_size: facts.script_byte_size,
        },
        provenance: BuildRecipeProvenance {
            project: "X2ModBuildCommon",
            license: "MIT",
            notice: BuildRecipeNotice {
                identity: "x2modbuildcommon-mit-notice-v1",
                text: facts.notice_text,
                sha256: facts.notice_sha256,
            },
        },
        action: "default",
        arguments,
        dependencies: BuildRecipeDependencies {
            build_prefix: BuildPrefixDependency {
                identity: "pfx_copy",
                state: "unresolved",
            },
            highlander_source: HighlanderSourceDependency {
                identity: "highlander-source:local",
                relative_path: HIGHLANDER_SOURCE_RELATIVE_PATH,
                state: "project-local",
                entry_type: "directory",
                contains_symlink: false,
            },
            highlander_runtime: HighlanderRuntimeDependency {
                identity: RUNTIME,
                state: "unresolved",
            },
        },
        unresolved_prerequisites: vec![
            prerequisite("sdk-directory", "sdk-directory"),
            prerequisite("game-directory", "game-directory"),
            prerequisite("build-prefix", "pfx_copy"),
            prerequisite("build-tool", "x2modbuildcommon-tool"),
            prerequisite("highlander-runtime", RUNTIME),
        ],
        execution_blocked: true,
    }
}

fn argument(role: &'static str, value_state: &'static str, value: &str) -> BuildRecipeArgument {
    BuildRecipeArgument {
        role,
        value_state,
        value: value.to_string(),
    }
}

fn prerequisite(role: &'static str, identity: &'static str) -> UnresolvedPrerequisite {
    UnresolvedPrerequisite {
        role,
        identity,
        state: "unresolved",
    }
}

fn mint_opaque(prefix: &str) -> Result<String, String> {
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| "opaque-handle-mint-failed".to_string())?;
    let mut value = String::with_capacity(prefix.len() + 1 + random.len() * 2);
    value.push_str(prefix);
    value.push(':');
    for byte in random {
        use std::fmt::Write;
        write!(&mut value, "{byte:02x}").expect("writing to String cannot fail");
    }
    Ok(value)
}
