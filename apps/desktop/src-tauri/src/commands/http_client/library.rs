//! Explicit per-workspace HTTP collections in private IDE configuration storage.
use super::super::workspace_registry::{self, CurrentWorkspaceBinding};
use crate::{app_config, workspace};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
const LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    version: u8,
    requests: Vec<SavedRequest>,
    environments: Vec<Environment>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedRequest {
    collection: String,
    name: String,
    method: String,
    url: String,
    headers: Vec<Header>,
    body: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    name: String,
    value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Environment {
    name: String,
    variables: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    expected_revision: String,
    library: Library,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    expected_revision: String,
    file_path: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportAsRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    expected_revision: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    #[serde(flatten)]
    scope: LoadRequest,
    revision: String,
    file_path: String,
    byte_length: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    scope: LoadRequest,
    revision: String,
    library: Library,
}

fn text(value: &str, max: usize) -> bool {
    value.len() <= max && !value.contains('\0')
}
fn name(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && text(value, 128)
        && !value.chars().any(char::is_control)
}
fn validate(library: &Library) -> Result<(), String> {
    let invalid = || "Invalid HTTP collection data. Nothing was saved.".to_owned();
    if library.version != 1 || library.requests.len() > 100 || library.environments.len() > 32 {
        return Err(invalid());
    }
    let mut requests = BTreeSet::new();
    for entry in &library.requests {
        if !name(&entry.collection)
            || !name(&entry.name)
            || !requests.insert((&entry.collection, &entry.name))
            || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
                .contains(&entry.method.as_str())
            || !text(&entry.url, 8192)
            || !text(&entry.body, 1024 * 1024)
            || entry.headers.len() > 64
        {
            return Err(invalid());
        }
        let mut bytes = 0;
        for header in &entry.headers {
            if header.name.len() > 256
                || header.value.len() > 16 * 1024
                || reqwest::header::HeaderName::from_bytes(header.name.as_bytes()).is_err()
                || reqwest::header::HeaderValue::from_str(&header.value).is_err()
            {
                return Err(invalid());
            }
            bytes += header.name.len() + header.value.len();
        }
        if bytes > 64 * 1024 {
            return Err(invalid());
        }
    }
    let mut environments = BTreeSet::new();
    for entry in &library.environments {
        if !name(&entry.name) || !environments.insert(&entry.name) || entry.variables.len() > 64 {
            return Err(invalid());
        }
        for (key, value) in &entry.variables {
            if key.is_empty()
                || key.len() > 128
                || !key.bytes().enumerate().all(|(i, c)| {
                    c == b'_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit())
                })
                || !text(value, 8192)
            {
                return Err(invalid());
            }
        }
    }
    if serde_json::to_vec(library).map_err(|_| invalid())?.len() > LIMIT {
        return Err(invalid());
    }
    Ok(())
}
fn options() -> OpenOptions {
    let mut options = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    options
}
fn regular(file: &File) -> Result<(), String> {
    let metadata = file
        .metadata()
        .map_err(|_| "HTTP collection storage is unavailable.")?;
    if !metadata.is_file() {
        return Err("HTTP collection storage must be a regular file.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 || metadata.mode() & 0o077 != 0 {
            return Err("Linked or non-private HTTP collection files are refused.".into());
        }
    }
    Ok(())
}
fn directory(home: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(home).map_err(|_| "Cannot prepare IDE configuration storage.")?;
    let directory = home
        .canonicalize()
        .map_err(|_| "IDE configuration storage is unavailable.")?
        .join("http-client");
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    if let Err(error) = builder.create(&directory) {
        if error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err("Cannot prepare HTTP collection storage.".into());
        }
    }
    if !fs::symlink_metadata(&directory)
        .map_err(|_| "HTTP collection storage is unavailable.")?
        .is_dir()
    {
        return Err("Linked HTTP collection directories are refused.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect HTTP collection storage.")?;
    }
    Ok(directory)
}
fn bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    let file = match options().read(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read private HTTP collections.".into()),
    };
    regular(&file)?;
    if file
        .metadata()
        .map_err(|_| "Cannot inspect HTTP collections.")?
        .len()
        > LIMIT as u64
    {
        return Err("HTTP collections exceed the 2 MiB limit.".into());
    }
    let mut data = Vec::new();
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|_| "Cannot read HTTP collections.")?;
    if data.len() > LIMIT {
        return Err("HTTP collections exceed the 2 MiB limit.".into());
    }
    Ok(Some(data))
}
fn revision(scope: &str, epoch: u64, data: Option<&[u8]>) -> String {
    let mut hash = Sha256::new();
    hash.update(scope.as_bytes());
    hash.update(epoch.to_be_bytes());
    hash.update([u8::from(data.is_some())]);
    if let Some(data) = data {
        hash.update(data);
    }
    format!("{:x}", hash.finalize())
}
struct LibraryLock(File);
impl Drop for LibraryLock {
    fn drop(&mut self) {
        // A concurrently spawned child may retain the open file description until exec.
        // Explicit unlock releases the operation's lock even while that descriptor survives.
        let _ = File::unlock(&self.0);
    }
}
impl LibraryLock {
    fn acquire(path: &Path) -> Result<Self, String> {
        let file = options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(|_| "Cannot lock HTTP collections.")?;
        regular(&file)?;
        match file.try_lock() {
            Ok(()) => {}
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err("HTTP collections are in use by another window. Try again.".into())
            }
            Err(_) => return Err("HTTP collection storage could not acquire a file lock.".into()),
        }
        Ok(Self(file))
    }
}

fn store(
    home: &Path,
    scope: &str,
    epoch: u64,
    update: Option<(String, Library)>,
) -> Result<(String, Library), String> {
    let directory = directory(home)?;
    let key = format!("{:x}", Sha256::digest(scope.as_bytes()));
    let _lock = LibraryLock::acquire(&directory.join(format!("{key}.lock")))?;
    let path = directory.join(format!("{key}.json"));
    let data = bytes(&path)?;
    let current = revision(scope, epoch, data.as_deref());
    let library = match data.as_ref() {
        Some(data) => serde_json::from_slice::<Library>(data)
            .map_err(|_| "Stored HTTP collections are malformed; they were not replaced.")?,
        None => Library {
            version: 1,
            ..Library::default()
        },
    };
    validate(&library)?;
    let Some((expected, library)) = update else {
        return Ok((current, library));
    };
    if current != expected {
        return Err(
            "HTTP collections changed. Reload them before saving; your draft has been kept.".into(),
        );
    }
    validate(&library)?;
    let next = serde_json::to_vec(&library).map_err(|_| "Cannot encode HTTP collections.")?;
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).map_err(|_| "Cannot prepare HTTP collection save.")?;
    let temporary = directory.join(format!(".{:x}.tmp", u128::from_be_bytes(nonce)));
    let result = (|| {
        let mut file = options()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Cannot prepare HTTP collection save.")?;
        file.write_all(&next)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot save HTTP collections.")?;
        drop(file);
        fs::rename(&temporary, &path).map_err(|_| "Cannot publish HTTP collection save.")?;
        #[cfg(unix)]
        File::open(&directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| {
                "HTTP collections were saved but directory durability could not be verified."
            })?;
        Ok((revision(scope, epoch, Some(&next)), library))
    })();
    let _ = fs::remove_file(temporary);
    result
}
fn capture(request: &LoadRequest) -> Result<(CurrentWorkspaceBinding, u64), String> {
    workspace_registry::with_root_activation(|| {
        if !name(&request.request_id) {
            return Err("Invalid HTTP collection request identity.".into());
        }
        let binding = workspace_registry::current_workspace_binding_at(
            &workspace::workspace_root()?,
            &app_config::workspace_registry_path()?,
        )?;
        if binding.workspace_id != request.workspace_id {
            return Err("The HTTP collection workspace changed.".into());
        }
        Ok((binding, workspace_registry::active_workspace_generation()))
    })
}
async fn access(
    request: LoadRequest,
    update: Option<(String, Library)>,
) -> Result<Snapshot, String> {
    let (binding, epoch) = capture(&request)?;
    super::super::blocking::run(move || {
        workspace_registry::with_root_activation(|| {
            if workspace_registry::active_workspace_generation() != epoch
                || !workspace_registry::current_workspace_binding_is_current(&binding)
            {
                return Err("The HTTP collection workspace changed.".into());
            }
            let (revision, library) = store(
                &app_config::ide_home_dir()?,
                &binding.workspace_id,
                epoch,
                update,
            )?;
            Ok(Snapshot {
                scope: request,
                revision,
                library,
            })
        })
    })
    .await
}
#[tauri::command]
pub async fn load_http_library(request: LoadRequest) -> Result<Snapshot, String> {
    access(request, None).await
}
#[tauri::command]
pub async fn save_http_library(request: SaveRequest) -> Result<Snapshot, String> {
    let scope = LoadRequest {
        workspace_id: request.workspace_id,
        generation: request.generation,
        request_id: request.request_id,
    };
    access(scope, Some((request.expected_revision, request.library))).await
}

fn export_to(
    home: &Path,
    root: &Path,
    request: &ExportRequest,
    epoch: u64,
) -> Result<ExportResult, String> {
    let relative = Path::new(&request.file_path);
    if request.file_path.is_empty()
        || request.file_path.len() > 1024
        || relative.is_absolute()
        || request.file_path.contains(['\0', '\n', '\r', '\\'])
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        || relative.extension().and_then(|ext| ext.to_str()) != Some("json")
    {
        return Err(
            "Choose a workspace-relative .json path with an existing parent directory.".into(),
        );
    }
    let (revision, library) = store(home, &request.workspace_id, epoch, None)?;
    if revision != request.expected_revision {
        return Err("HTTP collections changed. Reload them before exporting.".into());
    }
    let target = workspace::resolve_new_path_in_root(root, relative)?;
    publish_export(
        &LoadRequest {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            request_id: request.request_id.clone(),
        },
        revision,
        &library,
        &target,
        request.file_path.clone(),
    )
}

fn publish_export(
    scope: &LoadRequest,
    revision: String,
    library: &Library,
    target: &Path,
    result_path: String,
) -> Result<ExportResult, String> {
    let parent = target
        .parent()
        .ok_or("The export file has no parent directory.")?;
    if !parent.is_dir() {
        return Err("The export parent directory does not exist.".into());
    }
    let bytes = serde_json::to_vec(library).map_err(|_| "Cannot encode HTTP collections.")?;
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).map_err(|_| "Cannot prepare HTTP collection export.")?;
    let temporary = parent.join(format!(
        ".ide-http-export-{:x}.tmp",
        u128::from_be_bytes(nonce)
    ));
    let result = (|| {
        let mut file = options()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Cannot prepare HTTP collection export.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot write HTTP collection export.")?;
        drop(file);
        // Atomic create-only publication refuses files, links and concurrent creators.
        fs::hard_link(&temporary, target).map_err(|_| {
            "The export destination already exists or cannot be created. Choose a new file name."
        })?;
        fs::remove_file(&temporary)
            .map_err(|_| "The export was created but temporary cleanup failed.")?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| {
                "The export was created but directory durability could not be verified."
            })?;
        Ok(ExportResult {
            scope: scope.clone(),
            revision,
            file_path: result_path,
            byte_length: bytes.len(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn export_as_to(
    home: &Path,
    selected: &Path,
    request: &ExportAsRequest,
    epoch: u64,
) -> Result<ExportResult, String> {
    let path_text = selected
        .to_str()
        .ok_or("Choose a UTF-8 file path for the export.")?;
    if !selected.is_absolute()
        || path_text.len() > 32768
        || path_text.chars().any(char::is_control)
        || selected.extension().and_then(|ext| ext.to_str()) != Some("json")
    {
        return Err("Choose a new .json file with an existing parent directory.".into());
    }
    let parent = selected
        .parent()
        .ok_or("The export file has no parent directory.")?;
    let parent = fs::canonicalize(parent)
        .map_err(|_| "The export parent directory does not exist or is unavailable.")?;
    if !parent.is_dir() {
        return Err("The export parent is not a directory.".into());
    }
    let target = parent.join(selected.file_name().ok_or("Choose an export file name.")?);
    let result_path = target
        .to_str()
        .ok_or("Choose a UTF-8 export directory.")?
        .to_owned();
    if result_path.len() > 32768 || result_path.chars().any(char::is_control) {
        return Err("Choose an export directory with a supported UTF-8 path.".into());
    }
    let (revision, library) = store(home, &request.workspace_id, epoch, None)?;
    if revision != request.expected_revision {
        return Err("HTTP collections changed. Reload them before exporting.".into());
    }
    publish_export(
        &LoadRequest {
            workspace_id: request.workspace_id.clone(),
            generation: request.generation,
            request_id: request.request_id.clone(),
        },
        revision,
        &library,
        &target,
        result_path,
    )
}

static EXPORT_DIALOG_PENDING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
struct ExportDialogGuard;
impl ExportDialogGuard {
    fn acquire() -> Result<Self, String> {
        EXPORT_DIALOG_PENDING
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .map(|_| Self)
            .map_err(|_| "An HTTP collection export dialog is already open.".into())
    }
}
impl Drop for ExportDialogGuard {
    fn drop(&mut self) {
        EXPORT_DIALOG_PENDING.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// The renderer cannot supply a destination: only the native dialog grants that choice.
#[tauri::command]
pub async fn export_http_library_as(
    window: tauri::WebviewWindow,
    request: ExportAsRequest,
) -> Result<Option<ExportResult>, String> {
    use tauri_plugin_dialog::DialogExt;
    if window.label() != "main" {
        return Err("HTTP collection export requires the main window.".into());
    }
    let guard = ExportDialogGuard::acquire()?;
    let scope = LoadRequest {
        workspace_id: request.workspace_id.clone(),
        generation: request.generation,
        request_id: request.request_id.clone(),
    };
    let (binding, epoch) = capture(&scope)?;
    super::super::blocking::run(move || {
        let _guard = guard;
        let home = app_config::ide_home_dir()?;
        workspace_registry::with_root_activation(|| {
            if workspace_registry::active_workspace_generation() != epoch
                || !workspace_registry::current_workspace_binding_is_current(&binding)
            {
                return Err("The HTTP collection workspace changed.".into());
            }
            let (revision, _) = store(&home, &request.workspace_id, epoch, None)?;
            if revision != request.expected_revision {
                return Err("HTTP collections changed. Reload them before exporting.".into());
            }
            Ok(())
        })?;
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export HTTP collections (plain text)")
            .set_file_name("http-collections.json")
            .add_filter("HTTP collections JSON", &["json"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let selected = selected
            .into_path()
            .map_err(|_| "The selected export destination is not a local file path.")?;
        workspace_registry::with_root_activation(|| {
            if workspace_registry::active_workspace_generation() != epoch
                || !workspace_registry::current_workspace_binding_is_current(&binding)
            {
                return Err(
                    "The HTTP collection workspace changed while choosing an export destination."
                        .into(),
                );
            }
            export_as_to(&home, &selected, &request, epoch).map(Some)
        })
    })
    .await
}

#[tauri::command]
pub async fn export_http_library(request: ExportRequest) -> Result<ExportResult, String> {
    let (binding, epoch) = capture(&LoadRequest {
        workspace_id: request.workspace_id.clone(),
        generation: request.generation,
        request_id: request.request_id.clone(),
    })?;
    super::super::blocking::run(move || {
        workspace_registry::with_root_activation(|| {
            if workspace_registry::active_workspace_generation() != epoch
                || !workspace_registry::current_workspace_binding_is_current(&binding)
            {
                return Err("The HTTP collection workspace changed.".into());
            }
            export_to(
                &app_config::ide_home_dir()?,
                &binding.canonical_root,
                &request,
                epoch,
            )
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0; 16];
            getrandom::fill(&mut nonce).unwrap();
            Self(
                std::env::temp_dir()
                    .join(format!("ide-http-library-{:x}", u128::from_be_bytes(nonce))),
            )
        }
        fn saved(&self) -> (String, Library) {
            let (revision, mut library) = store(&self.0, "workspace-one", 4, None).unwrap();
            library.requests.push(SavedRequest {
                collection: "API".into(),
                name: "Greeting".into(),
                method: "POST".into(),
                url: "{{baseUrl}}/hello".into(),
                headers: vec![],
                body: "{\"name\":\"{{name}}\"}".into(),
            });
            library.environments.push(Environment {
                name: "Local".into(),
                variables: BTreeMap::from([
                    ("baseUrl".into(), "http://localhost:8080".into()),
                    ("name".into(), "IDE".into()),
                ]),
            });
            store(&self.0, "workspace-one", 4, Some((revision, library))).unwrap()
        }
        fn data_path(&self) -> PathBuf {
            fs::read_dir(self.0.join("http-client"))
                .unwrap()
                .map(|v| v.unwrap().path())
                .find(|p| p.extension().is_some_and(|v| v == "json"))
                .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn exports_saved_templates_as_private_new_json_and_refuses_stale_or_escaping_targets() {
        let fixture = Fixture::new();
        let (revision, _) = fixture.saved();
        let root = fixture.0.join("workspace");
        fs::create_dir(&root).unwrap();
        let mut request: ExportRequest = serde_json::from_value(serde_json::json!({
            "workspaceId":"workspace-one", "generation":1, "requestId":"export-1",
            "expectedRevision":revision, "filePath":"shared.json"
        }))
        .unwrap();
        let before = fs::read(fixture.data_path()).unwrap();
        let exported = export_to(&fixture.0, &root, &request, 4).unwrap();
        assert_eq!(exported.revision, revision);
        assert_eq!(fs::read(root.join("shared.json")).unwrap(), before);
        assert_eq!(exported.byte_length, before.len());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join("shared.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o077,
                0
            );
        }
        assert!(export_to(&fixture.0, &root, &request, 4)
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(fs::read(root.join("shared.json")).unwrap(), before);
        for path in [
            "../escape.json",
            "/absolute.json",
            "Main.java",
            "missing/collection.json",
            "a\\b.json",
        ] {
            request.file_path = path.into();
            assert!(export_to(&fixture.0, &root, &request, 4).is_err(), "{path}");
        }
        request.file_path = "stale.json".into();
        request.expected_revision = "f".repeat(64);
        assert!(export_to(&fixture.0, &root, &request, 4)
            .unwrap_err()
            .contains("changed"));
        assert!(!root.join("stale.json").exists());
        assert_eq!(fs::read(fixture.data_path()).unwrap(), before);
        assert_eq!(
            fs::read_dir(&root).unwrap().count(),
            1,
            "No temporary export file may remain"
        );
    }

    #[test]
    fn persists_library_isolates_workspaces_and_refuses_stale_file_or_activation_revisions() {
        let fixture = Fixture::new();
        let (revision, library) = fixture.saved();
        let (reopened, loaded) = store(&fixture.0, "workspace-one", 4, None).unwrap();
        assert_eq!(revision, reopened);
        assert_eq!(loaded.requests[0].url, "{{baseUrl}}/hello");
        assert_eq!(loaded.environments[0].variables["name"], "IDE");
        assert!(store(&fixture.0, "workspace-two", 4, None)
            .unwrap()
            .1
            .requests
            .is_empty());
        let (next, _) = store(
            &fixture.0,
            "workspace-one",
            4,
            Some((revision.clone(), library.clone())),
        )
        .unwrap();
        // Same serialized data has the same revision; change real data to model a second window.
        let mut changed = library.clone();
        changed.requests[0].name = "Changed elsewhere".into();
        store(&fixture.0, "workspace-one", 4, Some((next, changed))).unwrap();
        assert!(store(
            &fixture.0,
            "workspace-one",
            4,
            Some((revision.clone(), library.clone()))
        )
        .is_err());
        let (latest, unchanged) = store(&fixture.0, "workspace-one", 4, None).unwrap();
        assert!(store(&fixture.0, "workspace-one", 5, Some((latest, unchanged))).is_err());
        assert_eq!(
            store(&fixture.0, "workspace-one", 4, None)
                .unwrap()
                .1
                .requests[0]
                .name,
            "Changed elsewhere"
        );
    }
    #[test]
    fn invalid_or_corrupt_data_is_not_overwritten_and_private_storage_is_bounded() {
        let fixture = Fixture::new();
        let (revision, mut library) = fixture.saved();
        let path = fixture.data_path();
        let before = fs::read(&path).unwrap();
        library.requests.push(library.requests[0].clone());
        assert!(store(&fixture.0, "workspace-one", 4, Some((revision, library))).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::write(&path, b"not JSON").unwrap();
        assert!(store(&fixture.0, "workspace-one", 4, None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"not JSON");
        fs::write(&path, vec![b' '; LIMIT + 1]).unwrap();
        assert!(store(&fixture.0, "workspace-one", 4, None).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o077, 0);
        }
    }
    #[test]
    #[cfg(unix)]
    fn releases_a_library_lock_even_while_a_forked_child_inherits_the_descriptor() {
        use std::os::fd::AsRawFd;
        use std::os::unix::net::UnixStream;
        struct InheritedChild {
            pid: libc::pid_t,
            control: UnixStream,
        }
        impl Drop for InheritedChild {
            fn drop(&mut self) {
                let _ = self.control.write_all(&[1]);
                // The child only waits for the byte above and then exits.
                unsafe {
                    libc::waitpid(self.pid, std::ptr::null_mut(), 0);
                }
            }
        }
        let fixture = Fixture::new();
        let path = directory(&fixture.0).unwrap().join("inherited.lock");
        let lock = LibraryLock::acquire(&path).unwrap();
        let (control, child_control) = UnixStream::pair().unwrap();
        let parent_fd = control.as_raw_fd();
        let child_fd = child_control.as_raw_fd();
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0);
        if pid == 0 {
            // After fork in a multithreaded test process, use async-signal-safe syscalls only.
            unsafe {
                libc::close(parent_fd);
                let mut byte = 0u8;
                libc::read(child_fd, &mut byte as *mut u8 as *mut libc::c_void, 1);
                libc::_exit(0);
            }
        }
        drop(child_control);
        let _child = InheritedChild { pid, control };
        drop(lock);
        assert!(
            LibraryLock::acquire(&path).is_ok(),
            "A forked child's descriptor must not keep a finished library operation locked"
        );
    }

    #[test]
    fn cooperating_windows_cannot_read_or_write_through_an_occupied_storage_lock() {
        let fixture = Fixture::new();
        fixture.saved();
        let path = fs::read_dir(fixture.0.join("http-client"))
            .unwrap()
            .map(|v| v.unwrap().path())
            .find(|p| p.extension().is_some_and(|v| v == "lock"))
            .unwrap();
        let lock = LibraryLock::acquire(&path).unwrap();
        assert!(store(&fixture.0, "workspace-one", 4, None)
            .unwrap_err()
            .contains("another window"));
        drop(lock);
        assert!(store(&fixture.0, "workspace-one", 4, None).is_ok());
    }
    #[test]
    #[cfg(unix)]
    fn refuses_symlinks_and_hard_links_without_modifying_their_targets() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.saved();
        let path = fixture.data_path();
        let external = fixture.0.join("external.json");
        fs::rename(&path, &external).unwrap();
        let original = fs::read(&external).unwrap();
        symlink(&external, &path).unwrap();
        assert!(store(&fixture.0, "workspace-one", 4, None).is_err());
        assert_eq!(fs::read(&external).unwrap(), original);
        fs::remove_file(&path).unwrap();
        fs::hard_link(&external, &path).unwrap();
        assert!(store(&fixture.0, "workspace-one", 4, None).is_err());
        let other = Fixture::new();
        fs::create_dir_all(&other.0).unwrap();
        symlink(&fixture.0, other.0.join("http-client")).unwrap();
        assert!(store(&other.0, "workspace-one", 4, None).is_err());
        assert_eq!(fs::read(&external).unwrap(), original);
    }

    #[test]
    fn selected_external_export_keeps_saved_templates_private_and_workspace_untouched() {
        let fixture = Fixture::new();
        let (revision, _) = fixture.saved();
        let workspace = fixture.0.join("workspace");
        let shared = fixture.0.join("shared");
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(&shared).unwrap();
        fs::write(workspace.join("Main.java"), b"class Main {}\n").unwrap();
        let before = fs::read(fixture.data_path()).unwrap();
        let selected = shared.join("raccolte caffè.json");
        let request = ExportAsRequest {
            workspace_id: "workspace-one".into(),
            generation: 1,
            request_id: "save-as".into(),
            expected_revision: revision.clone(),
        };
        let result = export_as_to(&fixture.0, &selected, &request, 4).unwrap();
        assert_eq!(result.file_path, selected.to_str().unwrap());
        assert_eq!(result.revision, revision);
        assert_eq!(fs::read(&selected).unwrap(), before);
        assert_eq!(fs::read(fixture.data_path()).unwrap(), before);
        assert_eq!(
            fs::read(workspace.join("Main.java")).unwrap(),
            b"class Main {}\n"
        );
        assert_eq!(fs::read_dir(&workspace).unwrap().count(), 1);
        assert_eq!(fs::read_dir(&shared).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            let metadata = fs::metadata(&selected).unwrap();
            assert_eq!(metadata.permissions().mode() & 0o077, 0);
            assert_eq!(metadata.nlink(), 1);
        }
        assert!(export_as_to(&fixture.0, &selected, &request, 4)
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(fs::read(&selected).unwrap(), before);
        assert_eq!(fs::read_dir(&shared).unwrap().count(), 1);
    }

    #[test]
    fn external_export_refuses_changed_collections_invalid_paths_and_existing_links() {
        let fixture = Fixture::new();
        let (revision, _) = fixture.saved();
        let shared = fixture.0.join("shared");
        fs::create_dir(&shared).unwrap();
        let mut request = ExportAsRequest {
            workspace_id: "workspace-one".into(),
            generation: 1,
            request_id: "save-as".into(),
            expected_revision: revision,
        };
        for selected in [
            PathBuf::from("relative.json"),
            shared.join("Main.java"),
            shared.join("missing/collections.json"),
            shared.join("line\nbreak.json"),
        ] {
            assert!(export_as_to(&fixture.0, &selected, &request, 4).is_err());
        }
        request.expected_revision = "f".repeat(64);
        assert!(
            export_as_to(&fixture.0, &shared.join("stale.json"), &request, 4)
                .unwrap_err()
                .contains("changed")
        );
        assert_eq!(fs::read_dir(&shared).unwrap().count(), 0);
        request.expected_revision = store(&fixture.0, "workspace-one", 4, None).unwrap().0;
        // Reacquiring the same library under another native activation also retires the revision.
        assert!(
            export_as_to(&fixture.0, &shared.join("old-activation.json"), &request, 5)
                .unwrap_err()
                .contains("changed")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = fixture.0.join("keep.txt");
            fs::write(&target, b"keep original").unwrap();
            let selected = shared.join("existing.json");
            symlink(&target, &selected).unwrap();
            assert!(export_as_to(&fixture.0, &selected, &request, 4).is_err());
            assert_eq!(fs::read(&target).unwrap(), b"keep original");
            assert!(fs::symlink_metadata(&selected)
                .unwrap()
                .file_type()
                .is_symlink());
            fs::remove_file(&selected).unwrap();
            fs::hard_link(&target, &selected).unwrap();
            assert!(export_as_to(&fixture.0, &selected, &request, 4).is_err());
            assert_eq!(fs::read(&target).unwrap(), b"keep original");
            assert_eq!(fs::read_dir(&shared).unwrap().count(), 1);
        }
    }

    #[test]
    fn native_save_dialog_request_does_not_accept_a_renderer_supplied_destination() {
        let mut json = serde_json::json!({"workspaceId":"workspace-one","generation":1,"requestId":"save-as","expectedRevision":"a".repeat(64)});
        assert!(serde_json::from_value::<ExportAsRequest>(json.clone()).is_ok());
        json["filePath"] = serde_json::json!("/arbitrary/renderer/path.json");
        assert!(serde_json::from_value::<ExportAsRequest>(json).is_err());
    }
}
