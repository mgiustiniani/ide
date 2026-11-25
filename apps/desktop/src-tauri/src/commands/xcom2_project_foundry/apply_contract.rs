use serde::{Deserialize, Serialize};

use super::{
    FoundryDestinationParentSelectionGrant, FoundryOperationGrant, FoundrySourceSelectionGrant,
};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyFoundryProjectRequest {
    pub schema_version: u8,
    pub source_grant: FoundrySourceSelectionGrant,
    pub destination_parent_grant: FoundryDestinationParentSelectionGrant,
    pub operation_grant: FoundryOperationGrant,
    pub mod_id: String,
    pub approved_plan_digest: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FoundryApplyRefusalReason {
    SchemaVersionInvalid,
    SourceGrantMismatched,
    DestinationParentGrantMismatched,
    OperationGrantMismatched,
    ModIdInvalid,
    ModIdMismatched,
    ApprovedPlanDigestInvalid,
    ApprovedPlanDigestMismatched,
    ApplyAuthorityConsumed,
    SourceStale,
    DestinationParentStale,
    DestinationPresent,
    RenderedPlanInvalid,
    StageConflict,
    JournalConflict,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FoundryApplyFailureReason {
    JournalCreateFailed,
    JournalSyncFailed,
    StageCreateFailed,
    StageWriteFailed,
    StageVerifyFailed,
    StageSyncFailed,
    ParentSyncFailed,
    AtomicCommitFailed,
    CleanupFailed,
    PostCommitParentSyncFailed,
    PostCommitJournalFailed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FoundryApplyCleanupStatus {
    VerifiedComplete,
    NotVerified,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "result", rename_all = "kebab-case")]
pub enum ApplyFoundryProjectResult {
    Created {
        #[serde(rename = "planDigest")]
        plan_digest: String,
        #[serde(rename = "finalProjectLocation")]
        final_project_location: String,
        #[serde(rename = "sourceCommit")]
        source_commit: String,
        #[serde(rename = "sourceTree")]
        source_tree: String,
        #[serde(rename = "committedDirectories")]
        committed_directories: usize,
        #[serde(rename = "committedFiles")]
        committed_files: usize,
    },
    Refused {
        phase: FoundryApplyPhase,
        reason: FoundryApplyRefusalReason,
    },
    Failed {
        phase: FoundryApplyPhase,
        reason: FoundryApplyFailureReason,
        #[serde(rename = "cleanupStatus")]
        cleanup_status: FoundryApplyCleanupStatus,
    },
    CreatedRecoveryRequired {
        phase: FoundryApplyPostCommitPhase,
        #[serde(rename = "planDigest")]
        plan_digest: String,
        #[serde(rename = "finalProjectLocation")]
        final_project_location: String,
        reason: FoundryApplyFailureReason,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum FoundryApplyPhase {
    #[serde(rename = "pre-commit")]
    PreCommit,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum FoundryApplyPostCommitPhase {
    #[serde(rename = "post-commit")]
    PostCommit,
}
