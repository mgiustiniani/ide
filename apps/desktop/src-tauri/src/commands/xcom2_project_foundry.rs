use std::collections::{HashMap, HashSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use git2::{ErrorCode, ObjectType, Oid, Repository};
use regex::Regex;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
mod apply;
mod apply_contract;
mod renderer;

pub use apply_contract::{
    ApplyFoundryProjectRequest, ApplyFoundryProjectResult, FoundryApplyFailureReason,
    FoundryApplyRefusalReason,
};
pub use renderer::FoundryRenderedPlanBody;
use renderer::{
    bind_rendered_plan, render_from_git_objects, FoundryPlanBinding, FoundryRenderedOutputFile,
    RenderFailure,
};

pub(crate) const EXPECTED_COMMIT: &str = "d968be3c32b250376723563a743a120770ec5c95";
const EXPECTED_TREE: &str = "cc8823fa99c0d292c4fe48a8b9463ff790176371";
const MAXIMUM_PATH_BYTES: usize = 4096;
const MAXIMUM_GRANT_IDENTITY_BYTES: usize = 128;
const MAXIMUM_ACTIVE_GRANTS: usize = 64;
const MAXIMUM_TREE_DEPTH: usize = 64;
const MAXIMUM_TREE_OBJECTS: usize = 20_000;
const MAXIMUM_OBJECT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizeFoundrySourceRepositoryRequest {
    pub selected_root: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoundrySourceSelectionGrant {
    pub kind: String,
    pub repository: String,
    pub identity: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveFoundrySourceObjectRequest {
    pub grant: FoundrySourceSelectionGrant,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundrySourceObjectEvidence {
    pub commit: String,
    pub tree: String,
    pub fingerprint_result: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizeFoundryDestinationParentSelectionRequest {
    pub selected_root: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizeFoundryDestinationParentRequest {
    pub selected_root: String,
    pub mod_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoundryDestinationParentSelectionGrant {
    pub kind: String,
    pub parent: String,
    pub identity: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoundryOperationGrant {
    pub kind: String,
    pub derived_destination: String,
    pub identity: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenderFoundryPreviewRequest {
    pub source_grant: FoundrySourceSelectionGrant,
    pub destination_parent_grant: FoundryDestinationParentSelectionGrant,
    pub mod_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FoundryRenderRefusalCode {
    ModIdInvalid,
    ModIdWindowsDevice,
    SourceCommitMissing,
    SourceCommitUnreadable,
    SourceCommitMismatched,
    SourceCommitFingerprintInvalid,
    SourceTreeMissing,
    SourceTreeUnreadable,
    SourceTreeMismatched,
    SourceTreeFingerprintInvalid,
    SourceBlobMissing,
    SourceBlobUnreadable,
    SourceBlobMismatched,
    SourceBlobFingerprintInvalid,
    SourceGrantInvalid,
    DestinationParentUnavailable,
    DestinationParentGrantInvalid,
    DerivedDestinationPresent,
    DerivedDestinationMismatched,
    OperationGrantInvalid,
    RenderedPlanInvalid,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RenderFoundryPreviewResult {
    Rendered {
        #[serde(rename = "operationGrant")]
        operation_grant: FoundryOperationGrant,
        #[serde(rename = "planBody")]
        plan_body: Box<FoundryRenderedPlanBody>,
    },
    Refused {
        code: FoundryRenderRefusalCode,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundryDestinationSelection {
    pub destination_parent_grant: FoundryDestinationParentSelectionGrant,
    pub operation_grant: FoundryOperationGrant,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectFoundryDestinationRequest {
    pub destination_parent_grant: FoundryDestinationParentSelectionGrant,
    pub operation_grant: FoundryOperationGrant,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FoundryDestinationState {
    Absent,
    ParentUnavailable,
    Present,
    Mismatched,
}

#[derive(Debug, Clone)]
pub(crate) struct ExpectedRepositoryIdentity {
    pub(crate) commit: Oid,
    pub(crate) tree: Oid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectoryIdentity {
    canonical_path: PathBuf,
    device: u64,
    inode: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceGrantRecord {
    root: DirectoryIdentity,
    git_directory: DirectoryIdentity,
    object_directory: DirectoryIdentity,
    grant: FoundrySourceSelectionGrant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DestinationGrantRecord {
    parent: DirectoryIdentity,
    destination_grant: FoundryDestinationParentSelectionGrant,
    operation: Option<DestinationOperationRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DestinationOperationRecord {
    mod_id: String,
    operation_grant: FoundryOperationGrant,
}

#[derive(Default)]
struct FoundryGrantStore {
    source_grants: HashMap<String, SourceGrantRecord>,
    destination_grants: HashMap<String, DestinationGrantRecord>,
    operation_to_destination: HashMap<String, String>,
    rendered_files_by_operation: HashMap<String, Vec<FoundryRenderedOutputFile>>,
    consumed_operations: std::collections::VecDeque<String>,
    active_apply_destinations: HashSet<String>,
}

pub struct Xcom2ProjectFoundryState {
    expected: ExpectedRepositoryIdentity,
    grants: Mutex<FoundryGrantStore>,
}

impl Default for Xcom2ProjectFoundryState {
    fn default() -> Self {
        Self::with_expected_object_ids(EXPECTED_COMMIT, EXPECTED_TREE)
            .expect("fixed Foundry object identities are valid Git OIDs")
    }
}

impl Xcom2ProjectFoundryState {
    fn with_expected_object_ids(commit: &str, tree: &str) -> Result<Self, String> {
        Ok(Self {
            expected: ExpectedRepositoryIdentity {
                commit: Oid::from_str(commit).map_err(|_| "source-commit-fingerprint-invalid")?,
                tree: Oid::from_str(tree).map_err(|_| "source-tree-fingerprint-invalid")?,
            },
            grants: Mutex::new(FoundryGrantStore::default()),
        })
    }
}

/// Authorizes exactly the absolute repository root selected by a future native directory chooser.
/// This command does not discover repositories and does not inspect the working tree.
#[tauri::command]
pub fn authorize_xcom2_project_foundry_source_repository(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: AuthorizeFoundrySourceRepositoryRequest,
) -> Result<FoundrySourceSelectionGrant, String> {
    require_linux()?;
    authorize_source_repository(&state, request)
}

/// Resolves the pinned commit, tree, and every reachable tree/blob from only the granted `.git`
/// object database. Worktree files and status are deliberately never read.
#[tauri::command]
pub fn resolve_xcom2_project_foundry_source_object(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: ResolveFoundrySourceObjectRequest,
) -> Result<FoundrySourceObjectEvidence, String> {
    require_linux()?;
    resolve_source_object(&state, request)
}

/// Revalidates both selector grants, renders only pinned Git objects, and returns a complete plan.
/// It never reads the working tree, writes a destination, or starts a process.
#[tauri::command]
pub fn render_xcom2_project_foundry_preview(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: RenderFoundryPreviewRequest,
) -> RenderFoundryPreviewResult {
    if require_linux().is_err() {
        return refused_render(FoundryRenderRefusalCode::RenderedPlanInvalid);
    }
    render_preview(&state, request)
}

/// Authorizes exactly one selected existing parent, without accepting a ModId or deriving a child.
/// The returned parent grant is inert until the renderer validates a later ModId and mints an
/// operation grant.
#[tauri::command]
pub fn authorize_xcom2_project_foundry_destination_parent_selection(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: AuthorizeFoundryDestinationParentSelectionRequest,
) -> Result<FoundryDestinationParentSelectionGrant, String> {
    require_linux()?;
    authorize_destination_parent_selection(&state, request)
}

/// Authorizes one selected existing parent and derives one absent child for the exact ModId.
/// The operation grant in this legacy response is retained temporarily for adapter migration;
/// the renderer always revokes it and is the sole authority for its replacement.
#[tauri::command]
pub fn authorize_xcom2_project_foundry_destination_parent(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: AuthorizeFoundryDestinationParentRequest,
) -> Result<FoundryDestinationSelection, String> {
    require_linux()?;
    authorize_destination_parent(&state, request)
}

/// Revalidates both destination grants, their stable parent identity, and child absence.
#[tauri::command]
pub fn inspect_xcom2_project_foundry_destination(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: InspectFoundryDestinationRequest,
) -> Result<FoundryDestinationState, String> {
    require_linux()?;
    inspect_destination(&state, request)
}

/// Consumes one exact preview operation and creates its independently rerendered project once.
/// The Linux transaction uses private same-parent staging, a durable journal, and renameat2 with
/// RENAME_NOREPLACE. It never executes template content or writes the selected source repository.
#[tauri::command]
pub fn apply_xcom2_project_foundry(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
    request: ApplyFoundryProjectRequest,
) -> ApplyFoundryProjectResult {
    #[cfg(target_os = "linux")]
    {
        apply::apply_foundry_project(&state, request)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (state, request);
        ApplyFoundryProjectResult::Refused {
            phase: apply_contract::FoundryApplyPhase::PreCommit,
            reason: FoundryApplyRefusalReason::RenderedPlanInvalid,
        }
    }
}

/// Synchronously revokes only operation authority and its rendered-byte caches. Source and
/// destination-parent grants remain available for a replacement render. No filesystem access occurs.
#[tauri::command]
pub fn revoke_xcom2_project_foundry_operation_grants(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
) -> Result<(), String> {
    require_linux()?;
    revoke_operations(&state)
}

/// Revokes every in-memory Foundry preview authority. There is no journal or persisted grant.
#[tauri::command]
pub fn revoke_all_xcom2_project_foundry_preview_grants(
    state: tauri::State<'_, Xcom2ProjectFoundryState>,
) -> Result<(), String> {
    require_linux()?;
    revoke_all(&state)
}

fn require_linux() -> Result<(), String> {
    if cfg!(target_os = "linux") {
        Ok(())
    } else {
        Err("foundry-linux-only".to_string())
    }
}

fn authorize_source_repository(
    state: &Xcom2ProjectFoundryState,
    request: AuthorizeFoundrySourceRepositoryRequest,
) -> Result<FoundrySourceSelectionGrant, String> {
    let root = inspect_selected_directory(&request.selected_root)
        .map_err(|_| "source-repository-unavailable".to_string())?;
    let git_directory = inspect_fixed_child_directory(&root, ".git")
        .map_err(|_| "source-repository-unavailable".to_string())?;
    let object_directory = inspect_fixed_child_directory(&git_directory, "objects")
        .map_err(|_| "source-repository-unavailable".to_string())?;
    reject_object_alternates(&object_directory.canonical_path)?;
    open_exact_repository(&git_directory)?;

    let repository = canonical_path_string(&root.canonical_path)?;
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "source-grant-invalid".to_string())?;
    if total_grants(&grants) >= MAXIMUM_ACTIVE_GRANTS {
        return Err("source-grant-invalid".to_string());
    }
    let identity = mint_unique_identity("foundry-source", &grants, None)?;
    let grant = FoundrySourceSelectionGrant {
        kind: "source-repository".to_string(),
        repository,
        identity: identity.clone(),
    };
    let record = SourceGrantRecord {
        root,
        git_directory,
        object_directory,
        grant: grant.clone(),
    };
    revalidate_source_record(&record)?;
    grants.source_grants.insert(identity, record);
    Ok(grant)
}

fn resolve_source_object(
    state: &Xcom2ProjectFoundryState,
    request: ResolveFoundrySourceObjectRequest,
) -> Result<FoundrySourceObjectEvidence, String> {
    validate_source_grant_shape(&request.grant)?;
    let record = {
        let grants = state
            .grants
            .lock()
            .map_err(|_| "source-grant-invalid".to_string())?;
        let record = grants
            .source_grants
            .get(&request.grant.identity)
            .ok_or_else(|| "source-grant-invalid".to_string())?;
        if record.grant != request.grant {
            return Err("source-grant-invalid".to_string());
        }
        record.clone()
    };

    revalidate_source_record(&record)?;
    let repository = open_exact_repository(&record.git_directory)?;
    let fingerprint_result = verify_expected_objects(&repository, &state.expected);
    let result = FoundrySourceObjectEvidence {
        commit: state.expected.commit.to_string(),
        tree: state.expected.tree.to_string(),
        fingerprint_result,
    };

    let grants = state
        .grants
        .lock()
        .map_err(|_| "source-grant-invalid".to_string())?;
    if grants.source_grants.get(&request.grant.identity) != Some(&record) {
        return Err("source-grant-invalid".to_string());
    }
    Ok(result)
}

fn render_preview(
    state: &Xcom2ProjectFoundryState,
    request: RenderFoundryPreviewRequest,
) -> RenderFoundryPreviewResult {
    if validate_destination_grant_shape(&request.destination_parent_grant).is_err() {
        return refused_render(FoundryRenderRefusalCode::DestinationParentGrantInvalid);
    }

    // Rendering or changing ModId synchronously consumes every previous preview-operation
    // authority before source validation or asynchronous object work can continue.
    let (source_record, destination_record) = {
        let mut grants = match state.grants.lock() {
            Ok(grants) => grants,
            Err(_) => return refused_render(FoundryRenderRefusalCode::RenderedPlanInvalid),
        };
        let destination_identity = request.destination_parent_grant.identity.clone();
        let Some(record) = grants.destination_grants.get(&destination_identity) else {
            return refused_render(FoundryRenderRefusalCode::DestinationParentGrantInvalid);
        };
        if record.destination_grant != request.destination_parent_grant {
            return refused_render(FoundryRenderRefusalCode::DestinationParentGrantInvalid);
        }
        if grants
            .active_apply_destinations
            .contains(&destination_identity)
        {
            return refused_render(FoundryRenderRefusalCode::OperationGrantInvalid);
        }
        clear_operation_grants(&mut grants);

        if validate_source_grant_shape(&request.source_grant).is_err() {
            return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
        }
        let Some(source) = grants
            .source_grants
            .get(&request.source_grant.identity)
            .cloned()
        else {
            return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
        };
        if source.grant != request.source_grant {
            return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
        }
        let destination = grants
            .destination_grants
            .get(&destination_identity)
            .expect("validated destination grant remains present")
            .clone();
        (source, destination)
    };

    if let Err(code) = validate_mod_id_for_render(&request.mod_id) {
        return refused_render(code);
    }
    if revalidate_source_record(&source_record).is_err() {
        return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
    }
    if revalidate_destination_parent_record(&destination_record).is_err() {
        return refused_render(FoundryRenderRefusalCode::DestinationParentUnavailable);
    }
    if let Err(code) =
        destination_absence_for_render(&destination_record.parent.canonical_path, &request.mod_id)
    {
        return refused_render(code);
    }

    let repository = match open_exact_repository(&source_record.git_directory) {
        Ok(repository) => repository,
        Err(_) => return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid),
    };
    let output = match render_from_git_objects(&repository, &state.expected, &request.mod_id) {
        Ok(output) => output,
        Err(failure) => return refused_render(render_failure_code(failure)),
    };
    drop(repository);

    // Revalidate every live identity after rendering and immediately before minting. The plan is
    // built from the just-rendered internal bytes; no frontend or fixture metadata participates.
    if revalidate_source_record(&source_record).is_err() {
        return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
    }
    if revalidate_destination_parent_record(&destination_record).is_err() {
        return refused_render(FoundryRenderRefusalCode::DestinationParentUnavailable);
    }
    if let Err(code) =
        destination_absence_for_render(&destination_record.parent.canonical_path, &request.mod_id)
    {
        return refused_render(code);
    }

    let parent = request.destination_parent_grant.parent.clone();
    let derived_destination = match canonical_path_string(
        &destination_record
            .parent
            .canonical_path
            .join(&request.mod_id),
    ) {
        Ok(path) if path.len() <= MAXIMUM_PATH_BYTES => path,
        _ => return refused_render(FoundryRenderRefusalCode::DerivedDestinationMismatched),
    };
    let mut grants = match state.grants.lock() {
        Ok(grants) => grants,
        Err(_) => return refused_render(FoundryRenderRefusalCode::RenderedPlanInvalid),
    };
    if grants.source_grants.get(&request.source_grant.identity) != Some(&source_record) {
        return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
    }
    if grants
        .destination_grants
        .get(&request.destination_parent_grant.identity)
        != Some(&destination_record)
    {
        return refused_render(FoundryRenderRefusalCode::DestinationParentGrantInvalid);
    }
    if revalidate_source_record(&source_record).is_err() {
        return refused_render(FoundryRenderRefusalCode::SourceGrantInvalid);
    }
    if revalidate_destination_parent_record(&destination_record).is_err() {
        return refused_render(FoundryRenderRefusalCode::DestinationParentUnavailable);
    }
    if let Err(code) =
        destination_absence_for_render(&destination_record.parent.canonical_path, &request.mod_id)
    {
        return refused_render(code);
    }
    if total_grants(&grants) + 1 > MAXIMUM_ACTIVE_GRANTS {
        return refused_render(FoundryRenderRefusalCode::OperationGrantInvalid);
    }
    let operation_identity = match mint_unique_identity(
        "foundry-operation",
        &grants,
        Some(request.destination_parent_grant.identity.as_str()),
    ) {
        Ok(identity) => identity,
        Err(_) => return refused_render(FoundryRenderRefusalCode::OperationGrantInvalid),
    };
    let operation_grant = FoundryOperationGrant {
        kind: "preview-operation".to_string(),
        derived_destination: derived_destination.clone(),
        identity: operation_identity.clone(),
    };
    let rendered = match bind_rendered_plan(
        &state.expected,
        &request.mod_id,
        output,
        FoundryPlanBinding {
            repository: &request.source_grant.repository,
            source_grant_identity: &request.source_grant.identity,
            parent: &parent,
            parent_grant_identity: &request.destination_parent_grant.identity,
            derived_destination: &derived_destination,
            operation_grant: &operation_grant,
        },
    ) {
        Ok(rendered) => rendered,
        Err(_) => return refused_render(FoundryRenderRefusalCode::RenderedPlanInvalid),
    };
    if rendered.output_files.len() != 27 {
        return refused_render(FoundryRenderRefusalCode::RenderedPlanInvalid);
    }
    let plan_body = Box::new(rendered.plan_body);
    let rendered_output_files = rendered.output_files;

    let Some(record) = grants
        .destination_grants
        .get_mut(&request.destination_parent_grant.identity)
    else {
        return refused_render(FoundryRenderRefusalCode::DestinationParentGrantInvalid);
    };
    if record.operation.is_some() {
        return refused_render(FoundryRenderRefusalCode::OperationGrantInvalid);
    }
    record.operation = Some(DestinationOperationRecord {
        mod_id: request.mod_id,
        operation_grant: operation_grant.clone(),
    });
    grants
        .rendered_files_by_operation
        .insert(operation_identity.clone(), rendered_output_files);
    grants.operation_to_destination.insert(
        operation_identity,
        request.destination_parent_grant.identity,
    );

    RenderFoundryPreviewResult::Rendered {
        operation_grant,
        plan_body,
    }
}

fn refused_render(code: FoundryRenderRefusalCode) -> RenderFoundryPreviewResult {
    RenderFoundryPreviewResult::Refused { code }
}

fn validate_mod_id_for_render(mod_id: &str) -> Result<(), FoundryRenderRefusalCode> {
    match validate_mod_id(mod_id) {
        Ok(()) => Ok(()),
        Err(code) if code == "mod-id-windows-device" => {
            Err(FoundryRenderRefusalCode::ModIdWindowsDevice)
        }
        Err(_) => Err(FoundryRenderRefusalCode::ModIdInvalid),
    }
}

fn destination_absence_for_render(
    parent: &Path,
    mod_id: &str,
) -> Result<(), FoundryRenderRefusalCode> {
    match derived_entry_state(parent, mod_id) {
        Ok(false) => Ok(()),
        Ok(true) => Err(FoundryRenderRefusalCode::DerivedDestinationPresent),
        Err(_) => Err(FoundryRenderRefusalCode::DestinationParentUnavailable),
    }
}

fn render_failure_code(failure: RenderFailure) -> FoundryRenderRefusalCode {
    match failure {
        RenderFailure::CommitMissing => FoundryRenderRefusalCode::SourceCommitMissing,
        RenderFailure::CommitUnreadable => FoundryRenderRefusalCode::SourceCommitUnreadable,
        RenderFailure::CommitMismatched => FoundryRenderRefusalCode::SourceCommitMismatched,
        RenderFailure::CommitFingerprintInvalid => {
            FoundryRenderRefusalCode::SourceCommitFingerprintInvalid
        }
        RenderFailure::TreeMissing => FoundryRenderRefusalCode::SourceTreeMissing,
        RenderFailure::TreeUnreadable => FoundryRenderRefusalCode::SourceTreeUnreadable,
        RenderFailure::TreeMismatched => FoundryRenderRefusalCode::SourceTreeMismatched,
        RenderFailure::TreeFingerprintInvalid => {
            FoundryRenderRefusalCode::SourceTreeFingerprintInvalid
        }
        RenderFailure::BlobMissing => FoundryRenderRefusalCode::SourceBlobMissing,
        RenderFailure::BlobUnreadable => FoundryRenderRefusalCode::SourceBlobUnreadable,
        RenderFailure::BlobMismatched => FoundryRenderRefusalCode::SourceBlobMismatched,
        RenderFailure::BlobFingerprintInvalid => {
            FoundryRenderRefusalCode::SourceBlobFingerprintInvalid
        }
        RenderFailure::RenderedPlanInvalid => FoundryRenderRefusalCode::RenderedPlanInvalid,
    }
}

fn authorize_destination_parent_selection(
    state: &Xcom2ProjectFoundryState,
    request: AuthorizeFoundryDestinationParentSelectionRequest,
) -> Result<FoundryDestinationParentSelectionGrant, String> {
    let parent = inspect_selected_directory(&request.selected_root)
        .map_err(|_| "destination-parent-unavailable".to_string())?;
    let parent_string = canonical_path_string(&parent.canonical_path)?;

    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "destination-parent-grant-invalid".to_string())?;
    if total_grants(&grants) + 1 > MAXIMUM_ACTIVE_GRANTS {
        return Err("destination-parent-grant-invalid".to_string());
    }
    let destination_identity = mint_unique_identity("foundry-destination", &grants, None)?;
    let destination_grant = FoundryDestinationParentSelectionGrant {
        kind: "destination-parent".to_string(),
        parent: parent_string,
        identity: destination_identity.clone(),
    };
    let record = DestinationGrantRecord {
        parent,
        destination_grant: destination_grant.clone(),
        operation: None,
    };
    revalidate_destination_parent_record(&record)?;
    grants
        .destination_grants
        .insert(destination_identity, record);
    Ok(destination_grant)
}

fn authorize_destination_parent(
    state: &Xcom2ProjectFoundryState,
    request: AuthorizeFoundryDestinationParentRequest,
) -> Result<FoundryDestinationSelection, String> {
    validate_mod_id(&request.mod_id)?;
    let parent = inspect_selected_directory(&request.selected_root)
        .map_err(|_| "destination-parent-unavailable".to_string())?;
    ensure_derived_absent(&parent.canonical_path, &request.mod_id)?;

    let parent_string = canonical_path_string(&parent.canonical_path)?;
    let derived_path = parent.canonical_path.join(&request.mod_id);
    let derived_destination = canonical_path_string(&derived_path)?;
    if derived_destination.len() > MAXIMUM_PATH_BYTES {
        return Err("operation-grant-invalid".to_string());
    }

    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "destination-parent-grant-invalid".to_string())?;
    if total_grants(&grants) + 2 > MAXIMUM_ACTIVE_GRANTS {
        return Err("destination-parent-grant-invalid".to_string());
    }
    let destination_identity = mint_unique_identity("foundry-destination", &grants, None)?;
    let operation_identity = mint_unique_identity(
        "foundry-operation",
        &grants,
        Some(destination_identity.as_str()),
    )?;
    let destination_grant = FoundryDestinationParentSelectionGrant {
        kind: "destination-parent".to_string(),
        parent: parent_string,
        identity: destination_identity.clone(),
    };
    let operation_grant = FoundryOperationGrant {
        kind: "preview-operation".to_string(),
        derived_destination,
        identity: operation_identity.clone(),
    };
    let record = DestinationGrantRecord {
        parent,
        destination_grant: destination_grant.clone(),
        operation: Some(DestinationOperationRecord {
            mod_id: request.mod_id.clone(),
            operation_grant: operation_grant.clone(),
        }),
    };
    revalidate_destination_parent_record(&record)?;
    ensure_derived_absent(&record.parent.canonical_path, &request.mod_id)?;
    grants
        .operation_to_destination
        .insert(operation_identity, destination_identity.clone());
    grants
        .destination_grants
        .insert(destination_identity, record);
    Ok(FoundryDestinationSelection {
        destination_parent_grant: destination_grant,
        operation_grant,
    })
}

fn inspect_destination(
    state: &Xcom2ProjectFoundryState,
    request: InspectFoundryDestinationRequest,
) -> Result<FoundryDestinationState, String> {
    validate_destination_grant_shape(&request.destination_parent_grant)?;
    validate_operation_grant_shape(&request.operation_grant)?;
    let record = {
        let grants = state
            .grants
            .lock()
            .map_err(|_| "destination-parent-grant-invalid".to_string())?;
        let linked_destination = grants
            .operation_to_destination
            .get(&request.operation_grant.identity)
            .ok_or_else(|| "operation-grant-invalid".to_string())?;
        if linked_destination != &request.destination_parent_grant.identity {
            return Err("operation-grant-invalid".to_string());
        }
        let record = grants
            .destination_grants
            .get(linked_destination)
            .ok_or_else(|| "destination-parent-grant-invalid".to_string())?;
        if record.destination_grant != request.destination_parent_grant {
            return Err("destination-parent-grant-invalid".to_string());
        }
        let operation = record
            .operation
            .as_ref()
            .ok_or_else(|| "operation-grant-invalid".to_string())?;
        if operation.operation_grant != request.operation_grant {
            return Err("operation-grant-invalid".to_string());
        }
        (record.clone(), operation.mod_id.clone())
    };

    let (record, mod_id) = record;
    let state_result = match inspect_directory_again(&record.parent) {
        Ok(()) => match derived_entry_state(&record.parent.canonical_path, &mod_id) {
            Ok(false) => FoundryDestinationState::Absent,
            Ok(true) => FoundryDestinationState::Present,
            Err(_) => FoundryDestinationState::ParentUnavailable,
        },
        Err(_) => FoundryDestinationState::ParentUnavailable,
    };

    let grants = state
        .grants
        .lock()
        .map_err(|_| "destination-parent-grant-invalid".to_string())?;
    if grants
        .destination_grants
        .get(&request.destination_parent_grant.identity)
        != Some(&record)
    {
        return Err("destination-parent-grant-invalid".to_string());
    }
    Ok(state_result)
}

fn revoke_operations(state: &Xcom2ProjectFoundryState) -> Result<(), String> {
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "foundry-grant-revocation-failed".to_string())?;
    clear_operation_grants(&mut grants);
    Ok(())
}

fn clear_operation_grants(grants: &mut FoundryGrantStore) {
    for record in grants.destination_grants.values_mut() {
        record.operation = None;
    }
    grants.operation_to_destination.clear();
    grants.rendered_files_by_operation.clear();
}

fn revoke_all(state: &Xcom2ProjectFoundryState) -> Result<(), String> {
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "foundry-grant-revocation-failed".to_string())?;
    clear_operation_grants(&mut grants);
    grants.source_grants.clear();
    grants.destination_grants.clear();
    Ok(())
}

fn total_grants(grants: &FoundryGrantStore) -> usize {
    grants.source_grants.len()
        + grants.destination_grants.len()
        + grants.operation_to_destination.len()
}

fn mint_unique_identity(
    prefix: &str,
    grants: &FoundryGrantStore,
    excluded: Option<&str>,
) -> Result<String, String> {
    for _ in 0..4 {
        let mut random = [0_u8; 24];
        getrandom::fill(&mut random).map_err(|_| "foundry-grant-mint-failed".to_string())?;
        let mut identity = String::with_capacity(prefix.len() + 1 + random.len() * 2);
        identity.push_str(prefix);
        identity.push('-');
        for byte in random {
            use std::fmt::Write;
            write!(&mut identity, "{byte:02x}").expect("writing into String cannot fail");
        }
        if excluded != Some(identity.as_str())
            && !grants.source_grants.contains_key(&identity)
            && !grants.destination_grants.contains_key(&identity)
            && !grants.operation_to_destination.contains_key(&identity)
            && !grants.rendered_files_by_operation.contains_key(&identity)
        {
            return Ok(identity);
        }
    }
    Err("foundry-grant-mint-failed".to_string())
}

fn validate_source_grant_shape(grant: &FoundrySourceSelectionGrant) -> Result<(), String> {
    if grant.kind != "source-repository"
        || !valid_canonical_path_string(&grant.repository)
        || !valid_grant_identity(&grant.identity)
    {
        return Err("source-grant-invalid".to_string());
    }
    Ok(())
}

fn validate_destination_grant_shape(
    grant: &FoundryDestinationParentSelectionGrant,
) -> Result<(), String> {
    if grant.kind != "destination-parent"
        || !valid_canonical_path_string(&grant.parent)
        || !valid_grant_identity(&grant.identity)
    {
        return Err("destination-parent-grant-invalid".to_string());
    }
    Ok(())
}

fn validate_operation_grant_shape(grant: &FoundryOperationGrant) -> Result<(), String> {
    if grant.kind != "preview-operation"
        || !valid_canonical_path_string(&grant.derived_destination)
        || !valid_grant_identity(&grant.identity)
    {
        return Err("operation-grant-invalid".to_string());
    }
    Ok(())
}

fn valid_grant_identity(identity: &str) -> bool {
    identity.len() <= MAXIMUM_GRANT_IDENTITY_BYTES
        && !identity.is_empty()
        && identity.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn validate_mod_id(mod_id: &str) -> Result<(), String> {
    static MOD_ID: OnceLock<Regex> = OnceLock::new();
    static WINDOWS_DEVICE: OnceLock<Regex> = OnceLock::new();
    let pattern = MOD_ID.get_or_init(|| {
        Regex::new(r"^[A-Za-z][A-Za-z0-9_]{0,47}$").expect("fixed ModId regex is valid")
    });
    if !pattern.is_match(mod_id) {
        return Err("mod-id-invalid".to_string());
    }
    let device = WINDOWS_DEVICE.get_or_init(|| {
        Regex::new(r"(?i)^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$")
            .expect("fixed device regex is valid")
    });
    if device.is_match(mod_id) {
        return Err("mod-id-windows-device".to_string());
    }
    Ok(())
}

fn valid_canonical_path_string(value: &str) -> bool {
    if value.is_empty()
        || value.len() > MAXIMUM_PATH_BYTES
        || !value.starts_with('/')
        || value.contains('\\')
        || value.chars().any(is_control)
        || (value.len() > 1 && value.ends_with('/'))
    {
        return false;
    }
    let mut components = value.split('/');
    if components.next() != Some("") {
        return false;
    }
    let remaining = components.collect::<Vec<_>>();
    if remaining == [""] {
        return true;
    }
    remaining
        .iter()
        .all(|component| !component.is_empty() && *component != "." && *component != "..")
}

fn is_control(character: char) -> bool {
    matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}'..='\u{009f}')
}

fn canonical_path_string(path: &Path) -> Result<String, String> {
    let value = path
        .to_str()
        .ok_or_else(|| "foundry-path-invalid".to_string())?
        .to_string();
    if valid_canonical_path_string(&value) {
        Ok(value)
    } else {
        Err("foundry-path-invalid".to_string())
    }
}

fn inspect_selected_directory(value: &str) -> Result<DirectoryIdentity, String> {
    if !valid_canonical_path_string(value) {
        return Err("foundry-path-invalid".to_string());
    }
    let path = Path::new(value);
    let canonical = path
        .canonicalize()
        .map_err(|_| "foundry-path-invalid".to_string())?;
    if canonical != path {
        return Err("foundry-path-invalid".to_string());
    }
    inspect_exact_directory(&canonical)
}

fn inspect_fixed_child_directory(
    parent: &DirectoryIdentity,
    child: &str,
) -> Result<DirectoryIdentity, String> {
    inspect_directory_again(parent)?;
    let path = parent.canonical_path.join(child);
    let canonical = path
        .canonicalize()
        .map_err(|_| "foundry-path-invalid".to_string())?;
    if canonical != path {
        return Err("foundry-path-invalid".to_string());
    }
    let identity = inspect_exact_directory(&path)?;
    inspect_directory_again(parent)?;
    Ok(identity)
}

#[cfg(target_os = "linux")]
fn inspect_exact_directory(path: &Path) -> Result<DirectoryIdentity, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let path_metadata = fs::symlink_metadata(path).map_err(|_| "foundry-path-invalid")?;
    if path_metadata.file_type().is_symlink() || !path_metadata.is_dir() {
        return Err("foundry-path-invalid".to_string());
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| "foundry-path-invalid".to_string())?;
    let opened_metadata = file
        .metadata()
        .map_err(|_| "foundry-path-invalid".to_string())?;
    if !same_directory(&path_metadata, &opened_metadata) {
        return Err("foundry-path-invalid".to_string());
    }
    let final_metadata = fs::symlink_metadata(path).map_err(|_| "foundry-path-invalid")?;
    if final_metadata.file_type().is_symlink()
        || !final_metadata.is_dir()
        || !same_directory(&opened_metadata, &final_metadata)
    {
        return Err("foundry-path-invalid".to_string());
    }
    let final_canonical = path
        .canonicalize()
        .map_err(|_| "foundry-path-invalid".to_string())?;
    if final_canonical != path {
        return Err("foundry-path-invalid".to_string());
    }
    Ok(DirectoryIdentity {
        canonical_path: path.to_path_buf(),
        device: opened_metadata.dev(),
        inode: opened_metadata.ino(),
    })
}

#[cfg(not(target_os = "linux"))]
fn inspect_exact_directory(_path: &Path) -> Result<DirectoryIdentity, String> {
    Err("foundry-linux-only".to_string())
}

#[cfg(target_os = "linux")]
fn same_directory(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.is_dir() && right.is_dir() && left.dev() == right.dev() && left.ino() == right.ino()
}

fn inspect_directory_again(identity: &DirectoryIdentity) -> Result<(), String> {
    let current = inspect_exact_directory(&identity.canonical_path)?;
    if &current == identity {
        Ok(())
    } else {
        Err("foundry-stale-directory".to_string())
    }
}

fn revalidate_source_record(record: &SourceGrantRecord) -> Result<(), String> {
    inspect_directory_again(&record.root).map_err(|_| "source-grant-invalid".to_string())?;
    inspect_directory_again(&record.git_directory)
        .map_err(|_| "source-grant-invalid".to_string())?;
    inspect_directory_again(&record.object_directory)
        .map_err(|_| "source-grant-invalid".to_string())?;
    if record.git_directory.canonical_path != record.root.canonical_path.join(".git")
        || record.object_directory.canonical_path
            != record.git_directory.canonical_path.join("objects")
    {
        return Err("source-grant-invalid".to_string());
    }
    reject_object_alternates(&record.object_directory.canonical_path)
        .map_err(|_| "source-grant-invalid".to_string())?;
    Ok(())
}

fn revalidate_destination_parent_record(record: &DestinationGrantRecord) -> Result<(), String> {
    inspect_directory_again(&record.parent)
        .map_err(|_| "destination-parent-unavailable".to_string())?;
    if canonical_path_string(&record.parent.canonical_path)? != record.destination_grant.parent {
        return Err("destination-parent-grant-invalid".to_string());
    }
    Ok(())
}

fn reject_object_alternates(objects: &Path) -> Result<(), String> {
    match fs::symlink_metadata(objects.join("info").join("alternates")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err("source-repository-unavailable".to_string()),
    }
}

fn open_exact_repository(git_directory: &DirectoryIdentity) -> Result<Repository, String> {
    inspect_directory_again(git_directory).map_err(|_| "source-grant-invalid".to_string())?;
    let repository = Repository::open_bare(&git_directory.canonical_path)
        .map_err(|_| "source-repository-unavailable".to_string())?;
    let repository_path = repository
        .path()
        .canonicalize()
        .map_err(|_| "source-repository-unavailable".to_string())?;
    if repository_path != git_directory.canonical_path {
        return Err("source-repository-unavailable".to_string());
    }
    Ok(repository)
}

fn verify_expected_objects(
    repository: &Repository,
    expected: &ExpectedRepositoryIdentity,
) -> String {
    let commit = match repository.find_commit(expected.commit) {
        Ok(commit) => commit,
        Err(error) if error.code() == ErrorCode::NotFound => {
            return "source-commit-missing".to_string()
        }
        Err(_) => return "source-commit-unreadable".to_string(),
    };
    if commit.id() != expected.commit {
        return "source-commit-mismatched".to_string();
    }
    if commit.tree_id() != expected.tree {
        return "source-tree-mismatched".to_string();
    }
    if let Err(code) = read_object_as(repository, expected.commit, ObjectType::Commit, "commit") {
        return code;
    }
    if let Err(code) = read_object_as(repository, expected.tree, ObjectType::Tree, "tree") {
        return code;
    }

    let mut visited_trees = HashSet::new();
    let mut object_count = 0_usize;
    let mut object_bytes = 0_usize;
    if let Err(code) = verify_tree_objects(
        repository,
        expected.tree,
        0,
        &mut visited_trees,
        &mut object_count,
        &mut object_bytes,
    ) {
        return code;
    }
    "Verified".to_string()
}

fn read_object_as(
    repository: &Repository,
    oid: Oid,
    expected_kind: ObjectType,
    label: &str,
) -> Result<usize, String> {
    let odb = repository
        .odb()
        .map_err(|_| format!("source-{label}-unreadable"))?;
    let object = odb.read(oid).map_err(|error| {
        if error.code() == ErrorCode::NotFound {
            format!("source-{label}-missing")
        } else {
            format!("source-{label}-unreadable")
        }
    })?;
    if object.id() != oid {
        return Err(format!("source-{label}-fingerprint-invalid"));
    }
    if object.kind() != expected_kind {
        return Err(format!("source-{label}-mismatched"));
    }
    Ok(object.data().len())
}

fn verify_tree_objects(
    repository: &Repository,
    tree_oid: Oid,
    depth: usize,
    visited_trees: &mut HashSet<Oid>,
    object_count: &mut usize,
    object_bytes: &mut usize,
) -> Result<(), String> {
    if depth > MAXIMUM_TREE_DEPTH || !visited_trees.insert(tree_oid) {
        return Err("source-tree-fingerprint-invalid".to_string());
    }
    let tree = repository.find_tree(tree_oid).map_err(|error| {
        if error.code() == ErrorCode::NotFound {
            "source-tree-missing".to_string()
        } else {
            "source-tree-unreadable".to_string()
        }
    })?;
    for entry in tree.iter() {
        *object_count += 1;
        if *object_count > MAXIMUM_TREE_OBJECTS {
            return Err("source-tree-fingerprint-invalid".to_string());
        }
        match entry.kind() {
            Some(ObjectType::Blob) => {
                let bytes = read_object_as(repository, entry.id(), ObjectType::Blob, "blob")?;
                *object_bytes = object_bytes
                    .checked_add(bytes)
                    .ok_or_else(|| "source-blob-fingerprint-invalid".to_string())?;
                if *object_bytes > MAXIMUM_OBJECT_BYTES {
                    return Err("source-blob-fingerprint-invalid".to_string());
                }
            }
            Some(ObjectType::Tree) => verify_tree_objects(
                repository,
                entry.id(),
                depth + 1,
                visited_trees,
                object_count,
                object_bytes,
            )?,
            _ => return Err("source-blob-mismatched".to_string()),
        }
    }
    Ok(())
}

fn ensure_derived_absent(parent: &Path, mod_id: &str) -> Result<(), String> {
    match derived_entry_state(parent, mod_id) {
        Ok(false) => Ok(()),
        Ok(true) => Err("derived-destination-present".to_string()),
        Err(_) => Err("destination-parent-unavailable".to_string()),
    }
}

fn derived_entry_state(parent: &Path, mod_id: &str) -> Result<bool, String> {
    match fs::symlink_metadata(parent.join(mod_id)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("destination-parent-unavailable".to_string()),
    }
}

#[cfg(test)]
#[path = "xcom2_project_foundry/tests.rs"]
mod tests;
