use std::collections::BTreeMap;
use std::sync::Mutex;

use super::contract::{
    ActivationAcknowledgment, ActivationEvidenceState, ActivationRevocationCode,
    NativeActivationCandidate, SelectedActivationModule,
};
use super::filesystem::{FileIdentity, WorkspaceBinding};

#[derive(Debug, Clone)]
pub(super) struct RetainedModule {
    pub module_root: String,
    pub evidence_handle: String,
    pub source_hash: String,
    pub strong: bool,
    pub configured: bool,
    pub module_identity: FileIdentity,
}

#[derive(Debug, Clone)]
pub(super) struct PendingAuthority {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub activation_generation: u64,
    pub activation_attempt_receipt: String,
    pub binding: WorkspaceBinding,
    pub candidate: NativeActivationCandidate,
    pub modules: BTreeMap<String, RetainedModule>,
}

#[derive(Debug, Clone)]
pub(super) struct AcceptedAuthority {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub activation_generation: u64,
    pub activation_attempt_receipt: String,
    pub binding: WorkspaceBinding,
    pub acknowledgment: ActivationAcknowledgment,
    pub modules: Vec<RetainedModule>,
}

#[derive(Debug, Clone)]
pub(super) enum Authority {
    Preparing {
        activation_generation: u64,
        activation_attempt_receipt: String,
    },
    Pending(Box<PendingAuthority>),
    Accepted(Box<AcceptedAuthority>),
    Revoked(ActivationRevocationCode),
}

#[derive(Debug)]
pub(super) struct Inner {
    pub next_activation_generation: u64,
    pub next_inspection_generation: u64,
    pub authority: Authority,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            next_activation_generation: 0,
            next_inspection_generation: 0,
            authority: Authority::Revoked(ActivationRevocationCode::WorkspaceActivationStarted),
        }
    }
}

#[derive(Debug, Default)]
pub struct Xcom2NativeActivationState {
    pub(super) inner: Mutex<Inner>,
}

impl Xcom2NativeActivationState {
    pub fn revoke(&self, code: ActivationRevocationCode) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.authority = Authority::Revoked(code);
    }

    pub(super) fn state_snapshot(inner: &Inner) -> ActivationEvidenceState {
        match &inner.authority {
            Authority::Pending(pending) => ActivationEvidenceState::Pending {
                workspace_id: pending.workspace_id.clone(),
                workspace_generation: pending.workspace_generation,
                activation_generation: pending.activation_generation,
                activation_attempt_receipt: pending.activation_attempt_receipt.clone(),
                scan: Box::new(pending.candidate.scan.clone()),
                configuration: Box::new(pending.candidate.configuration.clone()),
            },
            Authority::Accepted(accepted) => {
                let selected_modules = accepted
                    .modules
                    .iter()
                    .map(|module| SelectedActivationModule {
                        module_root: module.module_root.clone(),
                        evidence_handle: module.evidence_handle.clone(),
                    })
                    .collect();
                ActivationEvidenceState::Acknowledged {
                    workspace_id: accepted.workspace_id.clone(),
                    workspace_generation: accepted.workspace_generation,
                    activation_generation: accepted.activation_generation,
                    activation_attempt_receipt: accepted.activation_attempt_receipt.clone(),
                    acknowledgment: accepted.acknowledgment.clone(),
                    selected_modules,
                }
            }
            Authority::Revoked(code) => ActivationEvidenceState::Revoked { code: *code },
            Authority::Preparing { .. } => ActivationEvidenceState::Revoked {
                code: ActivationRevocationCode::WorkspaceActivationStarted,
            },
        }
    }
}
