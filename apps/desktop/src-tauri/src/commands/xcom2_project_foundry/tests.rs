use super::*;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) struct TestDirectory(PathBuf);

impl TestDirectory {
    pub(super) fn new(label: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ide-foundry-native-{label}-{nonce}-{}",
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).expect("create test directory");
        Self(path.canonicalize().expect("canonical test directory"))
    }

    pub(super) fn string(&self) -> String {
        self.0.to_str().expect("UTF-8 test path").to_string()
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct RepositoryFixture {
    root: TestDirectory,
    commit: Oid,
    tree: Oid,
    blob: Oid,
}

impl RepositoryFixture {
    fn new(label: &str) -> Self {
        let root = TestDirectory::new(label);
        let repository = Repository::init(&root.0).expect("initialize fixture repository");
        fs::create_dir(root.0.join("nested")).expect("create nested source");
        fs::write(root.0.join("tracked.txt"), b"committed bytes\n").expect("write tracked fixture");
        fs::write(root.0.join("nested/blob.bin"), b"blob bytes").expect("write nested fixture");
        let mut index = repository.index().expect("open fixture index");
        index
            .add_path(Path::new("tracked.txt"))
            .expect("add tracked fixture");
        index
            .add_path(Path::new("nested/blob.bin"))
            .expect("add nested fixture");
        index.write().expect("write fixture index");
        let tree_oid = index.write_tree().expect("write fixture tree");
        let tree = repository.find_tree(tree_oid).expect("find fixture tree");
        let nested = repository
            .find_tree(tree.get_name("nested").expect("nested tree").id())
            .expect("find nested tree");
        let blob = nested.get_name("blob.bin").expect("fixture blob").id();
        let signature = git2::Signature::new(
            "Foundry Test",
            "foundry@example.invalid",
            &git2::Time::new(1, 0),
        )
        .expect("fixture signature");
        let commit = repository
            .commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .expect("commit fixture");
        drop(nested);
        drop(tree);
        drop(repository);
        Self {
            root,
            commit,
            tree: tree_oid,
            blob,
        }
    }

    fn state(&self) -> Xcom2ProjectFoundryState {
        Xcom2ProjectFoundryState::with_expected_object_ids(
            &self.commit.to_string(),
            &self.tree.to_string(),
        )
        .expect("fixture expected identity")
    }

    fn source_request(&self) -> AuthorizeFoundrySourceRepositoryRequest {
        AuthorizeFoundrySourceRepositoryRequest {
            selected_root: self.root.string(),
        }
    }
}

pub(super) struct RendererRepositoryFixture {
    root: TestDirectory,
    commit: Oid,
    tree: Oid,
    blobs: HashMap<String, Oid>,
}

impl RendererRepositoryFixture {
    pub(super) fn new(label: &str, symlink_source: Option<&str>, malformed_project: bool) -> Self {
        let root = TestDirectory::new(label);
        let repository = Repository::init(&root.0).expect("initialize renderer repository");
        for path in renderer::required_source_paths() {
            let destination = root.0.join(path);
            fs::create_dir_all(destination.parent().expect("source parent"))
                .expect("create source parent");
            let bytes = if path == "ProjectTemplate.x2proj" {
                if malformed_project {
                    b"not a project\n".to_vec()
                } else {
                    synthetic_project_source()
                }
            } else if path == "ModPreview.jpg" {
                vec![0xff, 0xd8, 0xff, 0xd9]
            } else if path == ".gitignore" {
                b"*.lnk\nBuildCache/".to_vec()
            } else {
                format!("synthetic {path}: $guid1$ $Name$ $ModSafeName$ $Description$\n")
                    .into_bytes()
            };
            fs::write(destination, bytes).expect("write renderer source");
        }
        #[cfg(target_os = "linux")]
        if let Some(path) = symlink_source {
            use std::os::unix::fs::symlink;
            let destination = root.0.join(path);
            fs::remove_file(&destination).expect("remove regular source before symlink");
            symlink("missing-synthetic-source", destination).expect("create source symlink");
        }
        #[cfg(not(target_os = "linux"))]
        assert!(symlink_source.is_none());

        let mut index = repository.index().expect("open renderer index");
        for path in renderer::required_source_paths() {
            index
                .add_path(Path::new(path))
                .expect("add required renderer source");
        }
        index.write().expect("write renderer index");
        let tree_oid = index.write_tree().expect("write renderer tree");
        let tree = repository.find_tree(tree_oid).expect("find renderer tree");
        let blobs = renderer::required_source_paths()
            .into_iter()
            .map(|path| {
                let oid = tree
                    .get_path(Path::new(path))
                    .expect("required source entry")
                    .id();
                (path.to_string(), oid)
            })
            .collect();
        let signature = git2::Signature::new(
            "Foundry Renderer Test",
            "renderer@example.invalid",
            &git2::Time::new(2, 0),
        )
        .expect("renderer signature");
        let commit = repository
            .commit(Some("HEAD"), &signature, &signature, "renderer", &tree, &[])
            .expect("commit renderer fixture");
        drop(tree);
        drop(repository);
        Self {
            root,
            commit,
            tree: tree_oid,
            blobs,
        }
    }

    pub(super) fn state(&self) -> Xcom2ProjectFoundryState {
        Xcom2ProjectFoundryState::with_expected_object_ids(
            &self.commit.to_string(),
            &self.tree.to_string(),
        )
        .expect("renderer expected identity")
    }

    pub(super) fn source_request(&self) -> AuthorizeFoundrySourceRepositoryRequest {
        AuthorizeFoundrySourceRepositoryRequest {
            selected_root: self.root.string(),
        }
    }

    pub(super) fn root_path(&self) -> &Path {
        self.root.path()
    }
}

fn synthetic_project_source() -> Vec<u8> {
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<Project>
	<PropertyGroup>
		<Guid>$guid1$</Guid>
    <Name>$Name$</Name>
    <Description>$Description$</Description>
	</PropertyGroup>
	<Folder Include=".scripts\" />
	<Folder Include=".scripts\X2ModBuildCommon\" />
    <Folder Include="Src\$ModSafeName$\"/>
	<Content Include=".scripts\build.ps1" />
	<Content Include=".gitignore" />
	<Content Include="replace_text.exe" />
	<Content Include="RUN_THIS.bat" />
	<Content Include="Localization\$ModSafeName$.int"/>
    <Content Include="Src\$ModSafeName$\Classes\X2DLCInfo_$ModSafeName$.uc" />
    <SolutionRoot>$(MSBuildProjectDirectory)\</SolutionRoot>
    <ScriptsDir>$(SolutionRoot).scripts\</ScriptsDir>
    <BuildCommonRoot>$(ScriptsDir)X2ModBuildCommon\</BuildCommonRoot>
  <Import Project="$(BuildCommonRoot)XCOM2.targets" />
</Project>
"#;
    let mut bytes = vec![0xef, 0xbb, 0xbf];
    bytes.extend_from_slice(body.as_bytes());
    bytes
}

fn render_request(
    source_grant: FoundrySourceSelectionGrant,
    destination_parent_grant: FoundryDestinationParentSelectionGrant,
    mod_id: &str,
) -> RenderFoundryPreviewRequest {
    RenderFoundryPreviewRequest {
        source_grant,
        destination_parent_grant,
        mod_id: mod_id.to_string(),
    }
}

fn expect_rendered(
    result: RenderFoundryPreviewResult,
) -> (FoundryOperationGrant, Box<FoundryRenderedPlanBody>) {
    match result {
        RenderFoundryPreviewResult::Rendered {
            operation_grant,
            plan_body,
        } => (operation_grant, plan_body),
        RenderFoundryPreviewResult::Refused { code } => {
            panic!("expected rendered plan, got {code:?}")
        }
    }
}

fn loose_object_path(root: &Path, oid: Oid) -> PathBuf {
    let oid = oid.to_string();
    root.join(".git/objects").join(&oid[..2]).join(&oid[2..])
}

fn authorize_source(
    state: &Xcom2ProjectFoundryState,
    fixture: &RepositoryFixture,
) -> FoundrySourceSelectionGrant {
    authorize_source_repository(state, fixture.source_request()).expect("authorize source")
}

fn destination_request(
    directory: &TestDirectory,
    mod_id: &str,
) -> AuthorizeFoundryDestinationParentRequest {
    AuthorizeFoundryDestinationParentRequest {
        selected_root: directory.string(),
        mod_id: mod_id.to_string(),
    }
}

#[test]
fn command_dtos_are_exact_camel_case_and_reject_unknown_fields() {
    let source: AuthorizeFoundrySourceRepositoryRequest =
        serde_json::from_value(serde_json::json!({"selectedRoot": "/tmp/repository"}))
            .expect("camelCase source request");
    assert_eq!(source.selected_root, "/tmp/repository");
    assert!(
        serde_json::from_value::<AuthorizeFoundrySourceRepositoryRequest>(
            serde_json::json!({"selectedRoot": "/tmp/repository", "scan": true})
        )
        .is_err()
    );

    let destination_selection: AuthorizeFoundryDestinationParentSelectionRequest =
        serde_json::from_value(serde_json::json!({"selectedRoot": "/tmp/parent"}))
            .expect("camelCase destination parent selection request");
    assert_eq!(destination_selection.selected_root, "/tmp/parent");
    assert!(
        serde_json::from_value::<AuthorizeFoundryDestinationParentSelectionRequest>(
            serde_json::json!({"selectedRoot": "/tmp/parent", "modId": "ExactMod"})
        )
        .is_err(),
        "parent-only authorization must not accept a ModId"
    );

    let destination: AuthorizeFoundryDestinationParentRequest = serde_json::from_value(
        serde_json::json!({"selectedRoot": "/tmp/parent", "modId": "ExactMod"}),
    )
    .expect("camelCase legacy destination request");
    assert_eq!(destination.mod_id, "ExactMod");

    let render: RenderFoundryPreviewRequest = serde_json::from_value(serde_json::json!({
        "sourceGrant": {
            "kind": "source-repository",
            "repository": "/tmp/repository",
            "identity": "source-1"
        },
        "destinationParentGrant": {
            "kind": "destination-parent",
            "parent": "/tmp/parent",
            "identity": "parent-1"
        },
        "modId": "Mod_1"
    }))
    .expect("camelCase render request");
    assert_eq!(render.mod_id, "Mod_1");
    assert!(
        serde_json::from_value::<RenderFoundryPreviewRequest>(serde_json::json!({
            "sourceGrant": render.source_grant,
            "destinationParentGrant": render.destination_parent_grant,
            "modId": "Mod_1",
            "operationGrant": null
        }))
        .is_err()
    );

    let default_state = Xcom2ProjectFoundryState::default();
    assert_eq!(default_state.expected.commit.to_string(), EXPECTED_COMMIT);
    assert_eq!(default_state.expected.tree.to_string(), EXPECTED_TREE);
}

#[test]
fn source_resolution_reads_only_committed_objects_and_ignores_dirty_worktree() {
    let fixture = RepositoryFixture::new("dirty-source");
    fs::write(fixture.root.0.join("tracked.txt"), b"dirty tracked bytes\n")
        .expect("dirty tracked fixture");
    fs::write(fixture.root.0.join("untracked.canary"), b"untracked bytes")
        .expect("write untracked fixture");
    let before = snapshot(&fixture.root.0);
    let state = fixture.state();
    let grant = authorize_source(&state, &fixture);

    let evidence = resolve_source_object(&state, ResolveFoundrySourceObjectRequest { grant })
        .expect("resolve fixture objects");

    assert_eq!(evidence.commit, fixture.commit.to_string());
    assert_eq!(evidence.tree, fixture.tree.to_string());
    assert_eq!(evidence.fingerprint_result, "Verified");
    assert_eq!(snapshot(&fixture.root.0), before);
}

#[test]
fn missing_commit_tree_mismatch_and_missing_blob_are_refused_precisely() {
    let fixture = RepositoryFixture::new("object-refusals");
    let missing_state = Xcom2ProjectFoundryState::with_expected_object_ids(
        "0000000000000000000000000000000000000000",
        &fixture.tree.to_string(),
    )
    .expect("missing expected identity");
    let grant = authorize_source(&missing_state, &fixture);
    assert_eq!(
        resolve_source_object(&missing_state, ResolveFoundrySourceObjectRequest { grant })
            .expect("missing commit evidence")
            .fingerprint_result,
        "source-commit-missing"
    );

    let mismatch_state = Xcom2ProjectFoundryState::with_expected_object_ids(
        &fixture.commit.to_string(),
        "0000000000000000000000000000000000000000",
    )
    .expect("mismatched tree identity");
    let grant = authorize_source(&mismatch_state, &fixture);
    assert_eq!(
        resolve_source_object(&mismatch_state, ResolveFoundrySourceObjectRequest { grant })
            .expect("tree mismatch evidence")
            .fingerprint_result,
        "source-tree-mismatched"
    );

    let blob_path = fixture
        .root
        .0
        .join(".git/objects")
        .join(&fixture.blob.to_string()[..2])
        .join(&fixture.blob.to_string()[2..]);
    fs::remove_file(blob_path).expect("remove loose fixture blob");
    let blob_state = fixture.state();
    let grant = authorize_source(&blob_state, &fixture);
    assert_eq!(
        resolve_source_object(&blob_state, ResolveFoundrySourceObjectRequest { grant })
            .expect("missing blob evidence")
            .fingerprint_result,
        "source-blob-missing"
    );
}

#[cfg(target_os = "linux")]
#[test]
fn source_root_git_and_object_directory_symlinks_are_rejected() {
    use std::os::unix::fs::symlink;

    let fixture = RepositoryFixture::new("source-symlink-target");
    let linked_root_parent = TestDirectory::new("source-linked-root");
    let linked_root = linked_root_parent.0.join("repository-link");
    symlink(&fixture.root.0, &linked_root).expect("source root symlink");
    let state = fixture.state();
    assert_eq!(
        authorize_source_repository(
            &state,
            AuthorizeFoundrySourceRepositoryRequest {
                selected_root: linked_root.to_str().expect("UTF-8 link").to_string(),
            }
        ),
        Err("source-repository-unavailable".to_string())
    );

    let git_link_root = TestDirectory::new("git-link-root");
    symlink(fixture.root.0.join(".git"), git_link_root.0.join(".git"))
        .expect("git directory symlink");
    assert!(authorize_source_repository(
        &state,
        AuthorizeFoundrySourceRepositoryRequest {
            selected_root: git_link_root.string(),
        }
    )
    .is_err());

    let objects_link_root = TestDirectory::new("objects-link-root");
    fs::create_dir(objects_link_root.0.join(".git")).expect("create fake git directory");
    symlink(
        fixture.root.0.join(".git/objects"),
        objects_link_root.0.join(".git/objects"),
    )
    .expect("object directory symlink");
    assert!(authorize_source_repository(
        &state,
        AuthorizeFoundrySourceRepositoryRequest {
            selected_root: objects_link_root.string(),
        }
    )
    .is_err());
}

#[test]
fn object_alternates_and_wrong_source_entry_types_are_rejected() {
    let fixture = RepositoryFixture::new("source-entry-refusals");
    let state = fixture.state();
    fs::create_dir_all(fixture.root.0.join(".git/objects/info"))
        .expect("create object info directory");
    fs::write(
        fixture.root.0.join(".git/objects/info/alternates"),
        b"/outside/object/database\n",
    )
    .expect("write forbidden alternates file");
    assert_eq!(
        authorize_source_repository(&state, fixture.source_request()),
        Err("source-repository-unavailable".to_string())
    );

    let wrong_git = TestDirectory::new("wrong-git-entry");
    fs::write(wrong_git.0.join(".git"), b"gitdir: elsewhere").expect("write git indirection file");
    assert_eq!(
        authorize_source_repository(
            &state,
            AuthorizeFoundrySourceRepositoryRequest {
                selected_root: wrong_git.string(),
            },
        ),
        Err("source-repository-unavailable".to_string())
    );
}

#[test]
fn source_grants_reject_field_mismatch_stale_identity_and_revocation() {
    let fixture = RepositoryFixture::new("source-grant-lifecycle");
    let state = fixture.state();
    let grant = authorize_source(&state, &fixture);
    let mut mismatched = grant.clone();
    mismatched.repository.push_str("-other");
    assert_eq!(
        resolve_source_object(
            &state,
            ResolveFoundrySourceObjectRequest { grant: mismatched }
        ),
        Err("source-grant-invalid".to_string())
    );

    revoke_all(&state).expect("revoke source grants");
    assert_eq!(
        resolve_source_object(
            &state,
            ResolveFoundrySourceObjectRequest {
                grant: grant.clone()
            }
        ),
        Err("source-grant-invalid".to_string())
    );

    let fresh = authorize_source(&state, &fixture);
    assert_ne!(
        fresh.identity, grant.identity,
        "grant identity is lifecycle-opaque"
    );
    let displaced = fixture.root.0.with_extension("displaced");
    fs::rename(&fixture.root.0, &displaced).expect("displace granted source");
    fs::create_dir(&fixture.root.0).expect("replace source root");
    assert_eq!(
        resolve_source_object(&state, ResolveFoundrySourceObjectRequest { grant: fresh }),
        Err("source-grant-invalid".to_string())
    );
    fs::remove_dir(&fixture.root.0).expect("remove replacement root");
    fs::rename(displaced, &fixture.root.0).expect("restore fixture for drop");
}

#[test]
fn paths_must_be_bounded_absolute_canonical_utf8_strings() {
    let state = Xcom2ProjectFoundryState::default();
    for selected_root in [
        "relative/repository".to_string(),
        "/tmp/../tmp".to_string(),
        "/tmp/./repository".to_string(),
        "/tmp//repository".to_string(),
        "/tmp/".to_string(),
        "/tmp\\repository".to_string(),
        format!("/{}", "a".repeat(MAXIMUM_PATH_BYTES)),
    ] {
        assert!(authorize_source_repository(
            &state,
            AuthorizeFoundrySourceRepositoryRequest { selected_root }
        )
        .is_err());
    }
}

#[test]
fn parent_only_selection_precedes_mod_id_render_mints_operation_and_revoke_invalidates_it() {
    let fixture = RendererRepositoryFixture::new("parent-only-render", None, false);
    let parent = TestDirectory::new("parent-only-render-destination");
    let state = fixture.state();
    let source = authorize_source_repository(&state, fixture.source_request())
        .expect("authorize renderer source");

    let destination = authorize_destination_parent_selection(
        &state,
        AuthorizeFoundryDestinationParentSelectionRequest {
            selected_root: parent.string(),
        },
    )
    .expect("authorize only the selected destination parent");
    let destination_wire = serde_json::to_value(&destination).expect("serialize parent grant");
    let destination_wire = destination_wire.as_object().expect("parent grant object");
    assert_eq!(destination_wire.len(), 3);
    assert_eq!(destination_wire["kind"], "destination-parent");
    assert_eq!(destination_wire["parent"], parent.string());
    assert!(!destination_wire.contains_key("modId"));
    assert!(!destination_wire.contains_key("derivedDestination"));
    assert!(!destination_wire.contains_key("operationGrant"));
    {
        let grants = state.grants.lock().expect("read parent-only grant store");
        let record = grants
            .destination_grants
            .get(&destination.identity)
            .expect("stored parent-only grant");
        assert!(record.operation.is_none());
        assert!(grants.operation_to_destination.is_empty());
    }

    let later_mod_id = "ChosenLater";
    let (operation, plan) = expect_rendered(render_preview(
        &state,
        render_request(source, destination.clone(), later_mod_id),
    ));
    assert_eq!(plan.project.mod_id, later_mod_id);
    assert_eq!(
        operation.derived_destination,
        parent
            .0
            .join(later_mod_id)
            .to_str()
            .expect("UTF-8 derived destination")
    );
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: destination.clone(),
                operation_grant: operation.clone(),
            }
        ),
        Ok(FoundryDestinationState::Absent)
    );

    revoke_all(&state).expect("revoke parent and rendered operation grants");
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: destination,
                operation_grant: operation,
            }
        ),
        Err("operation-grant-invalid".to_string())
    );
}

#[test]
fn narrow_operation_revocation_retains_selectors_clears_bytes_and_allows_replacement() {
    let fixture = RendererRepositoryFixture::new("narrow-operation-revoke", None, false);
    let parent = TestDirectory::new("narrow-operation-revoke-parent");
    let state = fixture.state();
    let source = authorize_source_repository(&state, fixture.source_request())
        .expect("authorize renderer source");
    let destination = authorize_destination_parent_selection(
        &state,
        AuthorizeFoundryDestinationParentSelectionRequest {
            selected_root: parent.string(),
        },
    )
    .expect("authorize destination parent");
    let (old_operation, _) = expect_rendered(render_preview(
        &state,
        render_request(source.clone(), destination.clone(), "LifecycleMod"),
    ));

    {
        let grants = state.grants.lock().expect("read rendered grant store");
        assert_eq!(grants.source_grants.len(), 1);
        assert_eq!(grants.destination_grants.len(), 1);
        assert_eq!(grants.operation_to_destination.len(), 1);
        assert_eq!(
            grants.rendered_files_by_operation[&old_operation.identity].len(),
            27
        );
    }
    let source_before_revoke = snapshot(&fixture.root.0);
    let parent_before_revoke = snapshot(&parent.0);

    revoke_operations(&state).expect("revoke only operation authority");
    revoke_operations(&state).expect("repeat narrow revocation idempotently");

    assert_eq!(snapshot(&fixture.root.0), source_before_revoke);
    assert_eq!(snapshot(&parent.0), parent_before_revoke);
    {
        let grants = state.grants.lock().expect("read narrowly revoked store");
        assert!(grants.source_grants.contains_key(&source.identity));
        let retained_parent = grants
            .destination_grants
            .get(&destination.identity)
            .expect("destination-parent grant remains");
        assert!(retained_parent.operation.is_none());
        assert!(grants.operation_to_destination.is_empty());
        assert!(grants.rendered_files_by_operation.is_empty());
    }
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: destination.clone(),
                operation_grant: old_operation.clone(),
            }
        ),
        Err("operation-grant-invalid".to_string()),
        "the revoked operation cannot supply destination/apply authority"
    );
    assert_eq!(
        resolve_source_object(
            &state,
            ResolveFoundrySourceObjectRequest {
                grant: source.clone(),
            }
        )
        .expect("retained source grant resolves")
        .fingerprint_result,
        "Verified"
    );

    let (replacement, _) = expect_rendered(render_preview(
        &state,
        render_request(source, destination, "LifecycleMod"),
    ));
    assert_ne!(replacement.identity, old_operation.identity);
    let grants = state.grants.lock().expect("read replacement operation");
    assert_eq!(grants.operation_to_destination.len(), 1);
    assert!(!grants
        .rendered_files_by_operation
        .contains_key(&old_operation.identity));
    assert_eq!(
        grants.rendered_files_by_operation[&replacement.identity].len(),
        27
    );
}

#[test]
fn destination_authorization_derives_exact_absent_child_and_revalidates_it() {
    let parent = TestDirectory::new("destination-happy");
    fs::write(parent.0.join("sibling.canary"), b"unchanged").expect("write destination sibling");
    let before = snapshot(&parent.0);
    let state = Xcom2ProjectFoundryState::default();
    let selection = authorize_destination_parent(
        &state,
        destination_request(&parent, "FoundryPreviewFixture"),
    )
    .expect("authorize destination");

    assert_eq!(
        selection.destination_parent_grant.kind,
        "destination-parent"
    );
    assert_eq!(selection.destination_parent_grant.parent, parent.string());
    assert_eq!(selection.operation_grant.kind, "preview-operation");
    assert_eq!(
        selection.operation_grant.derived_destination,
        parent
            .0
            .join("FoundryPreviewFixture")
            .to_str()
            .expect("UTF-8 child")
    );
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: selection.destination_parent_grant,
                operation_grant: selection.operation_grant,
            }
        ),
        Ok(FoundryDestinationState::Absent)
    );
    assert_eq!(snapshot(&parent.0), before);
}

#[test]
fn mod_id_regex_and_windows_devices_are_duplicated_fail_closed() {
    let parent = TestDirectory::new("mod-id-refusal");
    let state = Xcom2ProjectFoundryState::default();
    for invalid in ["", "1Mod", "with-dash", "with space", "é", &"A".repeat(49)] {
        assert_eq!(
            authorize_destination_parent(&state, destination_request(&parent, invalid)),
            Err("mod-id-invalid".to_string()),
            "invalid ModId {invalid:?}"
        );
    }
    for device in ["CON", "nul", "Com1", "lPt9"] {
        assert_eq!(
            authorize_destination_parent(&state, destination_request(&parent, device)),
            Err("mod-id-windows-device".to_string()),
            "device ModId {device:?}"
        );
    }
    assert!(authorize_destination_parent(&state, destination_request(&parent, "COM0")).is_ok());
    revoke_all(&state).expect("revoke destination grants");
}

#[test]
fn present_derived_destination_is_never_authorized_and_later_presence_is_reported() {
    let parent = TestDirectory::new("destination-present");
    let state = Xcom2ProjectFoundryState::default();
    fs::create_dir(parent.0.join("AlreadyPresent")).expect("create present child");
    assert_eq!(
        authorize_destination_parent(&state, destination_request(&parent, "AlreadyPresent")),
        Err("derived-destination-present".to_string())
    );

    let selection =
        authorize_destination_parent(&state, destination_request(&parent, "AppearsLater"))
            .expect("authorize absent child");
    fs::write(parent.0.join("AppearsLater"), b"external file").expect("create derived child");
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: selection.destination_parent_grant,
                operation_grant: selection.operation_grant,
            }
        ),
        Ok(FoundryDestinationState::Present)
    );
}

#[cfg(target_os = "linux")]
#[test]
fn symlink_destination_parent_and_dangling_derived_symlink_are_refused() {
    use std::os::unix::fs::symlink;

    let parent = TestDirectory::new("destination-symlink-target");
    let links = TestDirectory::new("destination-symlinks");
    let parent_link = links.0.join("parent-link");
    symlink(&parent.0, &parent_link).expect("destination parent symlink");
    let state = Xcom2ProjectFoundryState::default();
    assert!(authorize_destination_parent(
        &state,
        AuthorizeFoundryDestinationParentRequest {
            selected_root: parent_link.to_str().expect("UTF-8 link").to_string(),
            mod_id: "ExactMod".to_string(),
        }
    )
    .is_err());

    symlink("missing-target", parent.0.join("DanglingChild")).expect("dangling destination child");
    assert_eq!(
        authorize_destination_parent(&state, destination_request(&parent, "DanglingChild")),
        Err("derived-destination-present".to_string())
    );
}

#[test]
fn destination_grants_reject_cross_pair_mismatch_and_revoke_all() {
    let parent = TestDirectory::new("destination-grant-lifecycle");
    let state = Xcom2ProjectFoundryState::default();
    let first = authorize_destination_parent(&state, destination_request(&parent, "FirstMod"))
        .expect("first destination grant");
    let second = authorize_destination_parent(&state, destination_request(&parent, "SecondMod"))
        .expect("second destination grant");
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: first.destination_parent_grant.clone(),
                operation_grant: second.operation_grant,
            }
        ),
        Err("operation-grant-invalid".to_string())
    );
    let mut altered_operation = first.operation_grant.clone();
    altered_operation.derived_destination.push_str("Other");
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: first.destination_parent_grant.clone(),
                operation_grant: altered_operation,
            }
        ),
        Err("operation-grant-invalid".to_string())
    );

    revoke_all(&state).expect("revoke all grants");
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: first.destination_parent_grant,
                operation_grant: first.operation_grant,
            }
        ),
        Err("operation-grant-invalid".to_string())
    );
}

#[test]
fn replacing_destination_parent_identity_is_reported_unavailable_without_mutation() {
    let parent = TestDirectory::new("destination-stale");
    let state = Xcom2ProjectFoundryState::default();
    let selection = authorize_destination_parent(&state, destination_request(&parent, "ExactMod"))
        .expect("authorize destination");
    let displaced = parent.0.with_extension("displaced");
    fs::rename(&parent.0, &displaced).expect("displace destination parent");
    fs::create_dir(&parent.0).expect("replace destination parent");
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: selection.destination_parent_grant,
                operation_grant: selection.operation_grant,
            }
        ),
        Ok(FoundryDestinationState::ParentUnavailable)
    );
    assert!(fs::read_dir(&parent.0)
        .expect("read replacement destination")
        .next()
        .is_none());
    fs::remove_dir(&parent.0).expect("remove replacement parent");
    fs::rename(displaced, &parent.0).expect("restore parent for drop");
}

#[test]
fn renderer_dynamically_binds_case_sensitive_and_48_byte_mod_ids_without_writes() {
    let fixture = RendererRepositoryFixture::new("dynamic-renderer", None, false);
    let parent = TestDirectory::new("dynamic-renderer-parent");
    fs::write(parent.0.join("sibling.canary"), b"unchanged").expect("write sibling canary");
    let source_before = snapshot(&fixture.root.0);
    let parent_before = snapshot(&parent.0);
    let state = fixture.state();
    let source = authorize_source_repository(&state, fixture.source_request())
        .expect("authorize renderer source");
    let destination =
        authorize_destination_parent(&state, destination_request(&parent, "InitialMod"))
            .expect("authorize renderer destination");
    let legacy_operation = destination.operation_grant.clone();
    let mut previous_operation = None;
    let mut case_hashes = Vec::new();

    for mod_id in [
        "CaseMod",
        "casemod",
        "Mod_1",
        &format!("A{}", "z".repeat(47)),
    ] {
        assert!(mod_id.len() <= 48);
        let result = render_preview(
            &state,
            render_request(
                source.clone(),
                destination.destination_parent_grant.clone(),
                mod_id,
            ),
        );
        let wire = serde_json::to_value(&result).expect("serialize rendered result");
        let wire = wire.as_object().expect("rendered result object");
        assert_eq!(wire.len(), 3);
        assert_eq!(wire["kind"], "rendered");
        assert!(wire.contains_key("operationGrant"));
        assert!(wire.contains_key("planBody"));
        let (operation, plan) = expect_rendered(result);
        assert_eq!(plan.project.mod_id, mod_id);
        assert_eq!(plan.directories.len(), 12);
        assert_eq!(plan.files.len(), 27);
        assert_eq!(plan.generated_previews.len(), 2);
        assert_eq!(
            operation.derived_destination,
            parent.0.join(mod_id).to_str().expect("UTF-8 destination")
        );
        assert_eq!(
            plan.destination.operation_grant_identity,
            operation.identity
        );
        assert!(plan
            .files
            .iter()
            .any(|file| file.path == format!("{mod_id}/{mod_id}.x2proj")));
        assert!(plan
            .files
            .iter()
            .any(|file| file.path == format!("{mod_id}.XCOM_sln")));
        assert!(plan
            .files
            .iter()
            .all(|file| file.mode == "0644" && file.bytes > 0));
        let serialized = serde_json::to_string(&plan).expect("serialize dynamic plan");
        if mod_id != "FoundryPreviewFixture" {
            assert!(!serialized.contains("FoundryPreviewFixture"));
        }
        if let Some(previous) = previous_operation.replace(operation.clone()) {
            assert_eq!(
                inspect_destination(
                    &state,
                    InspectFoundryDestinationRequest {
                        destination_parent_grant: destination.destination_parent_grant.clone(),
                        operation_grant: previous,
                    }
                ),
                Err("operation-grant-invalid".to_string())
            );
        }
        case_hashes.push(
            plan.files
                .iter()
                .find(|file| file.path == ".scripts/build.ps1")
                .expect("transformed build script")
                .sha256
                .clone(),
        );
    }
    assert_ne!(case_hashes[0], case_hashes[1]);
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: destination.destination_parent_grant.clone(),
                operation_grant: legacy_operation,
            }
        ),
        Err("operation-grant-invalid".to_string())
    );
    assert_eq!(snapshot(&fixture.root.0), source_before);
    assert_eq!(snapshot(&parent.0), parent_before);
}

#[test]
fn failed_render_revokes_previous_operation_and_mints_nothing() {
    let fixture = RendererRepositoryFixture::new("render-revoke", None, false);
    let parent = TestDirectory::new("render-revoke-parent");
    let state = fixture.state();
    let source =
        authorize_source_repository(&state, fixture.source_request()).expect("authorize source");
    let destination = authorize_destination_parent(&state, destination_request(&parent, "Old"))
        .expect("authorize destination");
    let (replacement, _) = expect_rendered(render_preview(
        &state,
        render_request(
            source.clone(),
            destination.destination_parent_grant.clone(),
            "New",
        ),
    ));

    assert_eq!(
        render_preview(
            &state,
            render_request(
                source,
                destination.destination_parent_grant.clone(),
                "invalid-id",
            )
        ),
        refused_render(FoundryRenderRefusalCode::ModIdInvalid)
    );
    assert_eq!(
        inspect_destination(
            &state,
            InspectFoundryDestinationRequest {
                destination_parent_grant: destination.destination_parent_grant,
                operation_grant: replacement,
            }
        ),
        Err("operation-grant-invalid".to_string())
    );
}

#[test]
fn renderer_refuses_missing_tree_and_required_blob_with_typed_safe_codes() {
    let tree_fixture = RendererRepositoryFixture::new("render-missing-tree", None, false);
    let tree_parent = TestDirectory::new("render-missing-tree-parent");
    let tree_state = tree_fixture.state();
    let tree_source = authorize_source_repository(&tree_state, tree_fixture.source_request())
        .expect("authorize tree source");
    let tree_destination =
        authorize_destination_parent(&tree_state, destination_request(&tree_parent, "TreeMod"))
            .expect("authorize tree destination");
    fs::remove_file(loose_object_path(&tree_fixture.root.0, tree_fixture.tree))
        .expect("remove tree object");
    assert_eq!(
        render_preview(
            &tree_state,
            render_request(
                tree_source,
                tree_destination.destination_parent_grant,
                "TreeMod",
            )
        ),
        refused_render(FoundryRenderRefusalCode::SourceTreeMissing)
    );

    let blob_fixture = RendererRepositoryFixture::new("render-missing-blob", None, false);
    let blob_parent = TestDirectory::new("render-missing-blob-parent");
    let blob_state = blob_fixture.state();
    let blob_source = authorize_source_repository(&blob_state, blob_fixture.source_request())
        .expect("authorize blob source");
    let blob_destination =
        authorize_destination_parent(&blob_state, destination_request(&blob_parent, "BlobMod"))
            .expect("authorize blob destination");
    let blob = blob_fixture.blobs["Mod.int"];
    fs::remove_file(loose_object_path(&blob_fixture.root.0, blob)).expect("remove required blob");
    assert_eq!(
        render_preview(
            &blob_state,
            render_request(
                blob_source,
                blob_destination.destination_parent_grant,
                "BlobMod",
            )
        ),
        refused_render(FoundryRenderRefusalCode::SourceBlobMissing)
    );
}

#[cfg(target_os = "linux")]
#[test]
fn renderer_refuses_required_git_symlink_and_malformed_project_safely() {
    let symlink_fixture = RendererRepositoryFixture::new(
        "render-source-symlink",
        Some("Config/Base/XComEditor.ini"),
        false,
    );
    let symlink_parent = TestDirectory::new("render-source-symlink-parent");
    let symlink_state = symlink_fixture.state();
    let source = authorize_source_repository(&symlink_state, symlink_fixture.source_request())
        .expect("authorize symlink source repository");
    let destination = authorize_destination_parent(
        &symlink_state,
        destination_request(&symlink_parent, "LinkMod"),
    )
    .expect("authorize symlink destination");
    assert_eq!(
        render_preview(
            &symlink_state,
            render_request(source, destination.destination_parent_grant, "LinkMod")
        ),
        refused_render(FoundryRenderRefusalCode::SourceBlobMismatched)
    );

    let malformed = RendererRepositoryFixture::new("render-malformed", None, true);
    let malformed_parent = TestDirectory::new("render-malformed-parent");
    let malformed_state = malformed.state();
    let source = authorize_source_repository(&malformed_state, malformed.source_request())
        .expect("authorize malformed source");
    let destination = authorize_destination_parent(
        &malformed_state,
        destination_request(&malformed_parent, "SafeMod"),
    )
    .expect("authorize malformed destination");
    assert_eq!(
        render_preview(
            &malformed_state,
            render_request(source, destination.destination_parent_grant, "SafeMod")
        ),
        refused_render(FoundryRenderRefusalCode::RenderedPlanInvalid)
    );
    let serialized = serde_json::to_string(&refused_render(
        FoundryRenderRefusalCode::RenderedPlanInvalid,
    ))
    .expect("serialize safe refusal");
    assert_eq!(
        serialized,
        r#"{"kind":"refused","code":"rendered-plan-invalid"}"#
    );
    assert!(!serialized.contains("parser"));
    assert!(!serialized.contains("path"));
}

#[test]
fn renderer_refuses_missing_or_mismatched_grants_and_present_destination() {
    let fixture = RendererRepositoryFixture::new("render-grant-refusal", None, false);
    let parent = TestDirectory::new("render-grant-refusal-parent");
    let state = fixture.state();
    let source =
        authorize_source_repository(&state, fixture.source_request()).expect("authorize source");
    let destination = authorize_destination_parent(&state, destination_request(&parent, "Grant"))
        .expect("authorize destination");
    let mut missing_source = source.clone();
    missing_source.identity = "missing-source-grant".to_string();
    assert_eq!(
        render_preview(
            &state,
            render_request(
                missing_source,
                destination.destination_parent_grant.clone(),
                "Grant",
            )
        ),
        refused_render(FoundryRenderRefusalCode::SourceGrantInvalid)
    );

    fs::write(parent.0.join("PresentMod"), b"external").expect("create destination");
    assert_eq!(
        render_preview(
            &state,
            render_request(source, destination.destination_parent_grant, "PresentMod",)
        ),
        refused_render(FoundryRenderRefusalCode::DerivedDestinationPresent)
    );
}

#[test]
#[ignore = "opt-in: set IDE_EMPT_V1_4_REPOSITORY to the exact local pinned repository"]
fn local_empt_fixture_and_mod_1_match_exact_golden_render_evidence() {
    let repository_path = std::env::var("IDE_EMPT_V1_4_REPOSITORY")
        .expect("set IDE_EMPT_V1_4_REPOSITORY for opt-in golden integration");
    let repository_path = Path::new(&repository_path)
        .canonicalize()
        .expect("canonical local EMPT repository");
    let parent = TestDirectory::new("local-empt-golden-parent");
    let state = Xcom2ProjectFoundryState::default();
    let source = authorize_source_repository(
        &state,
        AuthorizeFoundrySourceRepositoryRequest {
            selected_root: repository_path
                .to_str()
                .expect("UTF-8 local repository")
                .to_string(),
        },
    )
    .expect("authorize local pinned EMPT repository");
    let destination = authorize_destination_parent(
        &state,
        destination_request(&parent, "FoundryPreviewFixture"),
    )
    .expect("authorize local golden destination");

    let (_, fixture_plan) = expect_rendered(render_preview(
        &state,
        render_request(
            source.clone(),
            destination.destination_parent_grant.clone(),
            "FoundryPreviewFixture",
        ),
    ));
    let (_, mod_1_plan) = expect_rendered(render_preview(
        &state,
        render_request(source, destination.destination_parent_grant, "Mod_1"),
    ));

    assert_eq!(
        fixture_plan.project.guid,
        "{30DF67AA-2360-5109-80CF-02CB38BED26F}"
    );
    assert_eq!(
        mod_1_plan.project.guid,
        "{CC1DEF9C-4BBB-5DDD-9F27-E21521D1747C}"
    );
    assert_eq!(fixture_plan.directories.len(), 12);
    assert_eq!(fixture_plan.files.len(), 27);
    assert_eq!(mod_1_plan.directories.len(), 12);
    assert_eq!(mod_1_plan.files.len(), 27);
    assert_eq!(
        file_evidence_digest(&fixture_plan.files),
        "9ab7169707d48c53aa96c4683b41e74de8047d4aa226d27c504c3390a8d71d24"
    );
    assert_eq!(
        file_evidence_digest(&mod_1_plan.files),
        "3e44e68da71df2a5ab9ddbea2e8844de96ba67120f68a5e67efecfb98f9a019a"
    );

    let git_directory = inspect_selected_directory(
        repository_path
            .join(".git")
            .to_str()
            .expect("UTF-8 Git directory"),
    )
    .expect("inspect local Git directory");
    let repository = open_exact_repository(&git_directory).expect("open local Git objects");
    for (mod_id, operation_identity, expected_digest) in [
        (
            "FoundryPreviewFixture",
            "operation-grant-foundry-preview-001",
            "368ab11c085c3b6150975d542850cd4c69915550ead101e244a357eb7dca8dd6",
        ),
        (
            "Mod_1",
            "operation-grant-foundry-preview-002",
            "8a17773f057361183d953ab2aea492a5d23398336da99bb71821d9b39eb81779",
        ),
    ] {
        let operation = FoundryOperationGrant {
            kind: "preview-operation".to_string(),
            derived_destination: format!("/scenario/foundry-output/{mod_id}"),
            identity: operation_identity.to_string(),
        };
        let output = render_from_git_objects(&repository, &state.expected, mod_id)
            .expect("render exact local golden objects");
        let rendered = bind_rendered_plan(
            &state.expected,
            mod_id,
            output,
            FoundryPlanBinding {
                repository: "/scenario/empt-v1_4",
                source_grant_identity: "source-grant-foundry-preview-001",
                parent: "/scenario/foundry-output",
                parent_grant_identity: "destination-parent-grant-foundry-preview-001",
                derived_destination: &operation.derived_destination,
                operation_grant: &operation,
            },
        )
        .expect("bind exact local golden plan");
        assert_eq!(canonical_plan_digest(&rendered.plan_body), expected_digest);
    }
    assert!(serde_json::to_string(&mod_1_plan)
        .expect("serialize Mod_1 plan")
        .contains("Mod_1/Src/Mod_1/Classes/X2DLCInfo_Mod_1.uc"));
    assert!(!serde_json::to_string(&mod_1_plan)
        .expect("serialize Mod_1 plan")
        .contains("FoundryPreviewFixture"));
    assert!(fs::read_dir(&parent.0)
        .expect("read unchanged golden parent")
        .next()
        .is_none());
}

fn canonical_plan_digest(plan: &FoundryRenderedPlanBody) -> String {
    use sha2::{Digest, Sha256};

    fn canonicalize(value: &serde_json::Value, output: &mut String) {
        match value {
            serde_json::Value::Null => output.push_str("null"),
            serde_json::Value::Bool(value) => {
                output.push_str(if *value { "true" } else { "false" });
            }
            serde_json::Value::Number(value) => output.push_str(&value.to_string()),
            serde_json::Value::String(value) => {
                output.push_str(&serde_json::to_string(value).expect("serialize JSON string"));
            }
            serde_json::Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    canonicalize(value, output);
                }
                output.push(']');
            }
            serde_json::Value::Object(values) => {
                output.push('{');
                let mut keys = values.keys().collect::<Vec<_>>();
                keys.sort_unstable();
                for (index, key) in keys.into_iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(&serde_json::to_string(key).expect("serialize JSON property"));
                    output.push(':');
                    canonicalize(&values[key], output);
                }
                output.push('}');
            }
        }
    }

    let value = serde_json::to_value(plan).expect("serialize rendered plan body");
    let mut canonical = String::new();
    canonicalize(&value, &mut canonical);
    let digest = Sha256::digest(canonical.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn file_evidence_digest(files: &[renderer::FoundryRenderedFile]) -> String {
    use sha2::{Digest, Sha256};
    let mut material = Vec::new();
    for file in files {
        material.extend_from_slice(file.path.as_bytes());
        material.push(0);
        material.extend_from_slice(file.mode.as_bytes());
        material.push(0);
        material.extend_from_slice(file.bytes.to_string().as_bytes());
        material.push(0);
        material.extend_from_slice(file.sha256.as_bytes());
        material.push(0);
        material.extend_from_slice(format!("{:?}", file.classification).as_bytes());
        material.push(b'\n');
    }
    let digest = Sha256::digest(material);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn snapshot(root: &Path) -> BTreeMap<String, (String, u32, Vec<u8>)> {
    fn visit(root: &Path, directory: &Path, output: &mut BTreeMap<String, (String, u32, Vec<u8>)>) {
        #[cfg(target_os = "linux")]
        use std::os::unix::fs::PermissionsExt;

        let mut entries = fs::read_dir(directory)
            .expect("read snapshot directory")
            .collect::<Result<Vec<_>, _>>()
            .expect("snapshot entries");
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .expect("relative snapshot path")
                .to_string_lossy()
                .to_string();
            let metadata = fs::symlink_metadata(&path).expect("snapshot metadata");
            #[cfg(target_os = "linux")]
            let mode = metadata.permissions().mode();
            #[cfg(not(target_os = "linux"))]
            let mode = 0;
            if metadata.is_dir() {
                output.insert(relative, ("directory".to_string(), mode, Vec::new()));
                visit(root, &path, output);
            } else if metadata.file_type().is_symlink() {
                output.insert(
                    relative,
                    (
                        "symlink".to_string(),
                        mode,
                        fs::read_link(&path)
                            .expect("read snapshot link")
                            .to_string_lossy()
                            .as_bytes()
                            .to_vec(),
                    ),
                );
            } else {
                let mut bytes = Vec::new();
                File::open(&path)
                    .expect("open snapshot file")
                    .read_to_end(&mut bytes)
                    .expect("read snapshot file");
                output.insert(relative, ("file".to_string(), mode, bytes));
            }
        }
    }

    let mut output = BTreeMap::new();
    visit(root, root, &mut output);
    output
}
