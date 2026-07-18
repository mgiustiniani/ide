use std::collections::{HashMap, HashSet};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use git2::{ErrorCode, ObjectType, Oid, Repository};
use regex::Regex;
use serde::{Deserialize, Serialize};

const EXPECTED_COMMIT: &str = "d968be3c32b250376723563a743a120770ec5c95";
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
struct ExpectedRepositoryIdentity {
    commit: Oid,
    tree: Oid,
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
    mod_id: String,
    destination_grant: FoundryDestinationParentSelectionGrant,
    operation_grant: FoundryOperationGrant,
}

#[derive(Default)]
struct FoundryGrantStore {
    source_grants: HashMap<String, SourceGrantRecord>,
    destination_grants: HashMap<String, DestinationGrantRecord>,
    operation_to_destination: HashMap<String, String>,
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

/// Authorizes one selected existing parent and derives one absent child for the exact ModId.
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
        mod_id: request.mod_id,
        destination_grant: destination_grant.clone(),
        operation_grant: operation_grant.clone(),
    };
    revalidate_destination_record(&record)?;
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
        if record.operation_grant != request.operation_grant {
            return Err("operation-grant-invalid".to_string());
        }
        record.clone()
    };

    let state_result = match inspect_directory_again(&record.parent) {
        Ok(()) => match derived_entry_state(&record.parent.canonical_path, &record.mod_id) {
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

fn revoke_all(state: &Xcom2ProjectFoundryState) -> Result<(), String> {
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| "foundry-grant-revocation-failed".to_string())?;
    grants.source_grants.clear();
    grants.destination_grants.clear();
    grants.operation_to_destination.clear();
    Ok(())
}

fn total_grants(grants: &FoundryGrantStore) -> usize {
    grants.source_grants.len() + grants.destination_grants.len() * 2
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

fn revalidate_destination_record(record: &DestinationGrantRecord) -> Result<(), String> {
    inspect_directory_again(&record.parent)
        .map_err(|_| "destination-parent-unavailable".to_string())?;
    ensure_derived_absent(&record.parent.canonical_path, &record.mod_id)
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
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs::File;
    use std::io::Read;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
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

        fn string(&self) -> String {
            self.0.to_str().expect("UTF-8 test path").to_string()
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
            fs::write(root.0.join("tracked.txt"), b"committed bytes\n")
                .expect("write tracked fixture");
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

        let destination: AuthorizeFoundryDestinationParentRequest = serde_json::from_value(
            serde_json::json!({"selectedRoot": "/tmp/parent", "modId": "ExactMod"}),
        )
        .expect("camelCase destination request");
        assert_eq!(destination.mod_id, "ExactMod");

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
        fs::write(wrong_git.0.join(".git"), b"gitdir: elsewhere")
            .expect("write git indirection file");
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
    fn destination_authorization_derives_exact_absent_child_and_revalidates_it() {
        let parent = TestDirectory::new("destination-happy");
        fs::write(parent.0.join("sibling.canary"), b"unchanged")
            .expect("write destination sibling");
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

        symlink("missing-target", parent.0.join("DanglingChild"))
            .expect("dangling destination child");
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
        let second =
            authorize_destination_parent(&state, destination_request(&parent, "SecondMod"))
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
        let selection =
            authorize_destination_parent(&state, destination_request(&parent, "ExactMod"))
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

    fn snapshot(root: &Path) -> BTreeMap<String, (String, u32, Vec<u8>)> {
        fn visit(
            root: &Path,
            directory: &Path,
            output: &mut BTreeMap<String, (String, u32, Vec<u8>)>,
        ) {
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
}
