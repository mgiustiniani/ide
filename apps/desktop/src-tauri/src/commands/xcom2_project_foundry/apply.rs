use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    bind_rendered_plan, canonical_path_string, destination_absence_for_render,
    open_exact_repository, render_failure_code, render_from_git_objects,
    revalidate_destination_parent_record, revalidate_source_record,
    validate_destination_grant_shape, validate_mod_id_for_render, validate_operation_grant_shape,
    validate_source_grant_shape, DestinationGrantRecord, FoundryDestinationParentSelectionGrant,
    FoundryOperationGrant, FoundryPlanBinding, FoundryRenderRefusalCode, FoundryRenderedOutputFile,
    FoundrySourceSelectionGrant, SourceGrantRecord, Xcom2ProjectFoundryState,
};

const DIRECTORY_COUNT: usize = 12;
const FILE_COUNT: usize = 27;

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

#[derive(Clone)]
struct ConsumedApply {
    source: SourceGrantRecord,
    destination: DestinationGrantRecord,
    operation: FoundryOperationGrant,
    retained_files: Vec<FoundryRenderedOutputFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApplyError {
    Refused(FoundryApplyRefusalReason),
    Failed(FoundryApplyFailureReason),
}

trait FaultInjector {
    fn hit(&self, _point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        Ok(())
    }
}

struct NoFaults;
impl FaultInjector for NoFaults {}

pub(super) fn apply_foundry_project(
    state: &Xcom2ProjectFoundryState,
    request: ApplyFoundryProjectRequest,
) -> ApplyFoundryProjectResult {
    apply_with_faults(state, request, &NoFaults)
}

fn apply_with_faults(
    state: &Xcom2ProjectFoundryState,
    request: ApplyFoundryProjectRequest,
    faults: &dyn FaultInjector,
) -> ApplyFoundryProjectResult {
    let consumed = match consume_operation(state, &request) {
        Ok(consumed) => consumed,
        Err(reason) => return refused(reason),
    };

    let result = apply_consumed(state, &request, &consumed, faults);
    finish_apply(
        state,
        &request,
        matches!(result, ApplyFoundryProjectResult::Created { .. }),
    );
    result
}

fn consume_operation(
    state: &Xcom2ProjectFoundryState,
    request: &ApplyFoundryProjectRequest,
) -> Result<ConsumedApply, FoundryApplyRefusalReason> {
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| FoundryApplyRefusalReason::OperationGrantMismatched)?;
    if grants
        .consumed_operations
        .iter()
        .any(|identity| identity == &request.operation_grant.identity)
    {
        return Err(FoundryApplyRefusalReason::ApplyAuthorityConsumed);
    }

    let linked_destination = grants
        .operation_to_destination
        .get(&request.operation_grant.identity)
        .cloned()
        .ok_or(FoundryApplyRefusalReason::OperationGrantMismatched)?;
    let mut destination = grants
        .destination_grants
        .get(&linked_destination)
        .cloned()
        .ok_or(FoundryApplyRefusalReason::DestinationParentGrantMismatched)?;
    let live_operation = destination
        .operation
        .clone()
        .ok_or(FoundryApplyRefusalReason::OperationGrantMismatched)?;

    // Consumption is deliberately completed before validating approval or touching the filesystem.
    if let Some(record) = grants.destination_grants.get_mut(&linked_destination) {
        record.operation = None;
    }
    grants
        .operation_to_destination
        .remove(&request.operation_grant.identity);
    let retained_files = grants
        .rendered_files_by_operation
        .remove(&request.operation_grant.identity);
    remember_consumed(
        &mut grants.consumed_operations,
        &request.operation_grant.identity,
    );
    destination.operation = None;

    if request.schema_version != 1 {
        return Err(FoundryApplyRefusalReason::SchemaVersionInvalid);
    }
    if validate_operation_grant_shape(&request.operation_grant).is_err()
        || live_operation.operation_grant != request.operation_grant
    {
        return Err(FoundryApplyRefusalReason::OperationGrantMismatched);
    }
    if validate_destination_grant_shape(&request.destination_parent_grant).is_err()
        || linked_destination != request.destination_parent_grant.identity
        || destination.destination_grant != request.destination_parent_grant
    {
        return Err(FoundryApplyRefusalReason::DestinationParentGrantMismatched);
    }
    if validate_source_grant_shape(&request.source_grant).is_err() {
        return Err(FoundryApplyRefusalReason::SourceGrantMismatched);
    }
    let source = grants
        .source_grants
        .get(&request.source_grant.identity)
        .cloned()
        .ok_or(FoundryApplyRefusalReason::SourceGrantMismatched)?;
    if source.grant != request.source_grant {
        return Err(FoundryApplyRefusalReason::SourceGrantMismatched);
    }
    if validate_mod_id_for_render(&request.mod_id).is_err() {
        return Err(FoundryApplyRefusalReason::ModIdInvalid);
    }
    if live_operation.mod_id != request.mod_id {
        return Err(FoundryApplyRefusalReason::ModIdMismatched);
    }
    if !valid_digest(&request.approved_plan_digest) {
        return Err(FoundryApplyRefusalReason::ApprovedPlanDigestInvalid);
    }
    let retained_files =
        retained_files.ok_or(FoundryApplyRefusalReason::OperationGrantMismatched)?;
    grants.active_apply_destinations.insert(linked_destination);

    Ok(ConsumedApply {
        source,
        destination,
        operation: request.operation_grant.clone(),
        retained_files,
    })
}

fn remember_consumed(consumed: &mut std::collections::VecDeque<String>, identity: &str) {
    const MAX_CONSUMED: usize = 256;
    while consumed.len() >= MAX_CONSUMED {
        consumed.pop_front();
    }
    consumed.push_back(identity.to_string());
}

fn finish_apply(
    state: &Xcom2ProjectFoundryState,
    request: &ApplyFoundryProjectRequest,
    success: bool,
) {
    if let Ok(mut grants) = state.grants.lock() {
        grants
            .active_apply_destinations
            .remove(&request.destination_parent_grant.identity);
        if success {
            super::clear_operation_grants(&mut grants);
            grants.source_grants.clear();
            grants.destination_grants.clear();
        }
    }
}

fn apply_consumed(
    state: &Xcom2ProjectFoundryState,
    request: &ApplyFoundryProjectRequest,
    consumed: &ConsumedApply,
    faults: &dyn FaultInjector,
) -> ApplyFoundryProjectResult {
    if let Err(reason) = revalidate_authority(state, request, consumed) {
        return refused(reason);
    }
    if let Err(reason) = faults.hit("before-rerender").map_err(ApplyError::Failed) {
        return result_from_error(reason);
    }

    let repository = match open_exact_repository(&consumed.source.git_directory) {
        Ok(repository) => repository,
        Err(_) => return refused(FoundryApplyRefusalReason::SourceStale),
    };
    let output = match render_from_git_objects(&repository, &state.expected, &request.mod_id) {
        Ok(output) => output,
        Err(failure) => {
            let reason = match render_failure_code(failure) {
                FoundryRenderRefusalCode::SourceCommitMissing
                | FoundryRenderRefusalCode::SourceCommitUnreadable
                | FoundryRenderRefusalCode::SourceCommitMismatched
                | FoundryRenderRefusalCode::SourceCommitFingerprintInvalid
                | FoundryRenderRefusalCode::SourceTreeMissing
                | FoundryRenderRefusalCode::SourceTreeUnreadable
                | FoundryRenderRefusalCode::SourceTreeMismatched
                | FoundryRenderRefusalCode::SourceTreeFingerprintInvalid
                | FoundryRenderRefusalCode::SourceBlobMissing
                | FoundryRenderRefusalCode::SourceBlobUnreadable
                | FoundryRenderRefusalCode::SourceBlobMismatched
                | FoundryRenderRefusalCode::SourceBlobFingerprintInvalid => {
                    FoundryApplyRefusalReason::SourceStale
                }
                _ => FoundryApplyRefusalReason::RenderedPlanInvalid,
            };
            return refused(reason);
        }
    };
    drop(repository);

    let rendered = match bind_rendered_plan(
        &state.expected,
        &request.mod_id,
        output,
        FoundryPlanBinding {
            repository: &request.source_grant.repository,
            source_grant_identity: &request.source_grant.identity,
            parent: &request.destination_parent_grant.parent,
            parent_grant_identity: &request.destination_parent_grant.identity,
            derived_destination: &request.operation_grant.derived_destination,
            operation_grant: &consumed.operation,
        },
    ) {
        Ok(rendered) => rendered,
        Err(_) => return refused(FoundryApplyRefusalReason::RenderedPlanInvalid),
    };
    let digest = match canonical_plan_digest(&rendered.plan_body) {
        Ok(digest) => digest,
        Err(_) => return refused(FoundryApplyRefusalReason::RenderedPlanInvalid),
    };
    if digest != request.approved_plan_digest {
        return refused(FoundryApplyRefusalReason::ApprovedPlanDigestMismatched);
    }
    if rendered.output_files != consumed.retained_files
        || rendered.output_files.len() != FILE_COUNT
        || rendered.plan_body.directories.len() != DIRECTORY_COUNT
    {
        return refused(FoundryApplyRefusalReason::RenderedPlanInvalid);
    }
    if let Err(reason) = revalidate_authority(state, request, consumed) {
        return refused(reason);
    }

    let validate_commit = || {
        revalidate_commit_plan(
            state,
            request,
            consumed,
            &rendered.output_files,
            &request.approved_plan_digest,
        )
    };
    match materialize_and_commit(
        request,
        &rendered.output_files,
        &rendered.plan_body.directories,
        faults,
        &validate_commit,
        consumed.destination.parent.device,
        consumed.destination.parent.inode,
    ) {
        Ok(()) => ApplyFoundryProjectResult::Created {
            plan_digest: digest,
            final_project_location: request.operation_grant.derived_destination.clone(),
            source_commit: state.expected.commit.to_string(),
            source_tree: state.expected.tree.to_string(),
            committed_directories: DIRECTORY_COUNT,
            committed_files: FILE_COUNT,
        },
        Err(TransactionFailure::PreCommit(error)) => result_from_error(error),
        Err(TransactionFailure::PostCommit(reason)) => {
            ApplyFoundryProjectResult::CreatedRecoveryRequired {
                phase: FoundryApplyPostCommitPhase::PostCommit,
                plan_digest: digest,
                final_project_location: request.operation_grant.derived_destination.clone(),
                reason,
            }
        }
    }
}

fn revalidate_authority(
    state: &Xcom2ProjectFoundryState,
    request: &ApplyFoundryProjectRequest,
    consumed: &ConsumedApply,
) -> Result<(), FoundryApplyRefusalReason> {
    revalidate_source_record(&consumed.source)
        .map_err(|_| FoundryApplyRefusalReason::SourceStale)?;
    revalidate_destination_parent_record(&consumed.destination)
        .map_err(|_| FoundryApplyRefusalReason::DestinationParentStale)?;
    destination_absence_for_render(&consumed.destination.parent.canonical_path, &request.mod_id)
        .map_err(|code| match code {
            FoundryRenderRefusalCode::DerivedDestinationPresent => {
                FoundryApplyRefusalReason::DestinationPresent
            }
            _ => FoundryApplyRefusalReason::DestinationParentStale,
        })?;
    if canonical_path_string(
        &consumed
            .destination
            .parent
            .canonical_path
            .join(&request.mod_id),
    )
    .ok()
        != Some(request.operation_grant.derived_destination.clone())
    {
        return Err(FoundryApplyRefusalReason::OperationGrantMismatched);
    }
    let grants = state
        .grants
        .lock()
        .map_err(|_| FoundryApplyRefusalReason::OperationGrantMismatched)?;
    if grants.source_grants.get(&request.source_grant.identity) != Some(&consumed.source)
        || grants
            .destination_grants
            .get(&request.destination_parent_grant.identity)
            != Some(&consumed.destination)
        || !grants
            .active_apply_destinations
            .contains(&request.destination_parent_grant.identity)
    {
        return Err(FoundryApplyRefusalReason::OperationGrantMismatched);
    }
    Ok(())
}

fn revalidate_commit_plan(
    state: &Xcom2ProjectFoundryState,
    request: &ApplyFoundryProjectRequest,
    consumed: &ConsumedApply,
    expected_files: &[FoundryRenderedOutputFile],
    expected_digest: &str,
) -> Result<(), FoundryApplyRefusalReason> {
    revalidate_authority(state, request, consumed)?;
    let repository = open_exact_repository(&consumed.source.git_directory)
        .map_err(|_| FoundryApplyRefusalReason::SourceStale)?;
    let output = render_from_git_objects(&repository, &state.expected, &request.mod_id)
        .map_err(|_| FoundryApplyRefusalReason::SourceStale)?;
    drop(repository);
    let rendered = bind_rendered_plan(
        &state.expected,
        &request.mod_id,
        output,
        FoundryPlanBinding {
            repository: &request.source_grant.repository,
            source_grant_identity: &request.source_grant.identity,
            parent: &request.destination_parent_grant.parent,
            parent_grant_identity: &request.destination_parent_grant.identity,
            derived_destination: &request.operation_grant.derived_destination,
            operation_grant: &consumed.operation,
        },
    )
    .map_err(|_| FoundryApplyRefusalReason::RenderedPlanInvalid)?;
    if rendered.output_files != expected_files
        || canonical_plan_digest(&rendered.plan_body).ok().as_deref() != Some(expected_digest)
    {
        return Err(FoundryApplyRefusalReason::RenderedPlanInvalid);
    }
    revalidate_authority(state, request, consumed)
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn canonical_plan_digest(
    plan: &super::FoundryRenderedPlanBody,
) -> Result<String, serde_json::Error> {
    fn canonicalize(
        value: &serde_json::Value,
        output: &mut String,
    ) -> Result<(), serde_json::Error> {
        match value {
            serde_json::Value::Null => output.push_str("null"),
            serde_json::Value::Bool(value) => {
                output.push_str(if *value { "true" } else { "false" })
            }
            serde_json::Value::Number(value) => output.push_str(&value.to_string()),
            serde_json::Value::String(value) => output.push_str(&serde_json::to_string(value)?),
            serde_json::Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    canonicalize(value, output)?;
                }
                output.push(']');
            }
            serde_json::Value::Object(values) => {
                output.push('{');
                let mut keys = values.keys().collect::<Vec<_>>();
                // RFC 8785 orders member names by UTF-16 code units.
                keys.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
                for (index, key) in keys.into_iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(&serde_json::to_string(key)?);
                    output.push(':');
                    canonicalize(&values[key], output)?;
                }
                output.push('}');
            }
        }
        Ok(())
    }

    let value = serde_json::to_value(plan)?;
    let mut canonical = String::new();
    canonicalize(&value, &mut canonical)?;
    Ok(hex_digest(canonical.as_bytes()))
}

#[derive(Debug)]
enum TransactionFailure {
    PreCommit(ApplyError),
    PostCommit(FoundryApplyFailureReason),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JournalRecord<'a> {
    schema_version: u8,
    state: &'a str,
    plan_digest: &'a str,
    operation_identity: &'a str,
    stage_name: &'a str,
    destination_name: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OwnedIdentity {
    device: u64,
    inode: u64,
    directory: bool,
}

#[derive(Default)]
struct OwnedStage {
    entries: BTreeMap<PathBuf, OwnedIdentity>,
}

fn materialize_and_commit(
    request: &ApplyFoundryProjectRequest,
    files: &[FoundryRenderedOutputFile],
    directories: &[super::renderer::FoundryRenderedDirectory],
    faults: &dyn FaultInjector,
    validate_commit: &dyn Fn() -> Result<(), FoundryApplyRefusalReason>,
    expected_parent_device: u64,
    expected_parent_inode: u64,
) -> Result<(), TransactionFailure> {
    let parent = Path::new(&request.destination_parent_grant.parent);
    let destination_name = request.mod_id.as_str();
    let stage_name = format!(
        ".{}.foundry-stage-{}",
        request.mod_id, request.approved_plan_digest
    );
    let journal_name = format!(
        ".{}.foundry-journal-{}.json",
        request.mod_id, request.approved_plan_digest
    );
    let stage_path = parent.join(&stage_name);
    let journal_path = parent.join(&journal_name);
    let destination_path = parent.join(destination_name);

    require_absent(
        &destination_path,
        FoundryApplyRefusalReason::DestinationPresent,
    )?;
    require_absent(&stage_path, FoundryApplyRefusalReason::StageConflict)?;
    require_absent(&journal_path, FoundryApplyRefusalReason::JournalConflict)?;

    faults
        .hit("before-journal-create")
        .map_err(|reason| TransactionFailure::PreCommit(ApplyError::Failed(reason)))?;
    let mut journal = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&journal_path)
        .map_err(|error| {
            TransactionFailure::PreCommit(if error.kind() == std::io::ErrorKind::AlreadyExists {
                ApplyError::Refused(FoundryApplyRefusalReason::JournalConflict)
            } else {
                ApplyError::Failed(FoundryApplyFailureReason::JournalCreateFailed)
            })
        })?;
    let initial_journal_metadata = journal.metadata().map_err(|_| {
        TransactionFailure::PreCommit(ApplyError::Failed(
            FoundryApplyFailureReason::JournalCreateFailed,
        ))
    })?;
    let journal_identity = owned_identity(&initial_journal_metadata);
    if journal
        .set_permissions(fs::Permissions::from_mode(0o600))
        .is_err()
    {
        drop(journal);
        let _ = remove_owned_file(&journal_path, journal_identity);
        let _ = sync_directory(parent);
        return Err(TransactionFailure::PreCommit(ApplyError::Failed(
            FoundryApplyFailureReason::JournalCreateFailed,
        )));
    }
    let journal_metadata = match journal.metadata() {
        Ok(metadata) => metadata,
        Err(_) => {
            drop(journal);
            let _ = remove_owned_file(&journal_path, journal_identity);
            let _ = sync_directory(parent);
            return Err(TransactionFailure::PreCommit(ApplyError::Failed(
                FoundryApplyFailureReason::JournalCreateFailed,
            )));
        }
    };
    if !journal_metadata.is_file() || journal_metadata.permissions().mode() & 0o7777 != 0o600 {
        drop(journal);
        let _ = remove_owned_file(&journal_path, journal_identity);
        let _ = sync_directory(parent);
        return Err(TransactionFailure::PreCommit(ApplyError::Failed(
            FoundryApplyFailureReason::JournalCreateFailed,
        )));
    }
    let mut owned = OwnedStage::default();
    let mut committed = false;

    let transaction = (|| {
        write_journal(
            &mut journal,
            request,
            &stage_name,
            destination_name,
            "preparing",
            faults,
        )?;
        sync_parent(parent, faults, "after-journal-create")?;

        faults
            .hit("before-stage-create")
            .map_err(ApplyError::Failed)?;
        let mut stage_builder = fs::DirBuilder::new();
        stage_builder.mode(0o700);
        stage_builder.create(&stage_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                ApplyError::Refused(FoundryApplyRefusalReason::StageConflict)
            } else {
                ApplyError::Failed(FoundryApplyFailureReason::StageCreateFailed)
            }
        })?;
        record_path(&stage_path, Path::new("."), true, &mut owned)?;
        fs::set_permissions(&stage_path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageCreateFailed))?;
        sync_parent(parent, faults, "after-stage-create")?;
        write_journal(
            &mut journal,
            request,
            &stage_name,
            destination_name,
            "staging",
            faults,
        )?;

        for directory in directories.iter().filter(|directory| directory.path != ".") {
            faults
                .hit("before-directory-create")
                .map_err(ApplyError::Failed)?;
            let relative = checked_relative(&directory.path)?;
            let path = stage_path.join(relative);
            let mut directory_builder = fs::DirBuilder::new();
            directory_builder.mode(0o755);
            directory_builder
                .create(&path)
                .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed))?;
            record_path(&path, relative, true, &mut owned)?;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed))?;
        }

        for output in files {
            faults
                .hit("before-file-create")
                .map_err(ApplyError::Failed)?;
            let relative = checked_relative(&output.path)?;
            let path = stage_path.join(relative);
            verify_owned_ancestors(&stage_path, relative, &owned)?;
            let mut file = OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(&path)
                .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed))?;
            record_file(&file, relative, &mut owned)?;
            file.write_all(&output.bytes)
                .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed))?;
            file.set_permissions(fs::Permissions::from_mode(output.mode))
                .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed))?;
            faults
                .hit("before-file-fsync")
                .map_err(ApplyError::Failed)?;
            file.sync_all()
                .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageSyncFailed))?;
            verify_file(&mut file, output)?;
        }

        fs::set_permissions(&stage_path, fs::Permissions::from_mode(0o755))
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed))?;
        refresh_record(&stage_path, Path::new("."), true, &mut owned)?;
        verify_complete_stage(&stage_path, directories, files, &owned)?;
        sync_directories_bottom_up(&stage_path, directories, faults)?;
        validate_commit().map_err(ApplyError::Refused)?;
        write_journal(
            &mut journal,
            request,
            &stage_name,
            destination_name,
            "ready",
            faults,
        )?;
        sync_parent(parent, faults, "before-commit-parent-sync")?;
        require_absent_apply(
            &destination_path,
            FoundryApplyRefusalReason::DestinationPresent,
        )?;
        verify_complete_stage(&stage_path, directories, files, &owned)?;

        faults.hit("before-renameat2").map_err(ApplyError::Failed)?;
        rename_noreplace(
            parent,
            &stage_name,
            destination_name,
            expected_parent_device,
            expected_parent_inode,
        )
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::AtomicCommitFailed))?;
        committed = true;
        Ok::<(), ApplyError>(())
    })();

    if let Err(error) = transaction {
        if committed {
            let _ = write_journal_without_fault(
                &mut journal,
                request,
                &stage_name,
                destination_name,
                "committed-recovery-required",
            );
            return Err(TransactionFailure::PostCommit(match error {
                ApplyError::Failed(reason) => reason,
                ApplyError::Refused(_) => FoundryApplyFailureReason::PostCommitJournalFailed,
            }));
        }
        let cleanup_ok = cleanup_owned_stage(&stage_path, &owned)
            && remove_owned_file(&journal_path, journal_identity);
        let _ = sync_directory(parent);
        return Err(TransactionFailure::PreCommit(if cleanup_ok {
            error
        } else {
            ApplyError::Failed(FoundryApplyFailureReason::CleanupFailed)
        }));
    }

    if faults.hit("after-commit-before-parent-fsync").is_err() || sync_directory(parent).is_err() {
        let _ = write_journal_without_fault(
            &mut journal,
            request,
            &stage_name,
            destination_name,
            "committed-recovery-required",
        );
        return Err(TransactionFailure::PostCommit(
            FoundryApplyFailureReason::PostCommitParentSyncFailed,
        ));
    }
    if write_journal(
        &mut journal,
        request,
        &stage_name,
        destination_name,
        "committed",
        faults,
    )
    .is_err()
    {
        return Err(TransactionFailure::PostCommit(
            FoundryApplyFailureReason::PostCommitJournalFailed,
        ));
    }
    if faults.hit("before-journal-remove").is_err() {
        let _ = write_journal_without_fault(
            &mut journal,
            request,
            &stage_name,
            destination_name,
            "committed-recovery-required",
        );
        return Err(TransactionFailure::PostCommit(
            FoundryApplyFailureReason::PostCommitJournalFailed,
        ));
    }
    drop(journal);
    if !remove_owned_file(&journal_path, journal_identity) || sync_directory(parent).is_err() {
        return Err(TransactionFailure::PostCommit(
            FoundryApplyFailureReason::PostCommitJournalFailed,
        ));
    }
    Ok(())
}

fn require_absent(
    path: &Path,
    reason: FoundryApplyRefusalReason,
) -> Result<(), TransactionFailure> {
    require_absent_apply(path, reason).map_err(TransactionFailure::PreCommit)
}

fn require_absent_apply(path: &Path, reason: FoundryApplyRefusalReason) -> Result<(), ApplyError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(ApplyError::Refused(reason)),
        Err(_) => Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        )),
    }
}

fn write_journal(
    file: &mut File,
    request: &ApplyFoundryProjectRequest,
    stage_name: &str,
    destination_name: &str,
    state: &str,
    faults: &dyn FaultInjector,
) -> Result<(), ApplyError> {
    faults
        .hit("before-journal-sync")
        .map_err(ApplyError::Failed)?;
    write_journal_without_fault(file, request, stage_name, destination_name, state)
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::JournalSyncFailed))
}

fn write_journal_without_fault(
    file: &mut File,
    request: &ApplyFoundryProjectRequest,
    stage_name: &str,
    destination_name: &str,
    state: &str,
) -> Result<(), std::io::Error> {
    let bytes = serde_json::to_vec(&JournalRecord {
        schema_version: 1,
        state,
        plan_digest: &request.approved_plan_digest,
        operation_identity: &request.operation_grant.identity,
        stage_name,
        destination_name,
    })
    .map_err(std::io::Error::other)?;
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&bytes)?;
    file.sync_all()
}

fn sync_parent(
    parent: &Path,
    faults: &dyn FaultInjector,
    point: &'static str,
) -> Result<(), ApplyError> {
    faults.hit(point).map_err(ApplyError::Failed)?;
    sync_directory(parent)
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::ParentSyncFailed))
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?
        .sync_all()
}

fn sync_directories_bottom_up(
    stage: &Path,
    directories: &[super::renderer::FoundryRenderedDirectory],
    faults: &dyn FaultInjector,
) -> Result<(), ApplyError> {
    let mut paths = directories
        .iter()
        .map(|directory| directory.path.as_str())
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| std::cmp::Reverse(path.matches('/').count()));
    for relative in paths {
        faults
            .hit("before-directory-fsync")
            .map_err(ApplyError::Failed)?;
        sync_directory(&stage.join(checked_relative(relative)?))
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageSyncFailed))?;
    }
    Ok(())
}

fn checked_relative(value: &str) -> Result<&Path, ApplyError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || value.contains("//")
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(ApplyError::Refused(
            FoundryApplyRefusalReason::RenderedPlanInvalid,
        ));
    }
    Ok(path)
}

fn verify_owned_ancestors(
    stage: &Path,
    relative: &Path,
    owned: &OwnedStage,
) -> Result<(), ApplyError> {
    let mut ancestor = relative.parent();
    while let Some(path) = ancestor {
        let key = if path.as_os_str().is_empty() {
            Path::new(".")
        } else {
            path
        };
        let expected = owned.entries.get(key).ok_or(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ))?;
        let metadata = fs::symlink_metadata(stage.join(key))
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
        if owned_identity(&metadata) != *expected || !expected.directory {
            return Err(ApplyError::Failed(
                FoundryApplyFailureReason::StageVerifyFailed,
            ));
        }
        if key == Path::new(".") {
            break;
        }
        ancestor = key.parent();
    }
    Ok(())
}

fn record_path(
    path: &Path,
    relative: &Path,
    directory: bool,
    owned: &mut OwnedStage,
) -> Result<(), ApplyError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
    let identity = owned_identity(&metadata);
    if identity.directory != directory || metadata.file_type().is_symlink() {
        return Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ));
    }
    owned.entries.insert(relative.to_path_buf(), identity);
    Ok(())
}

fn refresh_record(
    path: &Path,
    relative: &Path,
    directory: bool,
    owned: &mut OwnedStage,
) -> Result<(), ApplyError> {
    record_path(path, relative, directory, owned)
}

fn record_file(file: &File, relative: &Path, owned: &mut OwnedStage) -> Result<(), ApplyError> {
    let metadata = file
        .metadata()
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
    if !metadata.is_file() {
        return Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ));
    }
    owned
        .entries
        .insert(relative.to_path_buf(), owned_identity(&metadata));
    Ok(())
}

fn owned_identity(metadata: &Metadata) -> OwnedIdentity {
    OwnedIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        directory: metadata.is_dir(),
    }
}

fn verify_file(file: &mut File, output: &FoundryRenderedOutputFile) -> Result<(), ApplyError> {
    let metadata = file
        .metadata()
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.permissions().mode() & 0o7777 != output.mode
        || metadata.len() != output.bytes.len() as u64
    {
        return Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
    if hex_digest(&bytes) != hex_digest(&output.bytes) {
        return Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ));
    }
    Ok(())
}

fn verify_complete_stage(
    stage: &Path,
    directories: &[super::renderer::FoundryRenderedDirectory],
    files: &[FoundryRenderedOutputFile],
    owned: &OwnedStage,
) -> Result<(), ApplyError> {
    if owned.entries.len() != directories.len() + files.len() {
        return Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ));
    }
    let expected = directories
        .iter()
        .map(|entry| entry.path.as_str())
        .chain(files.iter().map(|entry| entry.path.as_str()))
        .collect::<BTreeSet<_>>();
    let mut actual = BTreeSet::new();
    collect_relative_entries(stage, stage, &mut actual)?;
    actual.insert(".".to_string());
    if actual.len() != expected.len()
        || actual.iter().map(String::as_str).collect::<BTreeSet<_>>() != expected
    {
        return Err(ApplyError::Failed(
            FoundryApplyFailureReason::StageVerifyFailed,
        ));
    }
    for directory in directories {
        let relative = checked_relative(&directory.path)?;
        let metadata = fs::symlink_metadata(stage.join(relative))
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || metadata.permissions().mode() & 0o7777 != 0o755
        {
            return Err(ApplyError::Failed(
                FoundryApplyFailureReason::StageVerifyFailed,
            ));
        }
        if owned.entries.get(relative) != Some(&owned_identity(&metadata)) {
            return Err(ApplyError::Failed(
                FoundryApplyFailureReason::StageVerifyFailed,
            ));
        }
    }
    for output in files {
        let relative = checked_relative(&output.path)?;
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(stage.join(relative))
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
        if owned.entries.get(relative)
            != Some(&owned_identity(&file.metadata().map_err(|_| {
                ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed)
            })?))
        {
            return Err(ApplyError::Failed(
                FoundryApplyFailureReason::StageVerifyFailed,
            ));
        }
        verify_file(&mut file, output)?;
    }
    Ok(())
}

fn collect_relative_entries(
    root: &Path,
    directory: &Path,
    output: &mut BTreeSet<String>,
) -> Result<(), ApplyError> {
    let mut entries = fs::read_dir(directory)
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?;
        if metadata.file_type().is_symlink() {
            return Err(ApplyError::Failed(
                FoundryApplyFailureReason::StageVerifyFailed,
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| ApplyError::Failed(FoundryApplyFailureReason::StageVerifyFailed))?
            .to_string_lossy()
            .to_string();
        output.insert(relative);
        if metadata.is_dir() {
            collect_relative_entries(root, &path, output)?;
        }
    }
    Ok(())
}

fn cleanup_owned_stage(stage: &Path, owned: &OwnedStage) -> bool {
    if owned.entries.is_empty() {
        return true;
    }
    for (relative, expected) in &owned.entries {
        let Ok(metadata) = fs::symlink_metadata(stage.join(relative)) else {
            return false;
        };
        if owned_identity(&metadata) != *expected || metadata.file_type().is_symlink() {
            return false;
        }
    }
    let mut entries = BTreeSet::new();
    if collect_relative_entries(stage, stage, &mut entries).is_err() {
        return false;
    }
    let tracked = owned
        .entries
        .keys()
        .filter(|path| path.as_path() != Path::new("."))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<BTreeSet<_>>();
    if entries != tracked {
        return false;
    }
    let mut paths = owned
        .entries
        .iter()
        .filter(|(path, _)| path.as_path() != Path::new("."))
        .collect::<Vec<_>>();
    paths.sort_by_key(|(path, _)| std::cmp::Reverse(path.components().count()));
    for (relative, identity) in paths {
        let path = stage.join(relative);
        let result = if identity.directory {
            fs::remove_dir(&path)
        } else {
            fs::remove_file(&path)
        };
        if result.is_err() {
            return false;
        }
    }
    fs::remove_dir(stage).is_ok()
}

fn remove_owned_file(path: &Path, expected: OwnedIdentity) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if !metadata.file_type().is_symlink() && owned_identity(&metadata) == expected =>
        {
            fs::remove_file(path).is_ok()
        }
        _ => false,
    }
}

fn rename_noreplace(
    parent: &Path,
    source: &str,
    destination: &str,
    expected_parent_device: u64,
    expected_parent_inode: u64,
) -> std::io::Result<()> {
    use std::ffi::CString;
    let parent_file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(parent)?;
    let parent_metadata = parent_file.metadata()?;
    if !parent_metadata.is_dir()
        || parent_metadata.dev() != expected_parent_device
        || parent_metadata.ino() != expected_parent_inode
    {
        return Err(std::io::Error::other("stale Foundry parent identity"));
    }
    let source = CString::new(source).map_err(std::io::Error::other)?;
    let destination = CString::new(destination).map_err(std::io::Error::other)?;
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            parent_file.as_raw_fd(),
            source.as_ptr(),
            parent_file.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        write!(&mut output, "{byte:02x}").expect("String write cannot fail");
    }
    output
}

fn refused(reason: FoundryApplyRefusalReason) -> ApplyFoundryProjectResult {
    ApplyFoundryProjectResult::Refused {
        phase: FoundryApplyPhase::PreCommit,
        reason,
    }
}

fn result_from_error(error: ApplyError) -> ApplyFoundryProjectResult {
    match error {
        ApplyError::Refused(reason) => refused(reason),
        ApplyError::Failed(reason) => ApplyFoundryProjectResult::Failed {
            phase: FoundryApplyPhase::PreCommit,
            reason,
        },
    }
}

#[cfg(test)]
mod tests;
