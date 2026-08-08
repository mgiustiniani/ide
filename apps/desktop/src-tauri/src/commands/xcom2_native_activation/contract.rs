use serde::{Deserialize, Serialize};

use crate::commands::xcom2_module_configuration::{
    Xcom2ModuleConfiguration, Xcom2ModuleConfigurationReadOutcome,
};
use crate::commands::xcom2_module_evidence::{
    Xcom2ModuleEvidenceObservation, Xcom2ModuleScanCompleteness, Xcom2ModuleScanIssue,
    Xcom2ModuleScanLimits,
};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginActivationEvidenceRequest {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub scan_id: String,
    pub scan_generation: u64,
    pub configuration_read_id: String,
    pub limits: Xcom2ModuleScanLimits,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeActivationEvidenceHandle {
    pub module_root: String,
    pub evidence_handle: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeModuleScanSnapshot {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub activation_generation: u64,
    pub activation_attempt_receipt: String,
    pub scan_id: String,
    pub scan_generation: u64,
    pub completeness: Xcom2ModuleScanCompleteness,
    pub issues: Vec<Xcom2ModuleScanIssue>,
    pub limits: Xcom2ModuleScanLimits,
    pub observations: Vec<Xcom2ModuleEvidenceObservation>,
    pub evidence_handles: Vec<NativeActivationEvidenceHandle>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeModuleConfigurationReadResult {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub activation_generation: u64,
    pub activation_attempt_receipt: String,
    pub configuration_read_id: String,
    pub evidence_handles: Vec<NativeActivationEvidenceHandle>,
    #[serde(flatten)]
    pub outcome: Xcom2ModuleConfigurationReadOutcome,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeActivationCandidate {
    pub scan: NativeModuleScanSnapshot,
    pub configuration: NativeModuleConfigurationReadResult,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationAcknowledgment {
    pub activation_attempt_receipt: String,
    pub evidence_handles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedActivationModule {
    pub module_root: String,
    pub evidence_handle: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationRevocationCode {
    WorkspaceRefresh,
    WorkspaceSwitchStarted,
    WorkspaceActivationStarted,
    WorkspaceActivationFailed,
    ActivationAttemptFailed,
    NewerActivationGeneration,
    AppExit,
    CachedReactRestoration,
    CandidateInvalid,
    MixedActivationAttempt,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ActivationEvidenceState {
    Pending {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "workspaceGeneration")]
        workspace_generation: u64,
        #[serde(rename = "activationGeneration")]
        activation_generation: u64,
        #[serde(rename = "activationAttemptReceipt")]
        activation_attempt_receipt: String,
        scan: Box<NativeModuleScanSnapshot>,
        configuration: Box<NativeModuleConfigurationReadResult>,
    },
    Acknowledged {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "workspaceGeneration")]
        workspace_generation: u64,
        #[serde(rename = "activationGeneration")]
        activation_generation: u64,
        #[serde(rename = "activationAttemptReceipt")]
        activation_attempt_receipt: String,
        acknowledgment: ActivationAcknowledgment,
        #[serde(rename = "selectedModules")]
        selected_modules: Vec<SelectedActivationModule>,
    },
    Revoked {
        code: ActivationRevocationCode,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AcknowledgmentRefusalCode {
    AuthorityUnavailable,
    EvaluationInvalid,
    Inactive,
    NeedsConfirmation,
    WeakEvidence,
    IncompleteEvidence,
    StaleCorrelation,
    DuplicateEvidenceHandle,
    UnknownEvidenceHandle,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AcknowledgmentDecision {
    Acknowledged {
        acknowledgment: ActivationAcknowledgment,
        state: ActivationEvidenceState,
    },
    Refused {
        code: AcknowledgmentRefusalCode,
        state: ActivationEvidenceState,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ActivationLifecycleEvent {
    WorkspaceRefresh,
    WorkspaceSwitchStarted,
    WorkspaceActivationStarted,
    WorkspaceActivationFailed,
    ActivationAttemptFailed,
    AppExit,
    CachedReactRestoration,
    NewerActivationGeneration {
        #[serde(rename = "activationGeneration")]
        activation_generation: u64,
    },
}

impl ActivationLifecycleEvent {
    pub fn revocation_code(&self) -> ActivationRevocationCode {
        match self {
            Self::WorkspaceRefresh => ActivationRevocationCode::WorkspaceRefresh,
            Self::WorkspaceSwitchStarted => ActivationRevocationCode::WorkspaceSwitchStarted,
            Self::WorkspaceActivationStarted => {
                ActivationRevocationCode::WorkspaceActivationStarted
            }
            Self::WorkspaceActivationFailed => ActivationRevocationCode::WorkspaceActivationFailed,
            Self::ActivationAttemptFailed => ActivationRevocationCode::ActivationAttemptFailed,
            Self::AppExit => ActivationRevocationCode::AppExit,
            Self::CachedReactRestoration => ActivationRevocationCode::CachedReactRestoration,
            Self::NewerActivationGeneration { .. } => {
                ActivationRevocationCode::NewerActivationGeneration
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ActivationLifecycleDecision {
    Revoked {
        state: ActivationEvidenceState,
    },
    Retained {
        state: ActivationEvidenceState,
    },
    Refused {
        code: &'static str,
        state: ActivationEvidenceState,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildRecipeInspectionRequest {
    pub workspace_id: String,
    pub generation: u64,
    pub module_root: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeWorkspace {
    pub id: String,
    pub generation: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeModule {
    pub id: String,
    pub root: String,
    pub activation_generation: u64,
    pub entry_type: &'static str,
    pub contains_symlink: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeScript {
    pub relative_path: &'static str,
    pub entry_type: &'static str,
    pub contains_symlink: bool,
    pub trust: &'static str,
    pub sha256: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeNotice {
    pub identity: &'static str,
    pub text: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BuildRecipeProvenance {
    pub project: &'static str,
    pub license: &'static str,
    pub notice: BuildRecipeNotice,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeArgument {
    pub role: &'static str,
    pub value_state: &'static str,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BuildPrefixDependency {
    pub identity: &'static str,
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HighlanderSourceDependency {
    pub identity: &'static str,
    pub relative_path: &'static str,
    pub state: &'static str,
    pub entry_type: &'static str,
    pub contains_symlink: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HighlanderRuntimeDependency {
    pub identity: &'static str,
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeDependencies {
    pub build_prefix: BuildPrefixDependency,
    pub highlander_source: HighlanderSourceDependency,
    pub highlander_runtime: HighlanderRuntimeDependency,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UnresolvedPrerequisite {
    pub role: &'static str,
    pub identity: &'static str,
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecipeCandidate {
    pub schema_version: u8,
    pub canonicalization: &'static str,
    pub digest_algorithm: &'static str,
    pub workspace: BuildRecipeWorkspace,
    pub module: BuildRecipeModule,
    pub inspection_generation: u64,
    pub script: BuildRecipeScript,
    pub provenance: BuildRecipeProvenance,
    pub action: &'static str,
    pub arguments: Vec<BuildRecipeArgument>,
    pub dependencies: BuildRecipeDependencies,
    pub unresolved_prerequisites: Vec<UnresolvedPrerequisite>,
    pub execution_blocked: bool,
}

pub(super) fn configuration_roots(result: &NativeModuleConfigurationReadResult) -> &[String] {
    match &result.outcome {
        Xcom2ModuleConfigurationReadOutcome::Ready { configuration } => &configuration.module_roots,
        _ => &[],
    }
}

pub(super) fn clone_configuration(
    outcome: &Xcom2ModuleConfigurationReadOutcome,
) -> Xcom2ModuleConfigurationReadOutcome {
    match outcome {
        Xcom2ModuleConfigurationReadOutcome::Absent => Xcom2ModuleConfigurationReadOutcome::Absent,
        Xcom2ModuleConfigurationReadOutcome::Ready { configuration } => {
            Xcom2ModuleConfigurationReadOutcome::Ready {
                configuration: Xcom2ModuleConfiguration {
                    version: configuration.version,
                    target: configuration.target.clone(),
                    module_roots: configuration.module_roots.clone(),
                },
            }
        }
        Xcom2ModuleConfigurationReadOutcome::Stopped { code } => {
            Xcom2ModuleConfigurationReadOutcome::Stopped { code: *code }
        }
    }
}
