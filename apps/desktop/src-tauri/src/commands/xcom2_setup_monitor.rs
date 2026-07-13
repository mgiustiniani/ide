use std::collections::VecDeque;
use std::env;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::app_config::now_rfc3339;
use crate::commands::workspace_registry::workspace_id_for_path;
use crate::workspace::workspace_root;

const GAME_APP_ID: u32 = 268_500;
const WOTC_TOOLS_APP_ID: u32 = 602_410;
const VANILLA_TOOLS_APP_ID: u32 = 299_990;
const MAX_VDF_BYTES: u64 = 1024 * 1024;
const MAX_VDF_DEPTH: usize = 16;
const MAX_VDF_ENTRIES: usize = 16_384;
const MAX_TOKEN_BYTES: usize = 16_384;
const EVENT_CAPACITY: usize = 64;
const RECENT_ACTIVITY: Duration = Duration::from_secs(15 * 60);
const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProductIdentifier {
    app_id: u32,
    name: &'static str,
    kind: &'static str,
    role: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ByteCount {
    Number(u64),
    Decimal(String),
}

impl From<u64> for ByteCount {
    fn from(value: u64) -> Self {
        if value <= JS_MAX_SAFE_INTEGER {
            Self::Number(value)
        } else {
            Self::Decimal(value.to_string())
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestProvenance {
    source: &'static str,
    display_path: String,
    path_redacted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProductStatus {
    product: ProductIdentifier,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_provenance: Option<ManifestProvenance>,
    lifecycle: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    state_flags: Option<ByteCount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_downloaded: Option<ByteCount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_to_download: Option<ByteCount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_staged: Option<ByteCount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes_to_stage: Option<ByteCount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    download_percentage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    staging_percentage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_on_disk: Option<ByteCount>,
    install_directory_present: bool,
    download_directory_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_last_modified_at: Option<String>,
    complete: bool,
    completion_reasons: Vec<String>,
    stable: bool,
    stability_reasons: Vec<String>,
    mutation_blocked: bool,
    mutation_blocked_reasons: Vec<String>,
    checked_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupMonitorSnapshot {
    workspace_id: String,
    generation: u64,
    steam_root: SteamRootProvenance,
    products: Vec<ProductStatus>,
    overall_state: &'static str,
    can_plan_setup: bool,
    can_apply_setup: bool,
    blockers: Vec<String>,
    warnings: Vec<String>,
    checked_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SteamRootProvenance {
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_root: Option<String>,
    path_redacted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupMonitorEvent {
    #[serde(rename = "type")]
    event_type: &'static str,
    cause: &'static str,
    sequence: u64,
    snapshot: SetupMonitorSnapshot,
}

#[derive(Default)]
struct MonitorInner {
    workspace_id: Option<String>,
    generation: u64,
    sequence: u64,
    snapshot: Option<SetupMonitorSnapshot>,
    material: Option<String>,
    events: VecDeque<SetupMonitorEvent>,
}

#[derive(Default)]
pub struct Xcom2SetupMonitorState(Mutex<MonitorInner>);

#[derive(Debug, Clone)]
pub(crate) struct SetupTransactionGate {
    pub workspace_id: String,
    pub generation: u64,
    pub ready: bool,
    pub blockers: Vec<String>,
    pub products: [NativeProductInstall; 2],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeProductInstall {
    pub app_id: u32,
    pub build_id: String,
    pub state_flags: u64,
    pub manifest_sha256: String,
    pub manifest_bytes: u64,
    pub manifest_path: PathBuf,
    pub install_root: PathBuf,
}

pub(crate) fn discover_native_setup_products() -> Result<[NativeProductInstall; 2], String> {
    let roots = discover_steamapps_roots()?;
    Ok([
        inspect_native_install(&roots, GAME_APP_ID)?,
        inspect_native_install(&roots, WOTC_TOOLS_APP_ID)?,
    ])
}

fn inspect_native_install(
    roots: &[SteamappsRoot],
    app_id: u32,
) -> Result<NativeProductInstall, String> {
    for root in roots {
        let manifest_path = root.path.join(format!("appmanifest_{app_id}.acf"));
        if !manifest_path.exists() {
            continue;
        }
        ensure_bounded_child_file(&root.path, &manifest_path)?;
        let bytes = fs::read(&manifest_path).map_err(|error| error.to_string())?;
        let text =
            std::str::from_utf8(&bytes).map_err(|_| "Steam manifest is not UTF-8".to_string())?;
        let document = parse_vdf(text)?;
        let app_state =
            object_named(&document, "AppState").ok_or("Manifest has no AppState object")?;
        if direct_u64(app_state, "appid") != Some(u64::from(app_id)) {
            return Err("Manifest AppID does not match its allowlisted filename".to_string());
        }
        let state_flags =
            direct_u64(app_state, "StateFlags").ok_or("Manifest has no StateFlags")?;
        let update_work = state_flags & 2 != 0 || state_flags & 1024 != 0;
        let incomplete = incomplete_counter(
            direct_u64(app_state, "BytesDownloaded"),
            direct_u64(app_state, "BytesToDownload"),
        ) || incomplete_counter(
            direct_u64(app_state, "BytesStaged"),
            direct_u64(app_state, "BytesToStage"),
        );
        if state_flags & 4 == 0 || update_work || incomplete {
            return Err(format!("Steam AppID {app_id} is incomplete or updating"));
        }
        if bounded_directory_present(
            &root.path,
            &root.path.join("downloading").join(app_id.to_string()),
        ) {
            return Err(format!("Steam AppID {app_id} has pending download state"));
        }
        let install_name = direct_string(app_state, "installdir")
            .filter(|name| safe_directory_name(name))
            .ok_or("Manifest has no safe install directory")?;
        let install_root = root.path.join("common").join(install_name);
        if !bounded_directory_present(&root.path, &install_root) {
            return Err(format!("Steam AppID {app_id} install root is unavailable"));
        }
        let install_root = install_root
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let manifest_path = manifest_path
            .canonicalize()
            .map_err(|error| error.to_string())?;
        return Ok(NativeProductInstall {
            app_id,
            build_id: direct_string(app_state, "buildid")
                .filter(|value| !value.is_empty())
                .ok_or("Manifest has no buildid")?
                .to_string(),
            state_flags,
            manifest_sha256: format!("{:x}", Sha256::digest(&bytes)),
            manifest_bytes: bytes.len() as u64,
            manifest_path,
            install_root,
        });
    }
    Err(format!("Steam AppID {app_id} manifest was not found"))
}

pub(crate) fn setup_transaction_gate(
    state: &Xcom2SetupMonitorState,
) -> Result<SetupTransactionGate, String> {
    // A transaction check must refresh the read-only evidence rather than trust a
    // cached monitor sample. Native discovery then adds exact build, manifest,
    // install-root, and completion evidence for the audit and approval digest.
    let snapshot = update_snapshot(state, "transaction-check", true)?;
    let products = discover_native_setup_products()?;
    Ok(SetupTransactionGate {
        workspace_id: snapshot.workspace_id,
        generation: snapshot.generation,
        ready: snapshot.can_plan_setup && snapshot.blockers.is_empty(),
        blockers: snapshot.blockers,
        products,
    })
}

#[tauri::command]
pub fn get_xcom2_setup_monitor_snapshot(
    state: tauri::State<'_, Xcom2SetupMonitorState>,
) -> Result<SetupMonitorSnapshot, String> {
    update_snapshot(&state, "initial", false)
}

#[tauri::command]
pub fn refresh_xcom2_setup_monitor_snapshot(
    state: tauri::State<'_, Xcom2SetupMonitorState>,
) -> Result<SetupMonitorSnapshot, String> {
    update_snapshot(&state, "refresh", true)
}

#[tauri::command]
pub fn poll_xcom2_setup_monitor_events(
    after_sequence: u64,
    limit: usize,
    state: tauri::State<'_, Xcom2SetupMonitorState>,
) -> Result<Vec<SetupMonitorEvent>, String> {
    let workspace_id = workspace_id_for_path(&workspace_root()?);
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "XCOM 2 monitor state is poisoned")?;
    synchronize_workspace(&mut inner, &workspace_id);
    Ok(poll_events(&inner, after_sequence, limit))
}

fn update_snapshot(
    state: &Xcom2SetupMonitorState,
    cause: &'static str,
    force_refresh: bool,
) -> Result<SetupMonitorSnapshot, String> {
    let root = workspace_root()?;
    let workspace_id = workspace_id_for_path(&root);
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "XCOM 2 monitor state is poisoned")?;

    synchronize_workspace(&mut inner, &workspace_id);
    if !force_refresh {
        if let Some(snapshot) = &inner.snapshot {
            return Ok(snapshot.clone());
        }
    }

    let (snapshot, had_error) =
        build_snapshot(workspace_id, inner.generation, discover_steamapps_roots());
    let material = material_key(&snapshot)?;
    let changed = inner.material.as_deref() != Some(&material);
    if changed || had_error || inner.snapshot.is_none() {
        inner.sequence = inner.sequence.saturating_add(1);
        let event = SetupMonitorEvent {
            event_type: "snapshot",
            cause,
            sequence: inner.sequence,
            snapshot: snapshot.clone(),
        };
        inner.events.push_back(event);
        while inner.events.len() > EVENT_CAPACITY {
            inner.events.pop_front();
        }
    }
    inner.material = Some(material);
    inner.snapshot = Some(snapshot.clone());
    Ok(snapshot)
}

fn synchronize_workspace(inner: &mut MonitorInner, workspace_id: &str) {
    if inner.workspace_id.as_deref() != Some(workspace_id) {
        inner.workspace_id = Some(workspace_id.to_string());
        inner.generation = inner.generation.saturating_add(1).max(1);
        inner.snapshot = None;
        inner.material = None;
        inner.events.clear();
    }
}

fn material_key(snapshot: &SetupMonitorSnapshot) -> Result<String, String> {
    let mut copy = snapshot.clone();
    copy.checked_at.clear();
    for product in &mut copy.products {
        product.checked_at.clear();
    }
    serde_json::to_string(&copy)
        .map_err(|error| format!("Cannot compare monitor snapshot: {error}"))
}

fn poll_events(inner: &MonitorInner, after_sequence: u64, limit: usize) -> Vec<SetupMonitorEvent> {
    inner
        .events
        .iter()
        .filter(|event| event.sequence > after_sequence)
        .take(limit.min(EVENT_CAPACITY))
        .cloned()
        .collect()
}

#[derive(Debug, Clone)]
struct SteamappsRoot {
    path: PathBuf,
    label: String,
}

fn discover_steamapps_roots() -> Result<Vec<SteamappsRoot>, String> {
    let home = user_home()
        .ok_or_else(|| "Cannot determine the user home for Steam discovery".to_string())?;
    let candidates = if cfg!(target_os = "windows") {
        vec![
            home.join("AppData/Local/Steam"),
            PathBuf::from(r"C:\Program Files (x86)\Steam"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![home.join("Library/Application Support/Steam")]
    } else {
        vec![
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        ]
    };
    discover_roots_from_candidates(&candidates)
}

fn user_home() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        env::var_os("USERPROFILE").map(PathBuf::from)
    } else {
        env::var_os("HOME").map(PathBuf::from)
    }
}

fn discover_roots_from_candidates(candidates: &[PathBuf]) -> Result<Vec<SteamappsRoot>, String> {
    let mut roots = Vec::new();
    for candidate in candidates {
        let steam_root = match candidate.canonicalize() {
            Ok(path) if path.is_dir() => path,
            _ => continue,
        };
        add_steamapps_root(
            &mut roots,
            &steam_root.join("steamapps"),
            "Primary Steam library",
        );
        let library_file = steam_root.join("steamapps/libraryfolders.vdf");
        if let Ok(document) = read_vdf_file(&library_file) {
            if let Ok(entries) = parse_vdf(&document) {
                if let Some(libraries) = object_named(&entries, "libraryfolders") {
                    for entry in libraries {
                        let Some(object) = entry.value.as_object() else {
                            continue;
                        };
                        let Some(path) = direct_string(object, "path") else {
                            continue;
                        };
                        add_steamapps_root(
                            &mut roots,
                            &PathBuf::from(path).join("steamapps"),
                            "Additional Steam library",
                        );
                    }
                }
            }
        }
    }
    roots.sort_by(|a, b| a.path.cmp(&b.path));
    roots.dedup_by(|a, b| a.path == b.path);
    Ok(roots)
}

fn add_steamapps_root(roots: &mut Vec<SteamappsRoot>, candidate: &Path, label: &str) {
    if let Ok(path) = candidate.canonicalize() {
        if path.is_dir() {
            roots.push(SteamappsRoot {
                path,
                label: label.to_string(),
            });
        }
    }
}

fn build_snapshot(
    workspace_id: String,
    generation: u64,
    roots: Result<Vec<SteamappsRoot>, String>,
) -> (SetupMonitorSnapshot, bool) {
    let checked_at = now_rfc3339();
    let mut warnings = Vec::new();
    let mut had_error = false;
    let roots = match roots {
        Ok(roots) => roots,
        Err(error) => {
            warnings.push(error);
            had_error = true;
            Vec::new()
        }
    };
    let products_spec = [
        (GAME_APP_ID, "XCOM 2", "game", "required"),
        (
            WOTC_TOOLS_APP_ID,
            "XCOM 2: War of the Chosen Development Tools",
            "development-tools",
            "required",
        ),
        (
            VANILLA_TOOLS_APP_ID,
            "XCOM 2 Development Tools",
            "development-tools",
            "related-evidence",
        ),
    ];
    let mut products = Vec::new();
    for (app_id, name, kind, role) in products_spec {
        let product = ProductIdentifier {
            app_id,
            name,
            kind,
            role,
        };
        match inspect_product(&roots, product.clone(), &checked_at) {
            Ok(status) => products.push(status),
            Err(error) => {
                warnings.push(format!(
                    "{} metadata could not be read: {error}",
                    product.name
                ));
                had_error = true;
                products.push(missing_status(
                    product,
                    &checked_at,
                    "Manifest metadata was rejected or unreadable",
                ));
            }
        }
    }

    let required: Vec<_> = products
        .iter()
        .filter(|item| item.product.role == "required")
        .collect();
    let mut blockers = Vec::new();
    for product in &required {
        if !product.complete {
            blockers.push(format!(
                "{} download or installation is incomplete",
                product.product.name
            ));
        }
        if !product.stable {
            blockers.push(format!("{} is not stable", product.product.name));
        }
    }
    let overall_state = aggregate_state(&required);
    let setup_ready = required
        .iter()
        .all(|product| product.complete && product.stable);
    let steam_root = SteamRootProvenance {
        source: if roots.is_empty() {
            "unknown"
        } else {
            "platform-default"
        },
        display_root: roots.first().map(|root| root.label.clone()),
        path_redacted: true,
    };
    (
        SetupMonitorSnapshot {
            workspace_id,
            generation,
            steam_root,
            products,
            overall_state,
            can_plan_setup: setup_ready,
            // Monitoring establishes planning evidence only. Apply availability
            // is produced by a concrete native audit and digest-bound transaction.
            can_apply_setup: false,
            blockers,
            warnings,
            checked_at,
        },
        had_error,
    )
}

fn aggregate_state(required: &[&ProductStatus]) -> &'static str {
    for state in [
        "downloading",
        "staging",
        "verifying",
        "paused",
        "incomplete",
        "unknown",
        "not-found",
    ] {
        if required.iter().any(|product| product.lifecycle == state) {
            return state;
        }
    }
    if required
        .iter()
        .all(|product| product.complete && product.stable)
    {
        "ready"
    } else {
        "incomplete"
    }
}

fn inspect_product(
    roots: &[SteamappsRoot],
    product: ProductIdentifier,
    checked_at: &str,
) -> Result<ProductStatus, String> {
    for root in roots {
        let manifest = root
            .path
            .join(format!("appmanifest_{}.acf", product.app_id));
        if !manifest.exists() {
            continue;
        }
        ensure_bounded_child_file(&root.path, &manifest)?;
        let metadata = fs::metadata(&manifest).map_err(|error| error.to_string())?;
        let text = read_vdf_file(&manifest)?;
        let document = parse_vdf(&text)?;
        let app_state =
            object_named(&document, "AppState").ok_or("Manifest has no AppState object")?;
        let manifest_app_id =
            direct_u64(app_state, "appid").ok_or("Manifest has no valid appid")?;
        if manifest_app_id != u64::from(product.app_id) {
            return Err("Manifest AppID does not match its allowlisted filename".to_string());
        }

        let flags = direct_u64(app_state, "StateFlags");
        let downloaded = direct_u64(app_state, "BytesDownloaded");
        let to_download = direct_u64(app_state, "BytesToDownload");
        let staged = direct_u64(app_state, "BytesStaged");
        let to_stage = direct_u64(app_state, "BytesToStage");
        let size = direct_u64(app_state, "SizeOnDisk");
        let install_name =
            direct_string(app_state, "installdir").filter(|name| safe_directory_name(name));
        let install_present = install_name
            .map(|name| bounded_directory_present(&root.path, &root.path.join("common").join(name)))
            .unwrap_or(false);
        let download_present = bounded_directory_present(
            &root.path,
            &root
                .path
                .join("downloading")
                .join(product.app_id.to_string()),
        );
        let modified = metadata.modified().ok();
        let recent = modified
            .and_then(|time| SystemTime::now().duration_since(time).ok())
            .is_some_and(|age| age <= RECENT_ACTIVITY);
        let progress_incomplete = incomplete_counter(downloaded, to_download);
        let staging_incomplete = incomplete_counter(staged, to_stage);
        let active_flag = flags.is_some_and(|value| value & 1024 != 0);
        let update_flag = flags.is_some_and(|value| value & 2 != 0);
        let fully_installed_flag = flags.is_some_and(|value| value & 4 != 0);
        let lifecycle = if staging_incomplete && (recent || active_flag) {
            "staging"
        } else if progress_incomplete && (recent || active_flag || download_present) {
            "downloading"
        } else if progress_incomplete || staging_incomplete || update_flag || download_present {
            "paused"
        } else if fully_installed_flag && install_present {
            "installed"
        } else if install_present {
            "incomplete"
        } else {
            "unknown"
        };
        let complete = lifecycle == "installed"
            && !progress_incomplete
            && !staging_incomplete
            && !update_flag
            && !download_present;
        let stable = complete && !recent;
        let completion_reasons = if complete {
            vec![
                "Steam reports a fully installed product with no pending byte counters".to_string(),
            ]
        } else {
            let mut reasons = Vec::new();
            if progress_incomplete {
                reasons.push("Download byte counters are incomplete".to_string());
            }
            if staging_incomplete {
                reasons.push("Staging byte counters are incomplete".to_string());
            }
            if update_flag {
                reasons.push("Steam StateFlags indicate update work".to_string());
            }
            if !install_present {
                reasons.push("Install directory metadata is absent".to_string());
            }
            if reasons.is_empty() {
                reasons.push("Completeness cannot be established conservatively".to_string());
            }
            reasons
        };
        let stability_reasons = if stable {
            vec!["Manifest is complete and has no recent activity".to_string()]
        } else if recent {
            vec!["Manifest changed recently".to_string()]
        } else {
            vec!["Product is not complete".to_string()]
        };
        let mutation_blocked_reasons = if complete && stable {
            vec!["This built-in monitor is read-only".to_string()]
        } else {
            vec![
                "Product is incomplete or unstable".to_string(),
                "This built-in monitor is read-only".to_string(),
            ]
        };
        return Ok(ProductStatus {
            product,
            manifest_provenance: Some(ManifestProvenance {
                source: "steam-appmanifest",
                display_path: format!("appmanifest_{}.acf", manifest_app_id),
                path_redacted: true,
            }),
            lifecycle,
            state_flags: flags.map(Into::into),
            bytes_downloaded: downloaded.map(Into::into),
            bytes_to_download: to_download.map(Into::into),
            bytes_staged: staged.map(Into::into),
            bytes_to_stage: to_stage.map(Into::into),
            download_percentage: percentage(downloaded, to_download),
            staging_percentage: percentage(staged, to_stage),
            size_on_disk: size.map(Into::into),
            install_directory_present: install_present,
            download_directory_present: download_present,
            manifest_last_modified_at: modified.map(system_time_rfc3339),
            complete,
            completion_reasons,
            stable,
            stability_reasons,
            mutation_blocked: true,
            mutation_blocked_reasons,
            checked_at: checked_at.to_string(),
        });
    }
    Ok(missing_status(
        product,
        checked_at,
        "Steam appmanifest was not found",
    ))
}

fn missing_status(product: ProductIdentifier, checked_at: &str, reason: &str) -> ProductStatus {
    ProductStatus {
        product,
        manifest_provenance: None,
        lifecycle: "not-found",
        state_flags: None,
        bytes_downloaded: None,
        bytes_to_download: None,
        bytes_staged: None,
        bytes_to_stage: None,
        download_percentage: None,
        staging_percentage: None,
        size_on_disk: None,
        install_directory_present: false,
        download_directory_present: false,
        manifest_last_modified_at: None,
        complete: false,
        completion_reasons: vec![reason.to_string()],
        stable: false,
        stability_reasons: vec!["Product state is unavailable".to_string()],
        mutation_blocked: true,
        mutation_blocked_reasons: vec![
            "Product is unavailable".to_string(),
            "This built-in monitor is read-only".to_string(),
        ],
        checked_at: checked_at.to_string(),
    }
}

fn incomplete_counter(completed: Option<u64>, total: Option<u64>) -> bool {
    matches!((completed, total), (Some(done), Some(total)) if total > 0 && done < total)
}

fn percentage(completed: Option<u64>, total: Option<u64>) -> Option<f64> {
    let (completed, total) = (completed?, total?);
    if total == 0 {
        return None;
    }
    let clamped = completed.min(total);
    Some(((u128::from(clamped) * 10_000) / u128::from(total)) as f64 / 100.0)
}

fn safe_directory_name(value: &str) -> bool {
    !value.is_empty() && value != "." && value != ".." && !value.contains(['/', '\\', '\0'])
}

fn bounded_directory_present(root: &Path, candidate: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(candidate) else {
        return false;
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return false;
    }
    candidate
        .canonicalize()
        .is_ok_and(|path| path.starts_with(root))
}

fn ensure_bounded_child_file(root: &Path, path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Manifest is not a regular file".to_string());
    }
    if metadata.len() > MAX_VDF_BYTES {
        return Err("Manifest exceeds the size limit".to_string());
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("Manifest escapes its Steam library".to_string());
    }
    Ok(())
}

fn read_vdf_file(path: &Path) -> Result<String, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("Cannot inspect metadata: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("VDF source is not a regular file".to_string());
    }
    if metadata.len() > MAX_VDF_BYTES {
        return Err("VDF source exceeds the size limit".to_string());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| format!("Cannot open VDF source: {error}"))?
        .take(MAX_VDF_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read VDF source: {error}"))?;
    if bytes.len() as u64 > MAX_VDF_BYTES {
        return Err("VDF source exceeds the size limit".to_string());
    }
    if bytes.contains(&0) {
        return Err("VDF source contains NUL data".to_string());
    }
    let text = String::from_utf8(bytes).map_err(|_| "VDF source is not UTF-8".to_string())?;
    if text
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("VDF source contains unsupported control data".to_string());
    }
    Ok(text)
}

#[derive(Debug)]
struct Entry {
    key: String,
    value: Value,
}
#[derive(Debug)]
enum Value {
    String(String),
    Object(Vec<Entry>),
}
impl Value {
    fn as_object(&self) -> Option<&[Entry]> {
        if let Self::Object(entries) = self {
            Some(entries)
        } else {
            None
        }
    }
}

fn parse_vdf(input: &str) -> Result<Vec<Entry>, String> {
    let mut parser = Parser {
        bytes: input.as_bytes(),
        position: 0,
        entries: 0,
    };
    let result = parser.parse_entries(0, false)?;
    parser.skip_space_and_comments()?;
    if parser.position != parser.bytes.len() {
        return Err("Unexpected trailing VDF data".to_string());
    }
    Ok(result)
}

struct Parser<'a> {
    bytes: &'a [u8],
    position: usize,
    entries: usize,
}
impl Parser<'_> {
    fn parse_entries(&mut self, depth: usize, expect_close: bool) -> Result<Vec<Entry>, String> {
        if depth > MAX_VDF_DEPTH {
            return Err("VDF nesting limit exceeded".to_string());
        }
        let mut entries = Vec::new();
        loop {
            self.skip_space_and_comments()?;
            if self.peek() == Some(b'}') {
                if !expect_close {
                    return Err("Unexpected closing brace".to_string());
                }
                self.position += 1;
                return Ok(entries);
            }
            if self.peek().is_none() {
                return if expect_close {
                    Err("Unclosed VDF object".to_string())
                } else {
                    Ok(entries)
                };
            }
            let key = self.quoted()?;
            self.skip_space_and_comments()?;
            let value = if self.peek() == Some(b'{') {
                self.position += 1;
                Value::Object(self.parse_entries(depth + 1, true)?)
            } else {
                Value::String(self.quoted()?)
            };
            self.entries += 1;
            if self.entries > MAX_VDF_ENTRIES {
                return Err("VDF entry limit exceeded".to_string());
            }
            entries.push(Entry { key, value });
        }
    }
    fn quoted(&mut self) -> Result<String, String> {
        if self.peek() != Some(b'"') {
            return Err("Expected quoted VDF token".to_string());
        }
        self.position += 1;
        let mut token = Vec::new();
        while let Some(byte) = self.peek() {
            self.position += 1;
            match byte {
                b'"' => {
                    return String::from_utf8(token).map_err(|_| "Invalid UTF-8 token".to_string())
                }
                b'\\' => {
                    let escaped = self.peek().ok_or("Unclosed VDF escape")?;
                    self.position += 1;
                    token.push(match escaped {
                        b'"' => b'"',
                        b'\\' => b'\\',
                        b'n' => b'\n',
                        b't' => b'\t',
                        other => other,
                    });
                }
                other => token.push(other),
            }
            if token.len() > MAX_TOKEN_BYTES {
                return Err("VDF token limit exceeded".to_string());
            }
        }
        Err("Unclosed quoted VDF token".to_string())
    }
    fn skip_space_and_comments(&mut self) -> Result<(), String> {
        loop {
            while self.peek().is_some_and(|byte| byte.is_ascii_whitespace()) {
                self.position += 1;
            }
            if self.bytes.get(self.position..self.position + 2) == Some(b"//") {
                self.position += 2;
                while self.peek().is_some_and(|byte| byte != b'\n') {
                    self.position += 1;
                }
            } else {
                return Ok(());
            }
        }
    }
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.position).copied()
    }
}

fn object_named<'a>(entries: &'a [Entry], name: &str) -> Option<&'a [Entry]> {
    entries
        .iter()
        .find(|entry| entry.key.eq_ignore_ascii_case(name))
        .and_then(|entry| entry.value.as_object())
}
fn direct_string<'a>(entries: &'a [Entry], name: &str) -> Option<&'a str> {
    entries.iter().find_map(|entry| {
        if entry.key.eq_ignore_ascii_case(name) {
            if let Value::String(value) = &entry.value {
                return Some(value.as_str());
            }
        }
        None
    })
}
fn direct_u64(entries: &[Entry], name: &str) -> Option<u64> {
    direct_string(entries, name)?.parse().ok()
}

fn system_time_rfc3339(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let second = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        second / 3600,
        second % 3600 / 60,
        second % 60
    )
}
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * mp + 2).div_euclid(5) + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_dir() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let path = env::temp_dir().join(format!(
            "xcom-monitor-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }
    fn manifest(appid: u32, extra: &str) -> String {
        format!(r#""AppState" {{ "appid" "{appid}" "name" "test" "installdir" "XCOM" {extra} }}"#)
    }
    fn root_with_manifest(appid: u32, extra: &str) -> (PathBuf, Vec<SteamappsRoot>) {
        let root = temp_dir();
        fs::write(
            root.join(format!("appmanifest_{appid}.acf")),
            manifest(appid, extra),
        )
        .unwrap();
        let roots = vec![SteamappsRoot {
            path: root.clone(),
            label: "test".to_string(),
        }];
        (root, roots)
    }

    #[test]
    fn parser_scopes_counters_to_app_state_direct_children() {
        let parsed = parse_vdf(&manifest(GAME_APP_ID, r#""BytesDownloaded" "12" "Nested" { "BytesDownloaded" "999" } "BytesToDownload" "100""#)).unwrap();
        let state = object_named(&parsed, "AppState").unwrap();
        assert_eq!(direct_u64(state, "BytesDownloaded"), Some(12));
    }

    #[test]
    fn parser_rejects_malformed_nul_and_excessive_depth() {
        assert!(parse_vdf(r#""AppState" { "appid" "1""#).is_err());
        assert!(parse_vdf(&format!(
            "{}{}",
            r#""a" {"#.repeat(MAX_VDF_DEPTH + 2),
            "}".repeat(MAX_VDF_DEPTH + 2)
        ))
        .is_err());
        let file = temp_dir().join("nul.vdf");
        fs::write(&file, b"a\0b").unwrap();
        assert!(read_vdf_file(&file).is_err());
    }

    #[test]
    fn oversized_manifest_is_rejected() {
        let file = temp_dir().join("large.acf");
        let handle = File::create(&file).unwrap();
        handle.set_len(MAX_VDF_BYTES + 1).unwrap();
        assert!(read_vdf_file(&file).is_err());
    }

    #[test]
    fn percentage_is_bounded_and_overflow_safe() {
        assert_eq!(percentage(Some(u64::MAX), Some(u64::MAX)), Some(100.0));
        assert_eq!(percentage(Some(u64::MAX), Some(1)), Some(100.0));
        assert_eq!(percentage(Some(1), Some(3)), Some(33.33));
        assert_eq!(percentage(Some(1), Some(0)), None);
        assert!(matches!(ByteCount::from(u64::MAX), ByteCount::Decimal(_)));
    }

    #[test]
    fn active_download_and_staging_are_not_complete() {
        let (root, roots) = root_with_manifest(
            GAME_APP_ID,
            r#""StateFlags" "1026" "BytesDownloaded" "25" "BytesToDownload" "100""#,
        );
        fs::create_dir_all(root.join("downloading").join(GAME_APP_ID.to_string())).unwrap();
        let status = inspect_product(
            &roots,
            ProductIdentifier {
                app_id: GAME_APP_ID,
                name: "game",
                kind: "game",
                role: "required",
            },
            "now",
        )
        .unwrap();
        assert_eq!(status.lifecycle, "downloading");
        assert!(!status.complete);

        fs::write(root.join(format!("appmanifest_{GAME_APP_ID}.acf")), manifest(GAME_APP_ID, r#""StateFlags" "1026" "BytesDownloaded" "100" "BytesToDownload" "100" "BytesStaged" "20" "BytesToStage" "100""#)).unwrap();
        let status = inspect_product(
            &roots,
            ProductIdentifier {
                app_id: GAME_APP_ID,
                name: "game",
                kind: "game",
                role: "required",
            },
            "now",
        )
        .unwrap();
        assert_eq!(status.lifecycle, "staging");
    }

    #[test]
    fn installed_product_requires_directory_and_quiet_manifest() {
        let (root, roots) = root_with_manifest(
            GAME_APP_ID,
            r#""StateFlags" "4" "BytesDownloaded" "100" "BytesToDownload" "100""#,
        );
        fs::create_dir_all(root.join("common/XCOM")).unwrap();
        let old = SystemTime::now() - RECENT_ACTIVITY - Duration::from_secs(60);
        set_mtime(&root.join(format!("appmanifest_{GAME_APP_ID}.acf")), old);
        let status = inspect_product(
            &roots,
            ProductIdentifier {
                app_id: GAME_APP_ID,
                name: "game",
                kind: "game",
                role: "required",
            },
            "now",
        )
        .unwrap();
        assert!(status.complete);
        assert!(status.stable);
    }

    #[test]
    fn stale_incomplete_work_is_paused() {
        let (root, roots) = root_with_manifest(
            GAME_APP_ID,
            r#""StateFlags" "2" "BytesDownloaded" "20" "BytesToDownload" "100""#,
        );
        set_mtime(
            &root.join(format!("appmanifest_{GAME_APP_ID}.acf")),
            SystemTime::now() - RECENT_ACTIVITY - Duration::from_secs(60),
        );
        let status = inspect_product(
            &roots,
            ProductIdentifier {
                app_id: GAME_APP_ID,
                name: "game",
                kind: "game",
                role: "required",
            },
            "now",
        )
        .unwrap();
        assert_eq!(status.lifecycle, "paused");
    }

    #[test]
    fn root_discovery_reads_libraryfolders_and_deduplicates() {
        let steam = temp_dir();
        let library = temp_dir();
        fs::create_dir_all(steam.join("steamapps")).unwrap();
        fs::create_dir_all(library.join("steamapps")).unwrap();
        fs::write(
            steam.join("steamapps/libraryfolders.vdf"),
            format!(
                r#""libraryfolders" {{ "1" {{ "path" "{}" }} "2" {{ "path" "{}" }} }}"#,
                library.display(),
                library.display()
            ),
        )
        .unwrap();
        let roots = discover_roots_from_candidates(&[steam]).unwrap();
        assert_eq!(roots.len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn manifest_symlink_escape_is_rejected() {
        let root = temp_dir();
        let outside = temp_dir();
        let target = outside.join("manifest.acf");
        fs::write(&target, manifest(GAME_APP_ID, "")).unwrap();
        std::os::unix::fs::symlink(target, root.join(format!("appmanifest_{GAME_APP_ID}.acf")))
            .unwrap();
        let roots = vec![SteamappsRoot {
            path: root,
            label: "test".to_string(),
        }];
        assert!(inspect_product(
            &roots,
            ProductIdentifier {
                app_id: GAME_APP_ID,
                name: "game",
                kind: "game",
                role: "required"
            },
            "now"
        )
        .is_err());
    }

    #[test]
    fn complete_stable_products_allow_planning_but_never_monitor_apply() {
        let (root, roots) = root_with_manifest(
            GAME_APP_ID,
            r#""StateFlags" "4" "BytesDownloaded" "100" "BytesToDownload" "100""#,
        );
        fs::write(
            root.join(format!("appmanifest_{WOTC_TOOLS_APP_ID}.acf")),
            manifest(
                WOTC_TOOLS_APP_ID,
                r#""StateFlags" "4" "BytesDownloaded" "100" "BytesToDownload" "100""#,
            ),
        )
        .unwrap();
        fs::create_dir_all(root.join("common/XCOM")).unwrap();
        let old = SystemTime::now() - RECENT_ACTIVITY - Duration::from_secs(60);
        set_mtime(&root.join(format!("appmanifest_{GAME_APP_ID}.acf")), old);
        set_mtime(
            &root.join(format!("appmanifest_{WOTC_TOOLS_APP_ID}.acf")),
            old,
        );

        let (snapshot, had_error) = build_snapshot("ws".to_string(), 1, Ok(roots));

        assert!(!had_error);
        assert_eq!(snapshot.overall_state, "ready");
        assert!(snapshot.can_plan_setup);
        assert!(!snapshot.can_apply_setup);
        assert!(snapshot.blockers.is_empty());
    }

    #[test]
    fn missing_products_block_setup_and_paths_are_redacted() {
        let (snapshot, _) = build_snapshot("ws".to_string(), 1, Ok(Vec::new()));
        assert!(!snapshot.can_plan_setup);
        assert!(!snapshot.can_apply_setup);
        assert_eq!(snapshot.overall_state, "not-found");
        assert!(serde_json::to_string(&snapshot)
            .unwrap()
            .find(env::temp_dir().to_string_lossy().as_ref())
            .is_none());
    }

    #[test]
    fn workspace_switch_advances_generation_and_drops_stale_state() {
        let mut inner = MonitorInner::default();
        synchronize_workspace(&mut inner, "workspace-a");
        let first_generation = inner.generation;
        let (snapshot, _) =
            build_snapshot("workspace-a".to_string(), first_generation, Ok(Vec::new()));
        inner.snapshot = Some(snapshot.clone());
        inner.events.push_back(SetupMonitorEvent {
            event_type: "snapshot",
            cause: "initial",
            sequence: 1,
            snapshot,
        });

        synchronize_workspace(&mut inner, "workspace-b");

        assert!(inner.generation > first_generation);
        assert!(inner.snapshot.is_none());
        assert!(inner.events.is_empty());
    }

    #[test]
    fn event_queue_is_bounded_and_filters_sequences() {
        let mut inner = MonitorInner::default();
        for sequence in 1..=EVENT_CAPACITY as u64 + 5 {
            let (snapshot, _) = build_snapshot("ws".to_string(), 2, Ok(Vec::new()));
            inner.events.push_back(SetupMonitorEvent {
                event_type: "snapshot",
                cause: "refresh",
                sequence,
                snapshot,
            });
            while inner.events.len() > EVENT_CAPACITY {
                inner.events.pop_front();
            }
        }
        assert_eq!(inner.events.len(), EVENT_CAPACITY);
        let events = poll_events(&inner, EVENT_CAPACITY as u64, 2);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| event.snapshot.generation == 2));
    }

    #[test]
    #[ignore = "read-only live Steam integration probe; run explicitly"]
    fn live_steam_snapshot_probe() {
        let (first, first_error) = build_snapshot(
            "live-read-only-probe".to_string(),
            1,
            discover_steamapps_roots(),
        );
        println!("LIVE_SAMPLE_1={}", serde_json::to_string(&first).unwrap());
        assert!(
            !first_error,
            "live Steam manifest inspection reported warnings"
        );
        assert_eq!(
            first
                .products
                .iter()
                .map(|item| item.product.app_id)
                .collect::<Vec<_>>(),
            vec![GAME_APP_ID, WOTC_TOOLS_APP_ID, VANILLA_TOOLS_APP_ID]
        );
        assert!(first.can_plan_setup);
        assert!(!first.can_apply_setup);
        assert!(first
            .products
            .iter()
            .filter(|item| item.product.role == "required")
            .all(|item| item.complete && item.stable));
        assert!(first.products.iter().all(|item| item.mutation_blocked));

        std::thread::sleep(Duration::from_secs(5));
        let (second, second_error) = build_snapshot(
            "live-read-only-probe".to_string(),
            1,
            discover_steamapps_roots(),
        );
        println!("LIVE_SAMPLE_2={}", serde_json::to_string(&second).unwrap());
        println!(
            "LIVE_MATERIAL_CHANGED={}",
            material_key(&first).unwrap() != material_key(&second).unwrap()
        );
        assert!(
            !second_error,
            "live Steam manifest inspection reported warnings"
        );
        assert!(second.can_plan_setup);
        assert!(!second.can_apply_setup);
    }

    #[cfg(unix)]
    fn set_mtime(path: &Path, time: SystemTime) {
        let file = File::options().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(time))
            .unwrap();
    }
    #[cfg(not(unix))]
    fn set_mtime(_path: &Path, _time: SystemTime) {}
}
