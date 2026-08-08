use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::state::Authority;
use super::*;
use crate::commands::workspace_registry::{
    ensure_workspace_at, read_registry_at, workspace_id_for_path, WorkspaceMarker,
};
use crate::commands::xcom2_module_evidence::{Xcom2ModuleScanLimits, REQUIRED_LIMITS};

const CANARY: &str = "RUST_BUILD_RECIPE_CANARY_MUST_NOT_RUN";
const NOTICE: &str = "Synthetic fixture derived from X2ModBuildCommon concepts. Applicable attribution: X2ModBuildCommon contributors; licensed under MIT.";

struct Fixture {
    root: PathBuf,
    registry_home: PathBuf,
    registry_path: PathBuf,
    workspace_id: String,
    process_canary: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        Self::new_with_workspace_id(label, None)
    }

    fn new_with_workspace_id(label: &str, persisted_workspace_id: Option<&str>) -> Self {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let unique = format!(
            "ide-xcom2-native-activation-{label}-{nonce}-{}",
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        );
        let root = std::env::temp_dir().join(&unique);
        let registry_home = std::env::temp_dir().join(format!("{unique}-registry"));
        let registry_path = registry_home.join("workspaces.json");
        let module = root.join("Mods/RecipeFixture");
        fs::create_dir_all(root.join(".ide")).expect("create .ide");
        fs::create_dir_all(&registry_home).expect("create registry home");
        fs::create_dir_all(module.join(".scripts")).expect("create scripts");
        fs::create_dir_all(module.join("Highlander/XComGame")).expect("create Highlander source");
        let root = root.canonicalize().expect("canonical fixture");
        if let Some(workspace_id) = persisted_workspace_id {
            let marker = WorkspaceMarker {
                id: workspace_id.to_string(),
                path: root.to_string_lossy().to_string(),
                name: label.to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            };
            fs::write(
                root.join(".ide/workspace.json"),
                serde_json::to_vec_pretty(&marker).expect("serialize persisted marker"),
            )
            .expect("write persisted marker");
        }
        let workspace_id = ensure_workspace_at(&root, &registry_path)
            .expect("register fixture workspace")
            .id;
        fs::write(
            root.join(".ide/xcom2.json"),
            br#"{"version":1,"target":"wotc","moduleRoots":["Mods/RecipeFixture"]}"#,
        )
        .expect("write activation-only configuration");
        fs::write(module.join("RecipeFixture.x2proj"), b"synthetic descriptor")
            .expect("write x2proj");
        fs::write(
            module.join("RecipeFixture.XComMod"),
            b"synthetic descriptor",
        )
        .expect("write XComMod");
        let process_canary = root.join("process-canary-must-not-exist");
        fs::write(
            module.join(".scripts/build.ps1"),
            format!("# {CANARY}\n# touch {}\n", process_canary.display()),
        )
        .expect("write inert script");
        fs::write(
            module.join(".scripts/X2ModBuildCommon.NOTICE.txt"),
            format!("{NOTICE}\n"),
        )
        .expect("write synthetic notice");
        Self {
            root,
            registry_home,
            registry_path,
            workspace_id,
            process_canary,
        }
    }

    fn request(&self) -> BeginActivationEvidenceRequest {
        BeginActivationEvidenceRequest {
            workspace_id: self.workspace_id.clone(),
            workspace_generation: 7,
            scan_id: "xcom2-module-scan:fixture".to_string(),
            scan_generation: 5,
            configuration_read_id: "xcom2-configuration-read:fixture".to_string(),
            limits: REQUIRED_LIMITS,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::remove_dir_all(&self.registry_home);
    }
}

fn begin_fixture(
    fixture: &Fixture,
    state: &Xcom2NativeActivationState,
) -> NativeActivationCandidate {
    application::begin_with_registry(
        state,
        &fixture.root,
        &fixture.registry_path,
        fixture.request(),
    )
    .expect("begin activation")
}

fn acknowledge_fixture(
    candidate: &NativeActivationCandidate,
    state: &Xcom2NativeActivationState,
) -> AcknowledgmentDecision {
    let handles = candidate
        .scan
        .evidence_handles
        .iter()
        .chain(&candidate.configuration.evidence_handles)
        .map(|entry| entry.evidence_handle.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    application::acknowledge(
        state,
        ActivationAcknowledgment {
            activation_attempt_receipt: candidate.scan.activation_attempt_receipt.clone(),
            evidence_handles: handles,
        },
    )
}

#[test]
fn red_to_green_native_attempt_correlates_scan_configuration_and_random_handles() {
    let fixture = Fixture::new("correlation");
    let state = Xcom2NativeActivationState::default();

    let first = begin_fixture(&fixture, &state);
    let second = begin_fixture(&fixture, &state);

    assert_eq!(first.scan.activation_generation, 1);
    assert_eq!(second.scan.activation_generation, 2);
    assert_eq!(
        second.scan.activation_attempt_receipt,
        second.configuration.activation_attempt_receipt
    );
    assert_ne!(
        first.scan.activation_attempt_receipt,
        second.scan.activation_attempt_receipt
    );
    let scan_handle = &second.scan.evidence_handles[0].evidence_handle;
    let configuration_handle = &second.configuration.evidence_handles[0].evidence_handle;
    assert_eq!(scan_handle, configuration_handle);
    assert_ne!(scan_handle, &first.scan.evidence_handles[0].evidence_handle);
    assert!(scan_handle.len() <= 256);
    assert!(!scan_handle.contains("Mods/RecipeFixture"));
}

#[test]
fn registry_binding_accepts_persisted_marker_and_fallback_ids_but_refuses_mismatch() {
    let persisted_id = "story-credible-wotc";
    let persisted = Fixture::new_with_workspace_id("persisted-id", Some(persisted_id));
    assert_ne!(persisted_id, workspace_id_for_path(&persisted.root));
    let state = Xcom2NativeActivationState::default();
    let candidate = begin_fixture(&persisted, &state);
    assert_eq!(candidate.scan.workspace_id, persisted_id);
    assert_eq!(candidate.configuration.workspace_id, persisted_id);
    assert!(candidate
        .scan
        .activation_attempt_receipt
        .starts_with("xcom2-attempt:"));
    assert!(candidate.scan.evidence_handles[0]
        .evidence_handle
        .starts_with("xcom2-evidence:"));
    assert!(matches!(
        acknowledge_fixture(&candidate, &state),
        AcknowledgmentDecision::Acknowledged { .. }
    ));
    let recipe = application::inspect(
        &state,
        BuildRecipeInspectionRequest {
            workspace_id: persisted_id.to_string(),
            generation: 7,
            module_root: "Mods/RecipeFixture".to_string(),
        },
    )
    .expect("inspect persisted-id workspace");
    assert_eq!(recipe.workspace.id, persisted_id);
    assert_eq!(recipe.workspace.generation, 7);

    let fallback = Fixture::new("fallback-id");
    assert_eq!(fallback.workspace_id, workspace_id_for_path(&fallback.root));
    begin_fixture(&fallback, &Xcom2NativeActivationState::default());

    let mut unknown = persisted.request();
    unknown.workspace_id = "caller-controlled-workspace".to_string();
    assert_eq!(
        application::begin_with_registry(
            &state,
            &persisted.root,
            &persisted.registry_path,
            unknown,
        ),
        Err("workspace-identity-mismatch".to_string())
    );
    assert!(matches!(
        state.inner.lock().expect("state lock").authority,
        Authority::Revoked(ActivationRevocationCode::MixedActivationAttempt)
    ));
}

#[test]
fn registry_binding_refuses_stale_current_id_root_mismatch_and_post_begin_change() {
    let stale = Fixture::new("stale-current");
    let mut stale_registry = read_registry_at(&stale.registry_path).expect("read registry");
    stale_registry.current_workspace_id = Some("workspace-no-longer-registered".to_string());
    fs::write(
        &stale.registry_path,
        serde_json::to_vec_pretty(&stale_registry).expect("serialize stale registry"),
    )
    .expect("write stale registry");
    assert_eq!(
        application::begin_with_registry(
            &Xcom2NativeActivationState::default(),
            &stale.root,
            &stale.registry_path,
            stale.request(),
        ),
        Err("workspace-authority-unavailable".to_string())
    );

    let mismatch = Fixture::new("root-mismatch");
    let other_root = mismatch.registry_home.join("other-root");
    fs::create_dir(&other_root).expect("create other root");
    let mut mismatch_registry = read_registry_at(&mismatch.registry_path).expect("read registry");
    mismatch_registry.workspaces[0].root_path = other_root.to_string_lossy().to_string();
    fs::write(
        &mismatch.registry_path,
        serde_json::to_vec_pretty(&mismatch_registry).expect("serialize mismatched registry"),
    )
    .expect("write mismatched registry");
    assert_eq!(
        application::begin_with_registry(
            &Xcom2NativeActivationState::default(),
            &mismatch.root,
            &mismatch.registry_path,
            mismatch.request(),
        ),
        Err("workspace-authority-unavailable".to_string())
    );

    let changed = Fixture::new_with_workspace_id("changed-current", Some("persisted-current"));
    let state = Xcom2NativeActivationState::default();
    let candidate = begin_fixture(&changed, &state);
    let mut changed_registry = read_registry_at(&changed.registry_path).expect("read registry");
    changed_registry.current_workspace_id = None;
    fs::write(
        &changed.registry_path,
        serde_json::to_vec_pretty(&changed_registry).expect("serialize changed registry"),
    )
    .expect("write changed registry");
    assert!(matches!(
        acknowledge_fixture(&candidate, &state),
        AcknowledgmentDecision::Refused {
            code: AcknowledgmentRefusalCode::StaleCorrelation,
            ..
        }
    ));
}

#[test]
fn acknowledgment_accepts_only_exact_unique_strong_handles_and_materializes_roots() {
    let fixture = Fixture::new("acknowledge");
    let state = Xcom2NativeActivationState::default();
    let candidate = begin_fixture(&fixture, &state);

    let decision = acknowledge_fixture(&candidate, &state);

    let AcknowledgmentDecision::Acknowledged {
        acknowledgment,
        state: ActivationEvidenceState::Acknowledged {
            selected_modules, ..
        },
    } = decision
    else {
        panic!("expected acknowledged authority");
    };
    assert_eq!(acknowledgment.evidence_handles.len(), 1);
    assert_eq!(selected_modules.len(), 1);
    assert_eq!(selected_modules[0].module_root, "Mods/RecipeFixture");
    assert_eq!(
        selected_modules[0].evidence_handle,
        acknowledgment.evidence_handles[0]
    );
}

#[test]
fn acknowledgment_rejects_stale_duplicate_unknown_incomplete_and_weak_evidence() {
    let fixture = Fixture::new("refusals");
    let state = Xcom2NativeActivationState::default();
    let candidate = begin_fixture(&fixture, &state);
    let handle = candidate.scan.evidence_handles[0].evidence_handle.clone();

    for (acknowledgment, expected) in [
        (
            ActivationAcknowledgment {
                activation_attempt_receipt: "xcom2-attempt:stale".to_string(),
                evidence_handles: vec![handle.clone()],
            },
            AcknowledgmentRefusalCode::StaleCorrelation,
        ),
        (
            ActivationAcknowledgment {
                activation_attempt_receipt: candidate.scan.activation_attempt_receipt.clone(),
                evidence_handles: vec![handle.clone(), handle.clone()],
            },
            AcknowledgmentRefusalCode::DuplicateEvidenceHandle,
        ),
        (
            ActivationAcknowledgment {
                activation_attempt_receipt: candidate.scan.activation_attempt_receipt.clone(),
                evidence_handles: vec!["xcom2-evidence:unknown".to_string()],
            },
            AcknowledgmentRefusalCode::UnknownEvidenceHandle,
        ),
    ] {
        assert!(matches!(
            application::acknowledge(&state, acknowledgment),
            AcknowledgmentDecision::Refused { code, .. } if code == expected
        ));
    }

    let partial_fixture = Fixture::new("partial");
    let partial_state = Xcom2NativeActivationState::default();
    let candidate = begin_fixture(&partial_fixture, &partial_state);
    {
        let mut inner = partial_state.inner.lock().expect("state lock");
        let Authority::Pending(pending) = &mut inner.authority else {
            unreachable!();
        };
        pending.candidate.scan.completeness =
            crate::commands::xcom2_module_evidence::Xcom2ModuleScanCompleteness::Partial;
        pending.candidate.scan.issues.push(crate::commands::xcom2_module_evidence::Xcom2ModuleScanIssue {
            kind: crate::commands::xcom2_module_evidence::Xcom2ModuleScanIssueKind::UnreadableSubtree,
            relative_path: "Mods".to_string(),
        });
    }
    assert!(matches!(
        acknowledge_fixture(&candidate, &partial_state),
        AcknowledgmentDecision::Refused {
            code: AcknowledgmentRefusalCode::IncompleteEvidence,
            ..
        }
    ));

    let weak_state = Xcom2NativeActivationState::default();
    let weak_candidate = begin_fixture(&fixture, &weak_state);
    {
        let mut inner = weak_state.inner.lock().expect("state lock");
        let Authority::Pending(pending) = &mut inner.authority else {
            unreachable!();
        };
        for module in pending.modules.values_mut() {
            module.strong = false;
            module.configured = false;
        }
    }
    assert!(matches!(
        acknowledge_fixture(&weak_candidate, &weak_state),
        AcknowledgmentDecision::Refused {
            code: AcknowledgmentRefusalCode::WeakEvidence,
            ..
        }
    ));

    let inactive_state = Xcom2NativeActivationState::default();
    let inactive_candidate = begin_fixture(&fixture, &inactive_state);
    {
        let mut inner = inactive_state.inner.lock().expect("state lock");
        let Authority::Pending(pending) = &mut inner.authority else {
            unreachable!();
        };
        pending.modules.clear();
    }
    assert!(matches!(
        application::acknowledge(
            &inactive_state,
            ActivationAcknowledgment {
                activation_attempt_receipt: inactive_candidate.scan.activation_attempt_receipt,
                evidence_handles: Vec::new(),
            },
        ),
        AcknowledgmentDecision::Refused {
            code: AcknowledgmentRefusalCode::Inactive,
            ..
        }
    ));
}

#[test]
fn every_lifecycle_boundary_revokes_and_cached_state_cannot_restore_authority() {
    for event in [
        ActivationLifecycleEvent::WorkspaceRefresh,
        ActivationLifecycleEvent::WorkspaceSwitchStarted,
        ActivationLifecycleEvent::WorkspaceActivationStarted,
        ActivationLifecycleEvent::WorkspaceActivationFailed,
        ActivationLifecycleEvent::ActivationAttemptFailed,
        ActivationLifecycleEvent::AppExit,
        ActivationLifecycleEvent::CachedReactRestoration,
    ] {
        let fixture = Fixture::new("revoke");
        let state = Xcom2NativeActivationState::default();
        let candidate = begin_fixture(&fixture, &state);
        assert!(matches!(
            acknowledge_fixture(&candidate, &state),
            AcknowledgmentDecision::Acknowledged { .. }
        ));
        assert!(matches!(
            application::transition(&state, event),
            ActivationLifecycleDecision::Revoked {
                state: ActivationEvidenceState::Revoked { .. }
            }
        ));
        assert!(matches!(
            acknowledge_fixture(&candidate, &state),
            AcknowledgmentDecision::Refused {
                code: AcknowledgmentRefusalCode::AuthorityUnavailable,
                ..
            }
        ));
    }
}

#[test]
fn newer_generation_revokes_but_equal_or_older_notification_retains() {
    let fixture = Fixture::new("generation");
    let state = Xcom2NativeActivationState::default();
    begin_fixture(&fixture, &state);
    assert!(matches!(
        application::transition(
            &state,
            ActivationLifecycleEvent::NewerActivationGeneration {
                activation_generation: 1
            },
        ),
        ActivationLifecycleDecision::Retained { .. }
    ));
    assert!(matches!(
        application::transition(
            &state,
            ActivationLifecycleEvent::NewerActivationGeneration {
                activation_generation: 2
            },
        ),
        ActivationLifecycleDecision::Revoked { .. }
    ));
}

#[test]
fn scenario_like_fixture_inspection_is_metadata_only_read_only_and_never_runs_canary() {
    let fixture = Fixture::new("inspection");
    let state = Xcom2NativeActivationState::default();
    let candidate = begin_fixture(&fixture, &state);
    assert!(matches!(
        acknowledge_fixture(&candidate, &state),
        AcknowledgmentDecision::Acknowledged { .. }
    ));
    let before = tree_snapshot(&fixture.root);

    let recipe = application::inspect(
        &state,
        BuildRecipeInspectionRequest {
            workspace_id: fixture.request().workspace_id,
            generation: 7,
            module_root: "Mods/RecipeFixture".to_string(),
        },
    )
    .expect("inspect blocked recipe");

    assert_eq!(recipe.action, "default");
    assert_eq!(recipe.script.relative_path, ".scripts/build.ps1");
    assert_eq!(recipe.script.sha256.len(), 64);
    assert!(recipe.script.byte_size > 0);
    assert_eq!(recipe.provenance.project, "X2ModBuildCommon");
    assert_eq!(recipe.provenance.license, "MIT");
    assert_eq!(recipe.arguments.len(), 7);
    assert_eq!(recipe.unresolved_prerequisites.len(), 5);
    assert!(recipe.execution_blocked);
    assert_eq!(tree_snapshot(&fixture.root), before);
    assert!(
        !fixture.process_canary.exists(),
        "project script was invoked"
    );

    let serialized = serde_json::to_string(&recipe).expect("serialize recipe");
    for forbidden in [
        fixture.root.to_string_lossy().as_ref(),
        CANARY,
        "scriptBytes",
        "command",
        "executable",
        "sdkPath",
        "gamePath",
        "prefixPath",
        "success",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "leaked forbidden value: {forbidden}"
        );
    }
}

#[cfg(unix)]
#[test]
fn inspection_refuses_module_script_notice_and_dependency_symlinks() {
    use std::os::unix::fs::symlink;

    for target in ["module", "script", "notice", "dependency"] {
        let fixture = Fixture::new(target);
        let state = Xcom2NativeActivationState::default();
        let candidate = begin_fixture(&fixture, &state);
        assert!(matches!(
            acknowledge_fixture(&candidate, &state),
            AcknowledgmentDecision::Acknowledged { .. }
        ));
        let module = fixture.root.join("Mods/RecipeFixture");
        match target {
            "module" => {
                fs::rename(&module, fixture.root.join("Mods/RealFixture")).expect("move module");
                symlink("RealFixture", &module).expect("link module");
            }
            "script" => replace_with_symlink(&module.join(".scripts/build.ps1")),
            "notice" => replace_with_symlink(&module.join(".scripts/X2ModBuildCommon.NOTICE.txt")),
            "dependency" => {
                fs::remove_dir(module.join("Highlander/XComGame")).expect("remove dependency");
                symlink(".", module.join("Highlander/XComGame")).expect("link dependency");
            }
            _ => unreachable!(),
        }
        assert!(application::inspect(
            &state,
            BuildRecipeInspectionRequest {
                workspace_id: fixture.request().workspace_id,
                generation: 7,
                module_root: "Mods/RecipeFixture".to_string(),
            },
        )
        .is_err());
        assert!(!fixture.process_canary.exists());
    }
}

#[cfg(unix)]
fn replace_with_symlink(path: &Path) {
    let target = path.with_extension("real");
    fs::rename(path, &target).expect("move regular file");
    std::os::unix::fs::symlink(&target, path).expect("create symlink");
}

#[test]
fn exact_serde_requests_fail_closed_on_extra_authority_fields() {
    let exact = serde_json::json!({
        "workspaceId": "ws-0123456789abcdef",
        "workspaceGeneration": 7,
        "scanId": "scan:7",
        "scanGeneration": 3,
        "configurationReadId": "configuration:7",
        "limits": { "maximumDepth": 8, "maximumEncounteredEntries": 20_000 }
    });
    assert!(serde_json::from_value::<BeginActivationEvidenceRequest>(exact.clone()).is_ok());
    let mut extra = exact;
    extra["root"] = serde_json::json!("/forged");
    assert!(serde_json::from_value::<BeginActivationEvidenceRequest>(extra).is_err());

    let request = serde_json::json!({
        "workspaceId": "ws-0123456789abcdef",
        "generation": 7,
        "moduleRoot": "Mods/RecipeFixture"
    });
    assert!(serde_json::from_value::<BuildRecipeInspectionRequest>(request.clone()).is_ok());
    let mut extra = request;
    extra["evidenceHandle"] = serde_json::json!("forged");
    assert!(serde_json::from_value::<BuildRecipeInspectionRequest>(extra).is_err());

    let acknowledgment = serde_json::json!({
        "activationAttemptReceipt": "attempt",
        "evidenceHandles": ["evidence"]
    });
    assert!(serde_json::from_value::<ActivationAcknowledgment>(acknowledgment.clone()).is_ok());
    let mut extra = acknowledgment;
    extra["moduleRoot"] = serde_json::json!("Mods/Forged");
    assert!(serde_json::from_value::<ActivationAcknowledgment>(extra).is_err());
}

#[test]
fn command_facade_is_thin_signatures_are_closed_and_registration_is_present() {
    let facade = include_str!("../xcom2_native_activation.rs");
    assert!(!facade.contains("std::fs"));
    assert!(!facade.contains("std::process"));
    assert!(!facade.contains("Command::new"));
    assert!(facade.lines().count() < 80);

    let _begin: fn(
        &Xcom2NativeActivationState,
        &Path,
        BeginActivationEvidenceRequest,
    ) -> Result<NativeActivationCandidate, String> = application::begin;
    let _acknowledge: fn(
        &Xcom2NativeActivationState,
        ActivationAcknowledgment,
    ) -> AcknowledgmentDecision = application::acknowledge;
    let _inspect: fn(
        &Xcom2NativeActivationState,
        BuildRecipeInspectionRequest,
    ) -> Result<BuildRecipeCandidate, String> = application::inspect;

    let lib = include_str!("../../lib.rs");
    for required in [
        ".manage(commands::xcom2_native_activation::Xcom2NativeActivationState::default())",
        "commands::xcom2_native_activation::begin_xcom2_native_activation_evidence",
        "commands::xcom2_native_activation::acknowledge_xcom2_native_activation_evidence",
        "commands::xcom2_native_activation::revoke_xcom2_native_activation_evidence",
        "commands::xcom2_native_activation::inspect_xcom2_project_build_recipe",
    ] {
        assert!(lib.contains(required), "missing registration: {required}");
    }
}

fn tree_snapshot(root: &Path) -> BTreeMap<String, (String, Vec<u8>)> {
    fn visit(root: &Path, directory: &Path, entries: &mut BTreeMap<String, (String, Vec<u8>)>) {
        let mut children = fs::read_dir(directory)
            .expect("read fixture")
            .collect::<Result<Vec<_>, _>>()
            .expect("read fixture entries");
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            let path = child.path();
            let relative = path
                .strip_prefix(root)
                .expect("relative path")
                .to_string_lossy()
                .replace('\\', "/");
            let metadata = fs::symlink_metadata(&path).expect("metadata");
            if metadata.is_dir() {
                entries.insert(relative, ("directory".to_string(), Vec::new()));
                visit(root, &path, entries);
            } else if metadata.is_file() {
                entries.insert(
                    relative,
                    ("regular-file".to_string(), fs::read(path).expect("bytes")),
                );
            } else {
                entries.insert(relative, ("other".to_string(), Vec::new()));
            }
        }
    }
    let mut entries = BTreeMap::new();
    visit(root, root, &mut entries);
    entries
}

#[test]
fn required_scanner_limits_remain_exact() {
    assert_eq!(
        REQUIRED_LIMITS,
        Xcom2ModuleScanLimits {
            maximum_depth: 8,
            maximum_encountered_entries: 20_000,
        }
    );
}
