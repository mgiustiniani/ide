use super::*;
use crate::commands::xcom2_project_foundry::tests::{RendererRepositoryFixture, TestDirectory};
use crate::commands::xcom2_project_foundry::{
    authorize_destination_parent_selection, authorize_source_repository, render_preview,
    AuthorizeFoundryDestinationParentSelectionRequest, RenderFoundryPreviewRequest,
    RenderFoundryPreviewResult,
};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

struct Prepared {
    _fixture: RendererRepositoryFixture,
    parent: TestDirectory,
    state: Xcom2ProjectFoundryState,
    request: ApplyFoundryProjectRequest,
    files: Vec<FoundryRenderedOutputFile>,
}

fn prepare(label: &str, mod_id: &str) -> Prepared {
    let fixture = RendererRepositoryFixture::new(label, None, false);
    let state = fixture.state();
    let source = authorize_source_repository(&state, fixture.source_request())
        .expect("authorize renderer source");
    let parent = TestDirectory::new(&format!("{label}-parent"));
    let destination = authorize_destination_parent_selection(
        &state,
        AuthorizeFoundryDestinationParentSelectionRequest {
            selected_root: parent.string(),
        },
    )
    .expect("authorize destination parent");
    let (operation, plan) = match render_preview(
        &state,
        RenderFoundryPreviewRequest {
            source_grant: source.clone(),
            destination_parent_grant: destination.clone(),
            mod_id: mod_id.to_string(),
        },
    ) {
        RenderFoundryPreviewResult::Rendered {
            operation_grant,
            plan_body,
        } => (operation_grant, plan_body),
        result => panic!("expected rendered preview, got {result:?}"),
    };
    let digest = canonical_plan_digest(&plan).expect("canonical plan digest");
    let files = state
        .grants
        .lock()
        .expect("grant store")
        .rendered_files_by_operation
        .get(&operation.identity)
        .expect("retained renderer bytes")
        .clone();
    Prepared {
        _fixture: fixture,
        parent,
        state,
        request: ApplyFoundryProjectRequest {
            schema_version: 1,
            source_grant: source,
            destination_parent_grant: destination,
            operation_grant: operation,
            mod_id: mod_id.to_string(),
            approved_plan_digest: digest,
        },
        files,
    }
}

#[derive(Default)]
struct FailAt {
    point: &'static str,
    occurrence: usize,
    seen: Mutex<usize>,
}

impl FailAt {
    fn new(point: &'static str, occurrence: usize) -> Self {
        Self {
            point,
            occurrence,
            seen: Mutex::new(0),
        }
    }
}

impl FaultInjector for FailAt {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        if point == self.point {
            let mut seen = self.seen.lock().expect("fault counter");
            *seen += 1;
            if *seen == self.occurrence {
                return Err(FoundryApplyFailureReason::StageWriteFailed);
            }
        }
        Ok(())
    }
}

struct CreateDestinationAtCommit(PathBuf);

impl FaultInjector for CreateDestinationAtCommit {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        if point == "before-renameat2" {
            fs::write(&self.0, b"external destination").expect("create racing destination");
        }
        Ok(())
    }
}

struct TamperOwnedStage(PathBuf);

impl FaultInjector for TamperOwnedStage {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        if point == "before-file-create" {
            fs::write(self.0.join("external-unknown"), b"preserve me")
                .expect("tamper private stage");
            return Err(FoundryApplyFailureReason::StageWriteFailed);
        }
        Ok(())
    }
}

struct ExactSecondFileFailureEvidence {
    stage: PathBuf,
    journal: PathBuf,
    second_file: PathBuf,
    counts: Mutex<(usize, usize, usize, usize)>,
}

impl FaultInjector for ExactSecondFileFailureEvidence {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        let mut counts = self.counts.lock().expect("evidence counters");
        match point {
            "before-directory-fsync" => counts.0 += 1,
            "after-directory-verify" => counts.1 += 1,
            "after-file-verify" => counts.2 += 1,
            "before-file-create" => {
                counts.3 += 1;
                if counts.3 == 2 {
                    assert_eq!(counts.0, 12, "all staged directories were fsynced");
                    assert_eq!(counts.1, 1, "staged directories were verified after fsync");
                    assert_eq!(counts.2, 1, "the first file was fsynced and verified");

                    let stage_metadata = fs::symlink_metadata(&self.stage).expect("owned stage");
                    assert!(stage_metadata.is_dir());
                    assert!(!stage_metadata.file_type().is_symlink());
                    assert_eq!(stage_metadata.permissions().mode() & 0o7777, 0o700);

                    let journal_metadata =
                        fs::symlink_metadata(&self.journal).expect("owned journal");
                    assert!(journal_metadata.is_file());
                    assert!(!journal_metadata.file_type().is_symlink());
                    assert_eq!(journal_metadata.permissions().mode() & 0o7777, 0o600);

                    let staged = tree_snapshot(&self.stage);
                    assert_eq!(
                        staged
                            .values()
                            .filter(|entry| entry.0 == "directory")
                            .count(),
                        11
                    );
                    assert_eq!(staged.values().filter(|entry| entry.0 == "file").count(), 1);
                    assert!(!staged.values().any(|entry| entry.0 == "symlink"));
                    let gitignore = staged.get(".gitignore").expect("first ordered file");
                    assert_eq!(gitignore.0, "file");
                    assert_eq!(gitignore.1 & 0o7777, 0o644);
                    assert_eq!(gitignore.2.len(), 17);
                    assert_eq!(
                        hex_digest(&gitignore.2),
                        "1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8"
                    );
                    assert!(self.second_file.symlink_metadata().is_err());
                    return Err(FoundryApplyFailureReason::StageWriteFailed);
                }
            }
            _ => {}
        }
        Ok(())
    }
}

struct SecondFileAndCleanupFault {
    cleanup_point: &'static str,
    file_creates: Mutex<usize>,
}

impl FaultInjector for SecondFileAndCleanupFault {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        if point == "before-file-create" {
            let mut file_creates = self.file_creates.lock().expect("file-create counter");
            *file_creates += 1;
            if *file_creates == 2 {
                return Err(FoundryApplyFailureReason::StageWriteFailed);
            }
        }
        if point == self.cleanup_point {
            return Err(FoundryApplyFailureReason::CleanupFailed);
        }
        Ok(())
    }
}

struct JournalSetupAndCleanupFault {
    cleanup_point: Option<&'static str>,
}

impl FaultInjector for JournalSetupAndCleanupFault {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        if point == "before-journal-permission-set" || self.cleanup_point == Some(point) {
            return Err(FoundryApplyFailureReason::JournalCreateFailed);
        }
        Ok(())
    }
}

struct RemovePinnedObject(PathBuf);

impl FaultInjector for RemovePinnedObject {
    fn hit(&self, point: &'static str) -> Result<(), FoundryApplyFailureReason> {
        if point == "before-directory-fsync" && self.0.exists() {
            fs::remove_file(&self.0).expect("remove pinned object during staging");
        }
        Ok(())
    }
}

#[test]
fn request_rejects_unknown_fields_and_serializes_only_safe_result_fields() {
    let prepared = prepare("apply-schema", "SchemaMod");
    let mut value = serde_json::json!({
        "schemaVersion": 1,
        "sourceGrant": prepared.request.source_grant,
        "destinationParentGrant": prepared.request.destination_parent_grant,
        "operationGrant": prepared.request.operation_grant,
        "modId": prepared.request.mod_id,
        "approvedPlanDigest": prepared.request.approved_plan_digest,
    });
    serde_json::from_value::<ApplyFoundryProjectRequest>(value.clone()).expect("exact request");
    value
        .as_object_mut()
        .expect("request object")
        .insert("outputManifest".into(), serde_json::json!([]));
    assert!(serde_json::from_value::<ApplyFoundryProjectRequest>(value).is_err());

    let result = refused(FoundryApplyRefusalReason::SourceStale);
    assert_eq!(
        serde_json::to_value(result).expect("serialize refusal"),
        serde_json::json!({"result":"refused", "phase":"pre-commit", "reason":"source-stale"})
    );
    for (cleanup_status, token) in [
        (
            FoundryApplyCleanupStatus::VerifiedComplete,
            "verified-complete",
        ),
        (FoundryApplyCleanupStatus::NotVerified, "not-verified"),
    ] {
        let result = ApplyFoundryProjectResult::Failed {
            phase: FoundryApplyPhase::PreCommit,
            reason: FoundryApplyFailureReason::StageWriteFailed,
            cleanup_status,
        };
        assert_eq!(
            serde_json::to_value(result).expect("serialize strict failure"),
            serde_json::json!({
                "result": "failed",
                "phase": "pre-commit",
                "reason": "stage-write-failed",
                "cleanupStatus": token,
            })
        );
    }
}

#[test]
fn successful_apply_creates_exact_retained_files_modes_and_no_residue() {
    let prepared = prepare("apply-success", "CreatedMod");
    let source_before = tree_snapshot(prepared._fixture.root_path());
    let request = prepared.request.clone();
    let result = apply_foundry_project(&prepared.state, request.clone());
    let destination = prepared.parent.path().join("CreatedMod");
    assert!(matches!(
        result,
        ApplyFoundryProjectResult::Created {
            committed_directories: 12,
            committed_files: 27,
            ..
        }
    ));
    assert_eq!(tree_snapshot(prepared._fixture.root_path()), source_before);
    assert_exact_output(&destination, &prepared.files);
    assert_eq!(
        fs::read_dir(prepared.parent.path())
            .expect("read destination parent")
            .count(),
        1
    );
    assert!(!prepared
        .parent
        .path()
        .join(format!(
            ".CreatedMod.foundry-journal-{}.json",
            request.approved_plan_digest
        ))
        .exists());
    assert_eq!(
        apply_foundry_project(&prepared.state, request),
        refused(FoundryApplyRefusalReason::ApplyAuthorityConsumed)
    );
}

#[test]
fn every_injected_precommit_phase_reports_only_proven_cleanup_and_consumes_authority() {
    for (index, (point, occurrence, expected_cleanup_status)) in [
        ("before-rerender", 1, FoundryApplyCleanupStatus::NotVerified),
        (
            "before-journal-create",
            1,
            FoundryApplyCleanupStatus::NotVerified,
        ),
        (
            "before-journal-permission-set",
            1,
            FoundryApplyCleanupStatus::NotVerified,
        ),
        (
            "before-journal-sync",
            1,
            FoundryApplyCleanupStatus::NotVerified,
        ),
        (
            "after-journal-create",
            1,
            FoundryApplyCleanupStatus::NotVerified,
        ),
        (
            "before-stage-create",
            1,
            FoundryApplyCleanupStatus::NotVerified,
        ),
        (
            "after-stage-create",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-journal-sync",
            2,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-directory-create",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-directory-create",
            11,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-directory-fsync",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-directory-fsync",
            12,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "after-directory-verify",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-file-create",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-file-create",
            2,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-file-create",
            27,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-file-fsync",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-file-fsync",
            27,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "after-file-verify",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "after-file-verify",
            27,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-directory-fsync",
            13,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-directory-fsync",
            24,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-journal-sync",
            3,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-commit-parent-sync",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
        (
            "before-renameat2",
            1,
            FoundryApplyCleanupStatus::VerifiedComplete,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let prepared = prepare(&format!("fault-{index}"), "FaultMod");
        let request = prepared.request.clone();
        let result = apply_with_faults(
            &prepared.state,
            request.clone(),
            &FailAt::new(point, occurrence),
        );
        assert!(
            matches!(
                result,
                ApplyFoundryProjectResult::Failed {
                    phase: FoundryApplyPhase::PreCommit,
                    cleanup_status,
                    ..
                } if cleanup_status == expected_cleanup_status
            ),
            "unexpected {point}#{occurrence}: {result:?}"
        );
        assert!(prepared
            .parent
            .path()
            .join("FaultMod")
            .symlink_metadata()
            .is_err());
        assert!(
            fs::read_dir(prepared.parent.path())
                .expect("read clean parent")
                .next()
                .is_none(),
            "residue after {point}#{occurrence}"
        );
        assert_eq!(
            apply_foundry_project(&prepared.state, request),
            refused(FoundryApplyRefusalReason::ApplyAuthorityConsumed)
        );
    }
}

#[test]
fn exact_second_file_failure_attests_only_after_verified_durable_cleanup() {
    let prepared = prepare("req004-exact-second-file", "VerifiedCleanupMod");
    assert_eq!(prepared.files[0].path, ".gitignore");
    assert_eq!(
        prepared.files[1].path,
        ".scripts/X2ModBuildCommon/CHANGELOG.md"
    );

    let sibling_directory = prepared.parent.path().join("scenario-sibling");
    fs::create_dir(&sibling_directory).expect("create sibling directory");
    fs::set_permissions(&sibling_directory, fs::Permissions::from_mode(0o750))
        .expect("set sibling directory mode");
    let sibling_file = sibling_directory.join("preserved.bin");
    let mut sibling = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&sibling_file)
        .expect("create sibling file");
    sibling.write_all(b"scenario-owned sibling\n").unwrap();
    sibling.sync_all().unwrap();
    sync_directory(&sibling_directory).unwrap();
    sync_directory(prepared.parent.path()).unwrap();

    let request = prepared.request.clone();
    let stage = prepared.parent.path().join(format!(
        ".VerifiedCleanupMod.foundry-stage-{}",
        request.approved_plan_digest
    ));
    let journal = prepared.parent.path().join(format!(
        ".VerifiedCleanupMod.foundry-journal-{}.json",
        request.approved_plan_digest
    ));
    let destination = prepared.parent.path().join("VerifiedCleanupMod");
    let source_tree_before = tree_snapshot(prepared._fixture.root_path());
    let source_identity_before = identity_snapshot(prepared._fixture.root_path());
    let parent_tree_before = tree_snapshot(prepared.parent.path());
    let parent_identity_before = identity_snapshot(prepared.parent.path());
    let parent_metadata_before = fs::symlink_metadata(prepared.parent.path()).unwrap();
    let parent_root_before = (
        parent_metadata_before.dev(),
        parent_metadata_before.ino(),
        parent_metadata_before.permissions().mode() & 0o7777,
        parent_metadata_before.uid(),
        parent_metadata_before.gid(),
    );

    let result = apply_with_faults(
        &prepared.state,
        request.clone(),
        &ExactSecondFileFailureEvidence {
            stage: stage.clone(),
            journal: journal.clone(),
            second_file: stage.join(".scripts/X2ModBuildCommon/CHANGELOG.md"),
            counts: Mutex::new((0, 0, 0, 0)),
        },
    );
    assert_eq!(
        result,
        ApplyFoundryProjectResult::Failed {
            phase: FoundryApplyPhase::PreCommit,
            reason: FoundryApplyFailureReason::StageWriteFailed,
            cleanup_status: FoundryApplyCleanupStatus::VerifiedComplete,
        }
    );

    let assert_verified_final_state = || {
        assert!(destination.symlink_metadata().is_err());
        assert!(stage.symlink_metadata().is_err());
        assert!(journal.symlink_metadata().is_err());
        assert_eq!(
            tree_snapshot(prepared._fixture.root_path()),
            source_tree_before
        );
        assert_eq!(
            identity_snapshot(prepared._fixture.root_path()),
            source_identity_before
        );
        assert_eq!(tree_snapshot(prepared.parent.path()), parent_tree_before);
        assert_eq!(
            identity_snapshot(prepared.parent.path()),
            parent_identity_before
        );
        let parent_metadata_after = fs::symlink_metadata(prepared.parent.path()).unwrap();
        assert_eq!(
            (
                parent_metadata_after.dev(),
                parent_metadata_after.ino(),
                parent_metadata_after.permissions().mode() & 0o7777,
                parent_metadata_after.uid(),
                parent_metadata_after.gid(),
            ),
            parent_root_before
        );
    };
    assert_verified_final_state();
    assert_eq!(
        apply_foundry_project(&prepared.state, request),
        refused(FoundryApplyRefusalReason::ApplyAuthorityConsumed)
    );
    assert_verified_final_state();
}

#[test]
fn cleanup_faults_and_parent_sync_uncertainty_never_overclaim() {
    for cleanup_point in [
        "before-stage-cleanup",
        "before-cleanup-absence-check",
        "before-journal-cleanup",
        "before-cleanup-parent-fsync",
    ] {
        let prepared = prepare(
            &format!("cleanup-status-{cleanup_point}"),
            "CleanupStatusMod",
        );
        let result = apply_with_faults(
            &prepared.state,
            prepared.request,
            &SecondFileAndCleanupFault {
                cleanup_point,
                file_creates: Mutex::new(0),
            },
        );
        assert!(
            matches!(
                result,
                ApplyFoundryProjectResult::Failed {
                    phase: FoundryApplyPhase::PreCommit,
                    cleanup_status: FoundryApplyCleanupStatus::NotVerified,
                    ..
                }
            ),
            "unexpected cleanup result at {cleanup_point}: {result:?}"
        );
        assert!(!prepared.parent.path().join("CleanupStatusMod").exists());
    }
}

#[test]
fn early_journal_cleanup_and_parent_sync_outcomes_fail_closed() {
    for (index, cleanup_point, expected_reason, expected_entries) in [
        (0, None, FoundryApplyFailureReason::JournalCreateFailed, 0),
        (
            1,
            Some("before-journal-cleanup"),
            FoundryApplyFailureReason::CleanupFailed,
            1,
        ),
        (
            2,
            Some("before-cleanup-parent-fsync"),
            FoundryApplyFailureReason::CleanupFailed,
            0,
        ),
    ] {
        let prepared = prepare(&format!("early-journal-{index}"), "EarlyJournalMod");
        let result = apply_with_faults(
            &prepared.state,
            prepared.request,
            &JournalSetupAndCleanupFault { cleanup_point },
        );
        assert_eq!(
            result,
            ApplyFoundryProjectResult::Failed {
                phase: FoundryApplyPhase::PreCommit,
                reason: expected_reason,
                cleanup_status: FoundryApplyCleanupStatus::NotVerified,
            }
        );
        assert_eq!(
            fs::read_dir(prepared.parent.path()).unwrap().count(),
            expected_entries
        );
    }
}

#[test]
fn verified_cleanup_gate_makes_malformed_positive_combinations_impossible() {
    let complete = CleanupOutcome {
        owned_artifacts_removed: true,
        verified_complete: true,
    };
    let reasons = [
        FoundryApplyFailureReason::JournalCreateFailed,
        FoundryApplyFailureReason::JournalSyncFailed,
        FoundryApplyFailureReason::StageCreateFailed,
        FoundryApplyFailureReason::StageWriteFailed,
        FoundryApplyFailureReason::StageVerifyFailed,
        FoundryApplyFailureReason::StageSyncFailed,
        FoundryApplyFailureReason::ParentSyncFailed,
        FoundryApplyFailureReason::AtomicCommitFailed,
        FoundryApplyFailureReason::CleanupFailed,
        FoundryApplyFailureReason::PostCommitParentSyncFailed,
        FoundryApplyFailureReason::PostCommitJournalFailed,
    ];
    for reason in reasons {
        let status = cleanup_status_for(ApplyError::Failed(reason), complete, true);
        assert_eq!(
            status,
            if reason == FoundryApplyFailureReason::StageWriteFailed {
                FoundryApplyCleanupStatus::VerifiedComplete
            } else {
                FoundryApplyCleanupStatus::NotVerified
            }
        );
    }
    assert_eq!(
        cleanup_status_for(
            ApplyError::Refused(FoundryApplyRefusalReason::SourceStale),
            complete,
            true,
        ),
        FoundryApplyCleanupStatus::NotVerified
    );
    assert_eq!(
        cleanup_status_for(
            ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed),
            complete,
            false
        ),
        FoundryApplyCleanupStatus::NotVerified
    );
    for malformed_cleanup in [
        CleanupOutcome {
            owned_artifacts_removed: true,
            verified_complete: false,
        },
        CleanupOutcome {
            owned_artifacts_removed: false,
            verified_complete: true,
        },
    ] {
        assert_eq!(
            cleanup_status_for(
                ApplyError::Failed(FoundryApplyFailureReason::StageWriteFailed),
                malformed_cleanup,
                true,
            ),
            FoundryApplyCleanupStatus::NotVerified
        );
    }
}

#[test]
fn postcommit_faults_never_rollback_and_preserve_recovery_journal() {
    for (index, (point, occurrence)) in [
        ("after-commit-before-parent-fsync", 1),
        ("before-journal-sync", 4),
        ("before-journal-remove", 1),
    ]
    .into_iter()
    .enumerate()
    {
        let prepared = prepare(&format!("postcommit-{index}"), "RecoveryMod");
        let result = apply_with_faults(
            &prepared.state,
            prepared.request.clone(),
            &FailAt::new(point, occurrence),
        );
        assert!(
            matches!(
                result,
                ApplyFoundryProjectResult::CreatedRecoveryRequired {
                    phase: FoundryApplyPostCommitPhase::PostCommit,
                    ..
                }
            ),
            "unexpected {result:?}"
        );
        assert_exact_output(&prepared.parent.path().join("RecoveryMod"), &prepared.files);
        let journal = fs::read_dir(prepared.parent.path())
            .expect("read recovery parent")
            .map(|entry| entry.expect("entry"))
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("foundry-journal")
            })
            .expect("recovery journal retained");
        assert_eq!(
            journal
                .metadata()
                .expect("journal metadata")
                .permissions()
                .mode()
                & 0o7777,
            0o600
        );
        let journal_json: serde_json::Value =
            serde_json::from_slice(&fs::read(journal.path()).expect("journal bytes"))
                .expect("journal JSON");
        assert!(matches!(
            journal_json["state"].as_str(),
            Some("ready" | "committed" | "committed-recovery-required")
        ));
    }
}

#[test]
fn atomic_destination_race_is_preserved_and_never_replaced() {
    let prepared = prepare("atomic-race", "RaceMod");
    let destination = prepared.parent.path().join("RaceMod");
    let result = apply_with_faults(
        &prepared.state,
        prepared.request,
        &CreateDestinationAtCommit(destination.clone()),
    );
    assert_eq!(
        result,
        ApplyFoundryProjectResult::Failed {
            phase: FoundryApplyPhase::PreCommit,
            reason: FoundryApplyFailureReason::AtomicCommitFailed,
            cleanup_status: FoundryApplyCleanupStatus::NotVerified,
        }
    );
    assert_eq!(fs::read(destination).unwrap(), b"external destination");
    assert_eq!(fs::read_dir(prepared.parent.path()).unwrap().count(), 1);
}

#[test]
fn unverified_tampered_stage_and_journal_are_preserved_for_recovery() {
    let prepared = prepare("tampered-stage", "TamperedMod");
    let stage = prepared.parent.path().join(format!(
        ".TamperedMod.foundry-stage-{}",
        prepared.request.approved_plan_digest
    ));
    let result = apply_with_faults(
        &prepared.state,
        prepared.request,
        &TamperOwnedStage(stage.clone()),
    );
    assert_eq!(
        result,
        ApplyFoundryProjectResult::Failed {
            phase: FoundryApplyPhase::PreCommit,
            reason: FoundryApplyFailureReason::CleanupFailed,
            cleanup_status: FoundryApplyCleanupStatus::NotVerified,
        }
    );
    assert_eq!(
        fs::read(stage.join("external-unknown")).unwrap(),
        b"preserve me"
    );
    assert_eq!(fs::read_dir(prepared.parent.path()).unwrap().count(), 2);
    assert!(!prepared.parent.path().join("TamperedMod").exists());
}

#[test]
fn pinned_object_change_during_staging_is_rerendered_and_refused_before_commit() {
    let prepared = prepare("mid-stage-source-stale", "MidStageMod");
    let tree = prepared.state.expected.tree.to_string();
    let object = prepared
        ._fixture
        .root_path()
        .join(".git/objects")
        .join(&tree[..2])
        .join(&tree[2..]);
    let result = apply_with_faults(
        &prepared.state,
        prepared.request,
        &RemovePinnedObject(object),
    );
    assert_eq!(result, refused(FoundryApplyRefusalReason::SourceStale));
    assert!(fs::read_dir(prepared.parent.path())
        .unwrap()
        .next()
        .is_none());
}

#[test]
fn external_regular_destination_refuses_before_transaction_and_consumes_apply_authority() {
    let prepared = prepare("req003-destination-present", "PresentMod");
    let request = prepared.request.clone();
    let operation_identity = request.operation_grant.identity.clone();
    let destination_grant_identity = request.destination_parent_grant.identity.clone();
    let destination = prepared.parent.path().join("PresentMod");
    let stage = prepared.parent.path().join(format!(
        ".PresentMod.foundry-stage-{}",
        request.approved_plan_digest
    ));
    let journal = prepared.parent.path().join(format!(
        ".PresentMod.foundry-journal-{}.json",
        request.approved_plan_digest
    ));
    let source_before = tree_snapshot(prepared._fixture.root_path());
    let source_root_before = fs::symlink_metadata(prepared._fixture.root_path()).unwrap();

    let external_bytes = b"scenario-owner-conflict\n";
    let mut external = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o640)
        .open(&destination)
        .expect("externally create exact destination file after render");
    external.write_all(external_bytes).unwrap();
    external.sync_all().unwrap();
    drop(external);
    fs::set_permissions(&destination, fs::Permissions::from_mode(0o640)).unwrap();

    let destination_before = fs::symlink_metadata(&destination).unwrap();
    assert!(destination_before.file_type().is_file());
    assert!(!destination_before.file_type().is_symlink());
    let destination_fingerprint = (
        destination_before.dev(),
        destination_before.ino(),
        destination_before.permissions().mode() & 0o7777,
        fs::read(&destination).unwrap(),
    );
    assert_eq!(destination_fingerprint.2, 0o640);
    assert_eq!(destination_fingerprint.3, external_bytes);
    assert_eq!(destination_fingerprint.3.len(), 24);
    assert_eq!(
        hex_digest(&destination_fingerprint.3),
        "492ba4c27678918c09572ce6be8cf2fec44f70f5033d29fc1b7f4230d5e0a1fb"
    );

    let parent_before = fs::symlink_metadata(prepared.parent.path()).unwrap();
    let parent_fingerprint = (
        parent_before.dev(),
        parent_before.ino(),
        parent_before.permissions().mode() & 0o7777,
        parent_before.nlink(),
        parent_before.uid(),
        parent_before.gid(),
        parent_before.len(),
        parent_before.mtime(),
        parent_before.mtime_nsec(),
        parent_before.ctime(),
        parent_before.ctime_nsec(),
    );
    let parent_tree = tree_snapshot(prepared.parent.path());
    assert_eq!(parent_tree.len(), 1);

    let before_rerender = FailAt::new("before-rerender", 1);
    assert_eq!(
        apply_with_faults(&prepared.state, request.clone(), &before_rerender),
        refused(FoundryApplyRefusalReason::DestinationPresent)
    );
    assert_eq!(*before_rerender.seen.lock().unwrap(), 0);

    let assert_preserved = || {
        let destination_after = fs::symlink_metadata(&destination).unwrap();
        assert!(destination_after.file_type().is_file());
        assert!(!destination_after.file_type().is_symlink());
        assert_eq!(
            (
                destination_after.dev(),
                destination_after.ino(),
                destination_after.permissions().mode() & 0o7777,
                fs::read(&destination).unwrap(),
            ),
            destination_fingerprint
        );
        let parent_after = fs::symlink_metadata(prepared.parent.path()).unwrap();
        assert_eq!(
            (
                parent_after.dev(),
                parent_after.ino(),
                parent_after.permissions().mode() & 0o7777,
                parent_after.nlink(),
                parent_after.uid(),
                parent_after.gid(),
                parent_after.len(),
                parent_after.mtime(),
                parent_after.mtime_nsec(),
                parent_after.ctime(),
                parent_after.ctime_nsec(),
            ),
            parent_fingerprint
        );
        assert_eq!(tree_snapshot(prepared.parent.path()), parent_tree);
        assert_eq!(tree_snapshot(prepared._fixture.root_path()), source_before);
        let source_root_after = fs::symlink_metadata(prepared._fixture.root_path()).unwrap();
        assert_eq!(source_root_after.dev(), source_root_before.dev());
        assert_eq!(source_root_after.ino(), source_root_before.ino());
        assert_eq!(
            source_root_after.permissions().mode() & 0o7777,
            source_root_before.permissions().mode() & 0o7777
        );
        assert!(stage.symlink_metadata().is_err());
        assert!(journal.symlink_metadata().is_err());
    };
    assert_preserved();

    let assert_apply_authority_consumed = || {
        let grants = prepared.state.grants.lock().unwrap();
        assert!(!grants
            .rendered_files_by_operation
            .contains_key(&operation_identity));
        assert!(!grants
            .operation_to_destination
            .contains_key(&operation_identity));
        assert!(grants
            .destination_grants
            .values()
            .all(|record| record.operation.is_none()));
        assert!(!grants
            .active_apply_destinations
            .contains(&destination_grant_identity));
        assert!(grants
            .consumed_operations
            .iter()
            .any(|identity| identity == &operation_identity));
    };
    assert_apply_authority_consumed();

    assert_eq!(
        apply_foundry_project(&prepared.state, request),
        refused(FoundryApplyRefusalReason::ApplyAuthorityConsumed)
    );
    assert_apply_authority_consumed();
    assert_preserved();
}

#[test]
fn digest_grant_source_destination_stage_and_journal_staleness_are_refused_once() {
    let mut digest = prepare("digest-refusal", "DigestMod");
    digest.request.approved_plan_digest = "0".repeat(64);
    assert_eq!(
        apply_foundry_project(&digest.state, digest.request.clone()),
        refused(FoundryApplyRefusalReason::ApprovedPlanDigestMismatched)
    );
    assert_eq!(
        apply_foundry_project(&digest.state, digest.request),
        refused(FoundryApplyRefusalReason::ApplyAuthorityConsumed)
    );

    let mut source_grant = prepare("source-grant-refusal", "GrantMod");
    source_grant.request.source_grant.kind = "other".into();
    assert_eq!(
        apply_foundry_project(&source_grant.state, source_grant.request),
        refused(FoundryApplyRefusalReason::SourceGrantMismatched)
    );

    let mut destination_grant = prepare("destination-grant-refusal", "ParentGrantMod");
    destination_grant.request.destination_parent_grant.kind = "other".into();
    assert_eq!(
        apply_foundry_project(&destination_grant.state, destination_grant.request),
        refused(FoundryApplyRefusalReason::DestinationParentGrantMismatched)
    );

    let mut operation_grant = prepare("operation-grant-refusal", "OperationMod");
    operation_grant.request.operation_grant.kind = "other".into();
    assert_eq!(
        apply_foundry_project(&operation_grant.state, operation_grant.request),
        refused(FoundryApplyRefusalReason::OperationGrantMismatched)
    );

    let present = prepare("destination-present", "PresentMod");
    fs::write(present.parent.path().join("PresentMod"), b"external").expect("external conflict");
    assert_eq!(
        apply_foundry_project(&present.state, present.request),
        refused(FoundryApplyRefusalReason::DestinationPresent)
    );
    assert_eq!(
        fs::read(present.parent.path().join("PresentMod")).unwrap(),
        b"external"
    );

    for conflict in ["stage", "journal"] {
        let prepared = prepare(&format!("{conflict}-conflict"), "ConflictMod");
        let name = if conflict == "stage" {
            format!(
                ".ConflictMod.foundry-stage-{}",
                prepared.request.approved_plan_digest
            )
        } else {
            format!(
                ".ConflictMod.foundry-journal-{}.json",
                prepared.request.approved_plan_digest
            )
        };
        fs::write(prepared.parent.path().join(&name), b"external conflict")
            .expect("create conflict");
        let expected = if conflict == "stage" {
            FoundryApplyRefusalReason::StageConflict
        } else {
            FoundryApplyRefusalReason::JournalConflict
        };
        assert_eq!(
            apply_foundry_project(&prepared.state, prepared.request),
            refused(expected)
        );
        assert_eq!(
            fs::read(prepared.parent.path().join(name)).unwrap(),
            b"external conflict"
        );
    }
}

#[test]
fn stale_pinned_source_and_replaced_parent_are_refused_without_mutation() {
    let source = prepare("stale-source", "StaleSourceMod");
    let object = source.state.expected.tree.to_string();
    let object_path = source
        ._fixture
        .root_path()
        .join(".git/objects")
        .join(&object[..2])
        .join(&object[2..]);
    fs::remove_file(object_path).expect("remove pinned tree");
    assert_eq!(
        apply_foundry_project(&source.state, source.request),
        refused(FoundryApplyRefusalReason::SourceStale)
    );
    assert!(fs::read_dir(source.parent.path()).unwrap().next().is_none());

    let parent = prepare("stale-parent", "StaleParentMod");
    let moved = parent.parent.path().with_extension("old");
    fs::rename(parent.parent.path(), &moved).expect("move selected parent");
    fs::create_dir(parent.parent.path()).expect("replace selected parent identity");
    assert_eq!(
        apply_foundry_project(&parent.state, parent.request),
        refused(FoundryApplyRefusalReason::DestinationParentStale)
    );
    assert!(fs::read_dir(parent.parent.path()).unwrap().next().is_none());
    fs::remove_dir(parent.parent.path()).expect("remove replacement parent");
    fs::rename(moved, parent.parent.path()).expect("restore parent for drop");
}

#[test]
fn concurrent_repeat_has_one_creator_and_one_consumed_refusal() {
    let prepared = prepare("concurrent-repeat", "ConcurrentMod");
    let state = Arc::new(prepared.state);
    let request = Arc::new(prepared.request.clone());
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let mut threads = Vec::new();
    for _ in 0..2 {
        let state = Arc::clone(&state);
        let request = Arc::clone(&request);
        let barrier = Arc::clone(&barrier);
        threads.push(std::thread::spawn(move || {
            barrier.wait();
            apply_foundry_project(&state, (*request).clone())
        }));
    }
    barrier.wait();
    let results = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, ApplyFoundryProjectResult::Created { .. }))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| **result == refused(FoundryApplyRefusalReason::ApplyAuthorityConsumed))
            .count(),
        1
    );
    assert_exact_output(
        &prepared.parent.path().join("ConcurrentMod"),
        &prepared.files,
    );
}

#[test]
#[ignore = "opt-in: set IDE_EMPT_V1_4_REPOSITORY to the exact local pinned repository"]
fn local_empt_fixture_and_mod_1_are_actually_created_exactly() {
    let repository =
        PathBuf::from(std::env::var("IDE_EMPT_V1_4_REPOSITORY").expect("local EMPT path"))
            .canonicalize()
            .expect("canonical EMPT path");
    let source_before = tree_snapshot(&repository);
    let parent = TestDirectory::new("local-apply-parent");
    for mod_id in ["FoundryPreviewFixture", "Mod_1"] {
        let state = Xcom2ProjectFoundryState::default();
        let source = authorize_source_repository(
            &state,
            crate::commands::xcom2_project_foundry::AuthorizeFoundrySourceRepositoryRequest {
                selected_root: repository.to_string_lossy().to_string(),
            },
        )
        .expect("authorize local EMPT");
        let destination = authorize_destination_parent_selection(
            &state,
            AuthorizeFoundryDestinationParentSelectionRequest {
                selected_root: parent.string(),
            },
        )
        .expect("authorize local parent");
        let (operation, plan) = match render_preview(
            &state,
            RenderFoundryPreviewRequest {
                source_grant: source.clone(),
                destination_parent_grant: destination.clone(),
                mod_id: mod_id.into(),
            },
        ) {
            RenderFoundryPreviewResult::Rendered {
                operation_grant,
                plan_body,
            } => (operation_grant, plan_body),
            result => panic!("local render failed: {result:?}"),
        };
        let digest = canonical_plan_digest(&plan).unwrap();
        let retained = state
            .grants
            .lock()
            .unwrap()
            .rendered_files_by_operation
            .get(&operation.identity)
            .unwrap()
            .clone();
        let result = apply_foundry_project(
            &state,
            ApplyFoundryProjectRequest {
                schema_version: 1,
                source_grant: source,
                destination_parent_grant: destination,
                operation_grant: operation,
                mod_id: mod_id.into(),
                approved_plan_digest: digest,
            },
        );
        assert!(matches!(result, ApplyFoundryProjectResult::Created { .. }));
        assert_exact_output(&parent.path().join(mod_id), &retained);
    }
    assert_eq!(tree_snapshot(&repository), source_before);
    let mut roots = fs::read_dir(parent.path())
        .expect("read local apply parent")
        .map(|entry| {
            entry
                .expect("local output")
                .file_name()
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<_>>();
    roots.sort();
    assert_eq!(roots, ["FoundryPreviewFixture", "Mod_1"]);
}

fn assert_exact_output(destination: &Path, expected: &[FoundryRenderedOutputFile]) {
    let snapshot = tree_snapshot(destination);
    assert_eq!(
        snapshot
            .values()
            .filter(|entry| entry.0 == "directory")
            .count()
            + 1,
        12
    );
    assert_eq!(
        snapshot.values().filter(|entry| entry.0 == "file").count(),
        27
    );
    assert!(!snapshot.values().any(|entry| entry.0 == "symlink"));
    assert_eq!(
        fs::symlink_metadata(destination)
            .unwrap()
            .permissions()
            .mode()
            & 0o7777,
        0o755
    );
    for entry in snapshot.values().filter(|entry| entry.0 == "directory") {
        assert_eq!(entry.1 & 0o7777, 0o755);
    }
    for file in expected {
        let entry = snapshot
            .get(&file.path)
            .unwrap_or_else(|| panic!("missing {}", file.path));
        assert_eq!(entry.0, "file");
        assert_eq!(entry.1 & 0o7777, 0o644);
        assert_eq!(entry.2, file.bytes);
    }
}

fn identity_snapshot(root: &Path) -> BTreeMap<String, (String, u64, u64, u32, u64)> {
    fn visit(
        root: &Path,
        directory: &Path,
        out: &mut BTreeMap<String, (String, u64, u64, u32, u64)>,
    ) {
        let mut entries = fs::read_dir(directory)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .to_string();
            let metadata = fs::symlink_metadata(&path).unwrap();
            let kind = if metadata.file_type().is_symlink() {
                "symlink"
            } else if metadata.is_dir() {
                "directory"
            } else {
                "file"
            };
            out.insert(
                relative,
                (
                    kind.into(),
                    metadata.dev(),
                    metadata.ino(),
                    metadata.permissions().mode() & 0o7777,
                    metadata.len(),
                ),
            );
            if metadata.is_dir() {
                visit(root, &path, out);
            }
        }
    }
    let mut output = BTreeMap::new();
    visit(root, root, &mut output);
    output
}

fn tree_snapshot(root: &Path) -> BTreeMap<String, (String, u32, Vec<u8>)> {
    fn visit(root: &Path, directory: &Path, out: &mut BTreeMap<String, (String, u32, Vec<u8>)>) {
        let mut entries = fs::read_dir(directory)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .to_string();
            let metadata = fs::symlink_metadata(&path).unwrap();
            let kind = if metadata.file_type().is_symlink() {
                "symlink"
            } else if metadata.is_dir() {
                "directory"
            } else {
                "file"
            };
            let bytes = if metadata.is_file() {
                fs::read(&path).unwrap()
            } else if metadata.file_type().is_symlink() {
                fs::read_link(&path)
                    .unwrap()
                    .to_string_lossy()
                    .as_bytes()
                    .to_vec()
            } else {
                Vec::new()
            };
            out.insert(
                relative,
                (kind.into(), metadata.permissions().mode(), bytes),
            );
            if metadata.is_dir() {
                visit(root, &path, out);
            }
        }
    }
    let mut output = BTreeMap::new();
    visit(root, root, &mut output);
    output
}
