use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::app_config::now_rfc3339;
use crate::commands::xcom2_setup_monitor::{
    discover_native_setup_products, setup_transaction_gate, NativeProductInstall,
    Xcom2SetupMonitorState,
};

const SCHEMA_VERSION: u32 = 1;
const SETUP_SCHEMA_VERSION: u32 = 1;
const DEFAULT_ENGINE: &str = "XComGame/Config/DefaultEngine.ini";
const XCOM_ENGINE: &str = "XComGame/Config/XComEngine.ini";
const EDITOR_SETTINGS: &str = "XComGame/Config/XComEditorUserSettings.ini";
const TLE_CLASSES: &str = "Development/SrcOrig/DLC_3/Classes";
const COOKED_LINK: &str = "XComGame/CookedPCConsole";
const GAME_COOKED: &str = "XCom2-WarOfTheChosen/XComGame/CookedPCConsole";
const MAX_BACKUP_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TRANSACTIONS: usize = 64;
const MAX_EVENTS: usize = 256;
const MAX_LIST_LIMIT: usize = 64;
const MAX_EVENT_LIMIT: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransactionState {
    Waiting,
    Prepared,
    Applying,
    Applied,
    Partial,
    RollingBack,
    RolledBack,
    RollbackConflict,
    RecoveryRequired,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OperationKind {
    AtomicTextPatch,
    QuarantineFile,
    CreateGeneratedFile,
    CreateGeneratedDirectory,
    CreateSymlink,
    ManagedDirectoryCopyUnsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOperation {
    pub id: String,
    pub kind: OperationKind,
    pub relative_path: String,
    #[serde(default, skip_serializing)]
    pub generated_content: Option<String>,
    #[serde(default, skip_serializing)]
    pub link_target: Option<String>,
    pub executable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum FileState {
    Absent,
    File {
        sha256: String,
        bytes: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<u32>,
    },
    Directory,
    Symlink {
        target: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupMetadata {
    content_sha256: String,
    bytes: u64,
    relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum StepStatus {
    Pending,
    IntentWritten,
    Applied,
    RolledBack,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SteamBaseline {
    app_id: u32,
    build_id: String,
    state_flags: u64,
    manifest_sha256: String,
    manifest_bytes: u64,
    install_root_identity: String,
    manifest_identity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SetupBaseline {
    setup_schema_version: u32,
    products: Vec<SteamBaseline>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalStep {
    operation: SetupOperation,
    precondition: FileState,
    #[serde(skip_serializing_if = "Option::is_none")]
    after_state: Option<FileState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    backup: Option<BackupMetadata>,
    status: StepStatus,
    checkpoint: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupTransaction {
    schema_version: u32,
    pub transaction_id: String,
    pub workspace_id: String,
    pub generation: u64,
    pub operation_digest: String,
    pub state: TransactionState,
    pub executable: bool,
    pub blockers: Vec<String>,
    steps: Vec<JournalStep>,
    #[serde(default)]
    baseline: Option<SetupBaseline>,
    checkpoint: u64,
    cancel_requested: bool,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Export-safe transaction evidence shared by non-interactive native clients.
/// Mutation content, absolute roots, symlink targets, and backup metadata are
/// deliberately not representable in this type.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupTransactionExport {
    pub transaction_id: String,
    pub workspace_id: String,
    pub generation: u64,
    pub approval_digest: String,
    pub state: TransactionState,
    pub executable: bool,
    pub blockers: Vec<String>,
    pub operation_count: usize,
    pub operations: Vec<SetupOperationExport>,
    pub created_at: String,
    pub updated_at: String,
    pub journal: SetupJournalExport,
    pub has_internal_error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOperationExport {
    pub operation_id: String,
    pub kind: OperationKind,
    pub relative_path: String,
    pub executable: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupJournalExport {
    pub managed_by: &'static str,
    pub scope: &'static str,
    pub redacted_location: &'static str,
    pub exists: bool,
}

impl SetupTransaction {
    pub fn export_safe(&self, journal_exists: bool) -> SetupTransactionExport {
        SetupTransactionExport {
            transaction_id: self.transaction_id.clone(),
            workspace_id: self.workspace_id.clone(),
            generation: self.generation,
            approval_digest: self.operation_digest.clone(),
            state: self.state.clone(),
            executable: self.executable,
            blockers: self.blockers.clone(),
            operation_count: self.steps.len(),
            operations: self
                .steps
                .iter()
                .map(|step| SetupOperationExport {
                    operation_id: step.operation.id.clone(),
                    kind: step.operation.kind.clone(),
                    relative_path: step.operation.relative_path.clone(),
                    executable: step.operation.executable,
                    status: match step.status {
                        StepStatus::Pending => "pending",
                        StepStatus::IntentWritten => "intentWritten",
                        StepStatus::Applied => "applied",
                        StepStatus::RolledBack => "rolledBack",
                        StepStatus::Conflict => "conflict",
                    }
                    .to_string(),
                })
                .collect(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            journal: SetupJournalExport {
                managed_by: "native",
                scope: "local-machine",
                redacted_location: "Native-managed XCOM 2 setup journal",
                exists: journal_exists,
            },
            has_internal_error: self.error.is_some(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupTransactionEvent {
    pub sequence: u64,
    pub workspace_id: String,
    pub generation: u64,
    pub transaction_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    pub state: TransactionState,
    pub message: String,
}

#[derive(Default)]
struct TransactionInner {
    root: Option<PathBuf>,
    transactions: BTreeMap<String, SetupTransaction>,
    events: VecDeque<SetupTransactionEvent>,
    sequence: u64,
    #[cfg(test)]
    fail_before_step: Option<usize>,
}

#[derive(Default)]
pub struct Xcom2SetupTransactionState(Mutex<TransactionInner>);

#[derive(Default)]
pub struct Xcom2SetupOperationalService {
    transactions: Xcom2SetupTransactionState,
    monitor: Xcom2SetupMonitorState,
}

impl Xcom2SetupOperationalService {
    pub fn prepare(&self) -> Result<SetupTransaction, String> {
        prepare_transaction(&self.transactions, &self.monitor)
    }

    pub fn status(&self, transaction_id: &str) -> Result<SetupTransaction, String> {
        get_transaction(transaction_id, &self.transactions)
    }

    pub fn list(&self) -> Result<Vec<SetupTransaction>, String> {
        list_transactions(MAX_LIST_LIMIT, &self.transactions)
    }

    pub fn apply(
        &self,
        transaction_id: &str,
        approval_digest: &str,
    ) -> Result<SetupTransaction, String> {
        apply_transaction(
            transaction_id,
            approval_digest,
            &self.transactions,
            &self.monitor,
        )
    }

    pub fn restore_vanilla(&self, transaction_id: &str) -> Result<SetupTransaction, String> {
        rollback_transaction(transaction_id, &self.transactions)
    }

    pub fn recover(
        &self,
        transaction_id: &str,
        strategy: &str,
    ) -> Result<SetupTransaction, String> {
        recover_transaction(transaction_id, strategy, &self.transactions)
    }

    pub fn journal_exists(&self, transaction_id: &str) -> Result<bool, String> {
        let root = discover_native_setup_products()?[1].install_root.clone();
        Ok(transaction_dir(&root, transaction_id)
            .join("journal.json")
            .is_file())
    }
}

#[tauri::command]
pub fn prepare_xcom2_setup_transaction(
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
    monitor: tauri::State<'_, Xcom2SetupMonitorState>,
) -> Result<SetupTransaction, String> {
    prepare_transaction(&transactions, &monitor)
}

fn prepare_transaction(
    transactions: &Xcom2SetupTransactionState,
    monitor: &Xcom2SetupMonitorState,
) -> Result<SetupTransaction, String> {
    let gate = setup_transaction_gate(monitor)?;
    let root = gate.products[1].install_root.clone();
    let (operations, baseline) = audit_vanilla_setup(&gate.products)?;
    let blockers = gate.blockers;
    let executable = gate.ready && blockers.is_empty();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    prepare_internal(
        &mut inner,
        &root,
        gate.workspace_id,
        gate.generation,
        operations,
        executable,
        blockers,
        Some(baseline),
    )
}

#[tauri::command]
pub fn apply_xcom2_setup_transaction(
    transaction_id: String,
    approval_digest: String,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
    monitor: tauri::State<'_, Xcom2SetupMonitorState>,
) -> Result<SetupTransaction, String> {
    apply_transaction(&transaction_id, &approval_digest, &transactions, &monitor)
}

fn apply_transaction(
    transaction_id: &str,
    approval_digest: &str,
    transactions: &Xcom2SetupTransactionState,
    monitor: &Xcom2SetupMonitorState,
) -> Result<SetupTransaction, String> {
    let gate = setup_transaction_gate(monitor)?;
    let root = gate.products[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    apply_internal(
        &mut inner,
        &root,
        transaction_id,
        approval_digest,
        &gate.workspace_id,
        gate.generation,
        gate.ready,
    )
}

#[tauri::command]
pub fn get_xcom2_setup_transaction(
    transaction_id: String,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
) -> Result<SetupTransaction, String> {
    get_transaction(&transaction_id, &transactions)
}

fn get_transaction(
    transaction_id: &str,
    transactions: &Xcom2SetupTransactionState,
) -> Result<SetupTransaction, String> {
    let root = discover_native_setup_products()?[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    inner
        .transactions
        .get(transaction_id)
        .cloned()
        .ok_or_else(|| "Unknown setup transaction".to_string())
}

#[tauri::command]
pub fn list_xcom2_setup_transactions(
    limit: usize,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
) -> Result<Vec<SetupTransaction>, String> {
    list_transactions(limit, &transactions)
}

fn list_transactions(
    limit: usize,
    transactions: &Xcom2SetupTransactionState,
) -> Result<Vec<SetupTransaction>, String> {
    let root = discover_native_setup_products()?[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    Ok(inner
        .transactions
        .values()
        .rev()
        .take(limit.min(MAX_LIST_LIMIT))
        .cloned()
        .collect())
}

#[tauri::command]
pub fn cancel_xcom2_setup_transaction(
    transaction_id: String,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
) -> Result<SetupTransaction, String> {
    let root = discover_native_setup_products()?[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    let tx = transaction_mut(&mut inner, &transaction_id)?;
    match tx.state {
        TransactionState::Waiting | TransactionState::Prepared => {
            tx.state = TransactionState::Cancelled
        }
        TransactionState::Cancelled | TransactionState::RolledBack => {}
        TransactionState::Applying | TransactionState::RollingBack => tx.cancel_requested = true,
        _ => return Err("Transaction cannot be cancelled in its current state".to_string()),
    }
    tx.updated_at = now_rfc3339();
    persist_transaction(&root, tx)?;
    let result = tx.clone();
    emit(
        &mut inner,
        &result,
        None,
        "Cancellation checkpoint recorded",
    );
    Ok(result)
}

#[tauri::command]
pub fn rollback_xcom2_setup_transaction(
    transaction_id: String,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
) -> Result<SetupTransaction, String> {
    rollback_transaction(&transaction_id, &transactions)
}

fn rollback_transaction(
    transaction_id: &str,
    transactions: &Xcom2SetupTransactionState,
) -> Result<SetupTransaction, String> {
    let root = discover_native_setup_products()?[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    rollback_internal(&mut inner, &root, transaction_id)
}

#[tauri::command]
pub fn recover_xcom2_setup_transaction(
    transaction_id: String,
    strategy: String,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
) -> Result<SetupTransaction, String> {
    recover_transaction(&transaction_id, &strategy, &transactions)
}

fn recover_transaction(
    transaction_id: &str,
    strategy: &str,
    transactions: &Xcom2SetupTransactionState,
) -> Result<SetupTransaction, String> {
    let root = discover_native_setup_products()?[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    recover_internal(&mut inner, &root, transaction_id, strategy)
}

#[tauri::command]
pub fn poll_xcom2_setup_transaction_events(
    after_sequence: u64,
    limit: usize,
    transactions: tauri::State<'_, Xcom2SetupTransactionState>,
) -> Result<Vec<SetupTransactionEvent>, String> {
    let root = discover_native_setup_products()?[1].install_root.clone();
    let mut inner = transactions
        .0
        .lock()
        .map_err(|_| "XCOM 2 transaction state is poisoned")?;
    initialize(&mut inner, &root)?;
    Ok(inner
        .events
        .iter()
        .filter(|event| event.sequence > after_sequence)
        .take(limit.min(MAX_EVENT_LIMIT))
        .cloned()
        .collect())
}

pub fn flush_xcom2_setup_transactions(state: &Xcom2SetupTransactionState) {
    if let Ok(inner) = state.0.lock() {
        if let Some(root) = &inner.root {
            let _ = File::open(state_dir(root)).and_then(|file| file.sync_all());
        }
    }
}

fn initialize(inner: &mut TransactionInner, workspace: &Path) -> Result<(), String> {
    let root = workspace
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if inner.root.as_ref() == Some(&root) {
        return Ok(());
    }
    inner.root = Some(root.clone());
    inner.transactions.clear();
    inner.events.clear();
    fs::create_dir_all(transactions_dir(&root))
        .map_err(|error| format!("Cannot create transaction state: {error}"))?;
    for entry in fs::read_dir(transactions_dir(&root)).map_err(|error| error.to_string())? {
        let path = entry
            .map_err(|error| error.to_string())?
            .path()
            .join("journal.json");
        if !path.is_file() {
            continue;
        }
        let bytes =
            fs::read(&path).map_err(|error| format!("Cannot read transaction journal: {error}"))?;
        let mut tx: SetupTransaction = serde_json::from_slice(&bytes)
            .map_err(|error| format!("Invalid transaction journal: {error}"))?;
        rehydrate_transaction(&mut tx, &root)?;
        if tx.schema_version != SCHEMA_VERSION {
            return Err("Unsupported transaction journal schema".to_string());
        }
        inner.transactions.insert(tx.transaction_id.clone(), tx);
    }
    trim_retention(inner, &root)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn prepare_internal(
    inner: &mut TransactionInner,
    root: &Path,
    workspace_id: String,
    generation: u64,
    operations: Vec<SetupOperation>,
    executable: bool,
    blockers: Vec<String>,
    baseline: Option<SetupBaseline>,
) -> Result<SetupTransaction, String> {
    let id = unique_id();
    let mut steps = Vec::new();
    let mut planned_paths = BTreeSet::new();
    for operation in operations {
        validate_operation(root, &operation)?;
        if !planned_paths.insert(operation.relative_path.clone()) {
            return Err("A transaction cannot mutate the same path more than once".to_string());
        }
        let precondition = observe(&operation_path(root, &operation.relative_path)?)?;
        validate_precondition(&operation, &precondition)?;
        steps.push(JournalStep {
            operation,
            precondition,
            after_state: None,
            backup: None,
            status: StepStatus::Pending,
            checkpoint: 0,
        });
    }
    let digest = digest_operations(&id, &workspace_id, generation, &baseline, &steps)?;
    let state = if executable {
        TransactionState::Prepared
    } else {
        TransactionState::Waiting
    };
    let now = now_rfc3339();
    let tx = SetupTransaction {
        schema_version: SCHEMA_VERSION,
        transaction_id: id.clone(),
        workspace_id,
        generation,
        operation_digest: digest,
        state,
        executable,
        blockers,
        steps,
        baseline,
        checkpoint: 0,
        cancel_requested: false,
        created_at: now.clone(),
        updated_at: now,
        error: None,
    };
    persist_transaction(root, &tx)?;
    inner.transactions.insert(id, tx.clone());
    trim_retention(inner, root)?;
    emit(
        inner,
        &tx,
        None,
        "Transaction prepared from trusted native state",
    );
    Ok(tx)
}

fn apply_internal(
    inner: &mut TransactionInner,
    root: &Path,
    id: &str,
    approval: &str,
    workspace_id: &str,
    generation: u64,
    monitor_ready: bool,
) -> Result<SetupTransaction, String> {
    let snapshot = transaction_mut(inner, id)?.clone();
    if snapshot.state == TransactionState::Applied {
        return Ok(snapshot);
    }
    if snapshot.state != TransactionState::Prepared && snapshot.state != TransactionState::Partial {
        return Err(format!(
            "Transaction is not applicable: {:?}",
            snapshot.state
        ));
    }
    if !snapshot.executable || !monitor_ready {
        return Err(
            "Production mutation is blocked until downloads, grants, and audits are complete"
                .to_string(),
        );
    }
    if snapshot.operation_digest != approval {
        return Err("Approval digest does not match the exact operation plan".to_string());
    }
    if snapshot.workspace_id != workspace_id || snapshot.generation != generation {
        return Err("Workspace or monitor generation changed after approval".to_string());
    }
    if digest_operations(
        &snapshot.transaction_id,
        &snapshot.workspace_id,
        snapshot.generation,
        &snapshot.baseline,
        &snapshot.steps,
    )? != snapshot.operation_digest
    {
        return Err("Journal operation digest is invalid".to_string());
    }
    if let Some(baseline) = &snapshot.baseline {
        revalidate_steam_baseline(baseline)?;
    }
    for step in &snapshot.steps {
        validate_operation(root, &step.operation)?;
        if step.status == StepStatus::Pending
            && observe(&operation_path(root, &step.operation.relative_path)?)? != step.precondition
        {
            return Err(format!(
                "Before-state changed for operation {}",
                step.operation.id
            ));
        }
    }
    {
        let tx = transaction_mut(inner, id)?;
        tx.state = TransactionState::Applying;
        tx.updated_at = now_rfc3339();
        persist_transaction(root, tx)?;
    }
    for index in 0..snapshot.steps.len() {
        let status = transaction_mut(inner, id)?.steps[index].status.clone();
        if status == StepStatus::Applied {
            continue;
        }
        if transaction_mut(inner, id)?.cancel_requested {
            transaction_mut(inner, id)?.state = TransactionState::Partial;
            break;
        }
        #[cfg(test)]
        if inner.fail_before_step == Some(index) {
            let tx = transaction_mut(inner, id)?;
            tx.state = TransactionState::Partial;
            tx.error = Some("Injected failure".to_string());
            persist_transaction(root, tx)?;
            return Ok(tx.clone());
        }
        {
            let tx = transaction_mut(inner, id)?;
            tx.checkpoint += 1;
            tx.steps[index].status = StepStatus::IntentWritten;
            tx.steps[index].checkpoint = tx.checkpoint;
            persist_transaction(root, tx)?;
        }
        let backup = prepare_step_backup(root, id, &transaction_mut(inner, id)?.steps[index]);
        match backup {
            Ok(backup) => {
                let tx = transaction_mut(inner, id)?;
                tx.steps[index].backup = backup;
                persist_transaction(root, tx)?;
            }
            Err(error) => {
                let tx = transaction_mut(inner, id)?;
                tx.state = TransactionState::RecoveryRequired;
                tx.error = Some(error);
                persist_transaction(root, tx)?;
                return Ok(tx.clone());
            }
        }
        let mutation = mutate_step(root, &transaction_mut(inner, id)?.steps[index]);
        match mutation {
            Ok(after) => {
                let tx = transaction_mut(inner, id)?;
                tx.checkpoint += 1;
                tx.steps[index].after_state = Some(after.clone());
                tx.steps[index].status = StepStatus::Applied;
                tx.steps[index].checkpoint = tx.checkpoint;
                if observe(&operation_path(
                    root,
                    &tx.steps[index].operation.relative_path,
                )?)? != after
                {
                    return Err("Postcondition verification failed".to_string());
                }
                persist_transaction(root, tx)?;
                let event_tx = tx.clone();
                emit(
                    inner,
                    &event_tx,
                    Some(index),
                    "Operation applied and verified",
                );
            }
            Err(error) => {
                let tx = transaction_mut(inner, id)?;
                tx.state = TransactionState::RecoveryRequired;
                tx.error = Some(error);
                tx.updated_at = now_rfc3339();
                persist_transaction(root, tx)?;
                return Ok(tx.clone());
            }
        }
    }
    let tx = transaction_mut(inner, id)?;
    if tx
        .steps
        .iter()
        .all(|step| step.status == StepStatus::Applied)
    {
        tx.state = TransactionState::Applied;
        tx.error = None;
    }
    tx.updated_at = now_rfc3339();
    persist_transaction(root, tx)?;
    let result = tx.clone();
    emit(inner, &result, None, "Apply reached a safe boundary");
    Ok(result)
}

fn prepare_step_backup(
    root: &Path,
    id: &str,
    step: &JournalStep,
) -> Result<Option<BackupMetadata>, String> {
    match step.precondition {
        FileState::File { .. } => Ok(Some(backup_file(
            root,
            id,
            &operation_path(root, &step.operation.relative_path)?,
        )?)),
        _ => Ok(None),
    }
}

fn mutate_step(root: &Path, step: &JournalStep) -> Result<FileState, String> {
    let path = operation_path(root, &step.operation.relative_path)?;
    match step.operation.kind {
        OperationKind::AtomicTextPatch | OperationKind::CreateGeneratedFile => {
            atomic_write(
                &path,
                step.operation
                    .generated_content
                    .as_deref()
                    .ok_or("Generated content missing")?
                    .as_bytes(),
            )?;
            if let FileState::File {
                mode: Some(mode), ..
            } = step.precondition
            {
                set_file_mode(&path, mode)?;
            }
        }
        OperationKind::QuarantineFile => {
            fs::remove_file(&path).map_err(|error| format!("Cannot quarantine file: {error}"))?
        }
        OperationKind::CreateGeneratedDirectory => fs::create_dir(&path)
            .map_err(|error| format!("Cannot create generated directory: {error}"))?,
        OperationKind::CreateSymlink => create_symlink(
            &path,
            step.operation
                .link_target
                .as_deref()
                .ok_or("Link target missing")?,
        )?,
        OperationKind::ManagedDirectoryCopyUnsupported => {
            return Err("Managed directory copy is unsupported".to_string())
        }
    }
    sync_parent(&path)?;
    observe(&path)
}

fn rollback_internal(
    inner: &mut TransactionInner,
    root: &Path,
    id: &str,
) -> Result<SetupTransaction, String> {
    let state = transaction_mut(inner, id)?.state.clone();
    if state == TransactionState::RolledBack {
        return Ok(transaction_mut(inner, id)?.clone());
    }
    if !matches!(
        state,
        TransactionState::Applied
            | TransactionState::Partial
            | TransactionState::RecoveryRequired
            | TransactionState::RollingBack
            | TransactionState::RollbackConflict
    ) {
        return Err("Transaction has no applied mutations to roll back".to_string());
    }
    if let Some(baseline) = &transaction_mut(inner, id)?.baseline {
        revalidate_steam_baseline(baseline)?;
    }
    transaction_mut(inner, id)?.state = TransactionState::RollingBack;
    persist_transaction(root, transaction_mut(inner, id)?)?;
    let count = transaction_mut(inner, id)?.steps.len();
    for index in (0..count).rev() {
        let step = transaction_mut(inner, id)?.steps[index].clone();
        if step.status == StepStatus::RolledBack || step.status == StepStatus::Pending {
            continue;
        }
        if step.status == StepStatus::IntentWritten
            && observe(&operation_path(root, &step.operation.relative_path)?)? == step.precondition
        {
            transaction_mut(inner, id)?.steps[index].status = StepStatus::RolledBack;
            persist_transaction(root, transaction_mut(inner, id)?)?;
            continue;
        }
        let current = observe(&operation_path(root, &step.operation.relative_path)?)?;
        if step.after_state.as_ref() != Some(&current) {
            let tx = transaction_mut(inner, id)?;
            tx.steps[index].status = StepStatus::Conflict;
            tx.state = TransactionState::RollbackConflict;
            tx.error = Some(format!(
                "External change conflicts with rollback of {}",
                step.operation.id
            ));
            persist_transaction(root, tx)?;
            return Ok(tx.clone());
        }
        restore_step(root, id, &step)?;
        if observe(&operation_path(root, &step.operation.relative_path)?)? != step.precondition {
            return Err("Rollback verification failed".to_string());
        }
        let tx = transaction_mut(inner, id)?;
        tx.checkpoint += 1;
        tx.steps[index].status = StepStatus::RolledBack;
        tx.steps[index].checkpoint = tx.checkpoint;
        persist_transaction(root, tx)?;
        let event_tx = tx.clone();
        emit(
            inner,
            &event_tx,
            Some(index),
            "Operation rolled back and verified",
        );
    }
    let tx = transaction_mut(inner, id)?;
    tx.state = TransactionState::RolledBack;
    tx.error = None;
    tx.updated_at = now_rfc3339();
    persist_transaction(root, tx)?;
    let result = tx.clone();
    emit(inner, &result, None, "Rollback complete");
    Ok(result)
}

fn restore_step(root: &Path, id: &str, step: &JournalStep) -> Result<(), String> {
    let path = operation_path(root, &step.operation.relative_path)?;
    match &step.precondition {
        FileState::Absent => remove_any(&path),
        FileState::File { sha256, mode, .. } => {
            let backup = step
                .backup
                .as_ref()
                .ok_or("Required backup metadata missing")?;
            if &backup.content_sha256 != sha256 {
                return Err("Backup metadata does not match original hash".to_string());
            }
            let backup_path = transaction_dir(root, id).join(&backup.relative_path);
            if hash_file(&backup_path)?.0 != backup.content_sha256 {
                return Err("Backup content is corrupt".to_string());
            }
            atomic_write(
                &path,
                &fs::read(backup_path).map_err(|error| error.to_string())?,
            )?;
            if let Some(mode) = mode {
                set_file_mode(&path, *mode)?;
            }
            Ok(())
        }
        FileState::Directory => Err("Restoring arbitrary directories is unsupported".to_string()),
        FileState::Symlink { .. } => {
            Err("Restoring pre-existing symlinks is unsupported".to_string())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryStrategy {
    ResumeRollback,
    RetryRollback,
    VerifyJournal,
}

impl RecoveryStrategy {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "resume-rollback" => Ok(Self::ResumeRollback),
            "retry-rollback" => Ok(Self::RetryRollback),
            "verify-journal" => Ok(Self::VerifyJournal),
            _ => Err(format!("Unsupported XCOM 2 recovery strategy: {value}")),
        }
    }
}

fn recover_internal(
    inner: &mut TransactionInner,
    root: &Path,
    id: &str,
    strategy: &str,
) -> Result<SetupTransaction, String> {
    let strategy = RecoveryStrategy::parse(strategy)?;
    let state = transaction_mut(inner, id)?.state.clone();
    if state == TransactionState::RolledBack {
        return Ok(transaction_mut(inner, id)?.clone());
    }

    let interrupted = matches!(
        state,
        TransactionState::Applying
            | TransactionState::Partial
            | TransactionState::RollingBack
            | TransactionState::RecoveryRequired
    );
    let retryable = interrupted || state == TransactionState::RollbackConflict;

    match strategy {
        RecoveryStrategy::VerifyJournal if retryable => {
            classify_recovery(inner, root, id)?;
            Ok(transaction_mut(inner, id)?.clone())
        }
        RecoveryStrategy::RetryRollback if retryable => {
            classify_recovery(inner, root, id)?;
            rollback_internal(inner, root, id)
        }
        RecoveryStrategy::ResumeRollback if interrupted => {
            classify_recovery(inner, root, id)?;
            rollback_internal(inner, root, id)
        }
        _ => Ok(transaction_mut(inner, id)?.clone()),
    }
}

fn classify_recovery(inner: &mut TransactionInner, root: &Path, id: &str) -> Result<(), String> {
    let tx = transaction_mut(inner, id)?;
    let mut conflict_operation = None;
    for step in &mut tx.steps {
        if matches!(step.status, StepStatus::Pending | StepStatus::RolledBack) {
            continue;
        }
        let current = observe(&operation_path(root, &step.operation.relative_path)?)?;
        if current == step.precondition {
            step.status = if step.status == StepStatus::IntentWritten {
                StepStatus::Pending
            } else {
                StepStatus::RolledBack
            };
        } else if step.after_state.as_ref() == Some(&current) {
            step.status = StepStatus::Applied;
        } else {
            step.status = StepStatus::Conflict;
            if conflict_operation.is_none() {
                conflict_operation = Some(step.operation.id.clone());
            }
        }
    }
    if let Some(operation_id) = conflict_operation {
        tx.state = TransactionState::RollbackConflict;
        tx.error = Some(format!(
            "External change conflicts with rollback of {operation_id}"
        ));
    } else if tx
        .steps
        .iter()
        .all(|step| matches!(step.status, StepStatus::Pending | StepStatus::RolledBack))
        && tx
            .steps
            .iter()
            .any(|step| step.status == StepStatus::RolledBack)
    {
        tx.state = TransactionState::RolledBack;
        tx.error = None;
    } else {
        tx.state = TransactionState::Partial;
        tx.error = None;
    }
    tx.updated_at = now_rfc3339();
    persist_transaction(root, tx)
}

fn validate_operation(root: &Path, operation: &SetupOperation) -> Result<(), String> {
    if !operation.executable || operation.kind == OperationKind::ManagedDirectoryCopyUnsupported {
        return Err("Operation primitive is unsupported or non-executable".to_string());
    }
    let path = operation_path(root, &operation.relative_path)?;
    verify_ancestors(root, &path)?;
    let parent = path.parent().ok_or("Operation path has no parent")?;
    if !parent.is_dir() {
        return Err("Operation parent must already be an authorized directory".to_string());
    }
    if operation.kind == OperationKind::CreateSymlink {
        let target = operation
            .link_target
            .as_deref()
            .ok_or("Link target missing")?;
        let target_path = Path::new(target);
        if target_path.is_absolute() {
            let products = discover_native_setup_products()?;
            let canonical_sdk = products[1]
                .install_root
                .canonicalize()
                .map_err(|error| error.to_string())?;
            let expected = products[0]
                .install_root
                .join(GAME_COOKED)
                .canonicalize()
                .map_err(|error| {
                    format!("Installed WOTC CookedPCConsole is unavailable: {error}")
                })?;
            let canonical_target = target_path
                .canonicalize()
                .map_err(|error| error.to_string())?;
            if root.canonicalize().map_err(|error| error.to_string())? != canonical_sdk
                || canonical_target != expected
            {
                return Err(
                    "Symlink target is not the exact allowlisted WOTC game directory".to_string(),
                );
            }
        } else {
            if target_path.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::Prefix(_) | Component::RootDir
                )
            }) {
                return Err("Symlink target must be a safe relative path".to_string());
            }
            let resolved = path.parent().ok_or("Link has no parent")?.join(target);
            verify_ancestors(root, &resolved)?;
            if resolved.exists() {
                let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
                let canonical_target =
                    resolved.canonicalize().map_err(|error| error.to_string())?;
                if !canonical_target.starts_with(canonical_root) {
                    return Err("Symlink target escapes the authorized root".to_string());
                }
            }
        }
    }
    Ok(())
}

fn validate_precondition(operation: &SetupOperation, state: &FileState) -> Result<(), String> {
    match operation.kind {
        OperationKind::AtomicTextPatch | OperationKind::QuarantineFile
            if matches!(state, FileState::File { .. }) =>
        {
            Ok(())
        }
        OperationKind::CreateGeneratedFile
        | OperationKind::CreateGeneratedDirectory
        | OperationKind::CreateSymlink
            if *state == FileState::Absent =>
        {
            Ok(())
        }
        _ => Err(format!(
            "Invalid before-state for operation {}",
            operation.id
        )),
    }
}

fn operation_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Operation path must be a non-empty normalized relative path".to_string());
    }
    Ok(root.join(path))
}

fn verify_ancestors(root: &Path, path: &Path) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let mut current = canonical_root.clone();
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Operation path escapes authorized root")?;
    let parts: Vec<_> = relative.components().collect();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        current.push(part.as_os_str());
        if current.exists() {
            let resolved = current.canonicalize().map_err(|error| error.to_string())?;
            if !resolved.starts_with(&canonical_root) {
                return Err("Operation path escapes through a symlink".to_string());
            }
            current = resolved;
        }
    }
    Ok(())
}

fn observe(path: &Path) -> Result<FileState, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(FileState::Absent),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(path).map_err(|error| error.to_string())?;
        return Ok(FileState::Symlink {
            target: format!("{:x}", Sha256::digest(target.to_string_lossy().as_bytes())),
        });
    }
    if metadata.is_dir() {
        return Ok(FileState::Directory);
    }
    if metadata.is_file() {
        let (sha256, bytes) = hash_file(path)?;
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            Some(metadata.permissions().mode())
        };
        #[cfg(not(unix))]
        let mode = None;
        return Ok(FileState::File {
            sha256,
            bytes,
            mode,
        });
    }
    Err("Unsupported filesystem object type".to_string())
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 8192];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        hash.update(&buffer[..count]);
    }
    Ok((format!("{:x}", hash.finalize()), bytes))
}

fn backup_file(root: &Path, id: &str, source: &Path) -> Result<BackupMetadata, String> {
    let (sha256, bytes) = hash_file(source)?;
    if bytes > MAX_BACKUP_BYTES {
        return Err("Backup exceeds transaction policy limit".to_string());
    }
    let relative_path = format!("backups/{sha256}");
    let destination = transaction_dir(root, id).join(&relative_path);
    if !destination.exists() {
        let content = fs::read(source).map_err(|error| error.to_string())?;
        atomic_write(&destination, &content)?;
    }
    Ok(BackupMetadata {
        content_sha256: sha256,
        bytes,
        relative_path,
    })
}

#[cfg(unix)]
fn set_file_mode(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| error.to_string())
}
#[cfg(not(unix))]
fn set_file_mode(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("Path has no parent")?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("State path has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".txn-{}.tmp", unique_id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(content).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    sync_parent(path)
}

fn persist_transaction(root: &Path, tx: &SetupTransaction) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(tx).map_err(|error| error.to_string())?;
    atomic_write(
        &transaction_dir(root, &tx.transaction_id).join("journal.json"),
        &bytes,
    )
}

fn digest_operations(
    transaction_id: &str,
    workspace_id: &str,
    generation: u64,
    baseline: &Option<SetupBaseline>,
    steps: &[JournalStep],
) -> Result<String, String> {
    #[derive(Serialize)]
    struct ApprovedStep<'a> {
        operation: &'a SetupOperation,
        precondition: &'a FileState,
    }
    #[derive(Serialize)]
    struct Approval<'a> {
        schema_version: u32,
        transaction_id: &'a str,
        workspace_id: &'a str,
        generation: u64,
        baseline: &'a Option<SetupBaseline>,
        steps: Vec<ApprovedStep<'a>>,
    }
    let value = Approval {
        schema_version: SCHEMA_VERSION,
        transaction_id,
        workspace_id,
        generation,
        baseline,
        steps: steps
            .iter()
            .map(|step| ApprovedStep {
                operation: &step.operation,
                precondition: &step.precondition,
            })
            .collect(),
    };
    let bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn remove_any(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir(path).map_err(|error| error.to_string())
        }
        Ok(_) => fs::remove_file(path).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(unix)]
fn create_symlink(path: &Path, target: &str) -> Result<(), String> {
    std::os::unix::fs::symlink(target, path).map_err(|error| error.to_string())
}
#[cfg(windows)]
fn create_symlink(path: &Path, target: &str) -> Result<(), String> {
    std::os::windows::fs::symlink_file(target, path).map_err(|error| error.to_string())
}

fn transaction_mut<'a>(
    inner: &'a mut TransactionInner,
    id: &str,
) -> Result<&'a mut SetupTransaction, String> {
    inner
        .transactions
        .get_mut(id)
        .ok_or_else(|| "Unknown setup transaction".to_string())
}
#[cfg(not(test))]
fn state_dir(_root: &Path) -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")))
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    base.join("ide/xcom2-setup")
}
#[cfg(test)]
fn state_dir(root: &Path) -> PathBuf {
    std::env::temp_dir()
        .join("ide-xcom2-test-state")
        .join(path_identity(root))
}
fn transactions_dir(root: &Path) -> PathBuf {
    state_dir(root).join("transactions")
}
fn transaction_dir(root: &Path, id: &str) -> PathBuf {
    transactions_dir(root).join(id)
}

fn trim_retention(inner: &mut TransactionInner, root: &Path) -> Result<(), String> {
    while inner.transactions.len() > MAX_TRANSACTIONS {
        let removable = inner
            .transactions
            .iter()
            .find(|(_, tx)| {
                matches!(
                    tx.state,
                    TransactionState::RolledBack
                        | TransactionState::Cancelled
                        | TransactionState::Waiting
                )
            })
            .map(|(id, _)| id.clone());
        let Some(id) = removable else {
            break;
        };
        inner.transactions.remove(&id);
        fs::remove_dir_all(transaction_dir(root, &id)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn emit(inner: &mut TransactionInner, tx: &SetupTransaction, step: Option<usize>, message: &str) {
    inner.sequence = inner.sequence.saturating_add(1);
    let operation_id = step
        .and_then(|index| tx.steps.get(index))
        .map(|item| item.operation.id.clone());
    inner.events.push_back(SetupTransactionEvent {
        sequence: inner.sequence,
        workspace_id: tx.workspace_id.clone(),
        generation: tx.generation,
        transaction_id: tx.transaction_id.clone(),
        step,
        operation_id,
        state: tx.state.clone(),
        message: message.to_string(),
    });
    while inner.events.len() > MAX_EVENTS {
        inner.events.pop_front();
    }
}

fn path_identity(path: &Path) -> String {
    format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()))
}

fn baseline_from_products(products: &[NativeProductInstall; 2]) -> SetupBaseline {
    SetupBaseline {
        setup_schema_version: SETUP_SCHEMA_VERSION,
        products: products
            .iter()
            .map(|product| SteamBaseline {
                app_id: product.app_id,
                build_id: product.build_id.clone(),
                state_flags: product.state_flags,
                manifest_sha256: product.manifest_sha256.clone(),
                manifest_bytes: product.manifest_bytes,
                install_root_identity: path_identity(&product.install_root),
                manifest_identity: path_identity(&product.manifest_path),
            })
            .collect(),
    }
}

fn revalidate_steam_baseline(baseline: &SetupBaseline) -> Result<(), String> {
    let current = discover_native_setup_products()?;
    if baseline_from_products(&current) != *baseline {
        return Err("Steam build, manifest, or canonical install identity changed; prepare a fresh vanilla audit. Steam verification is only a fallback when no trustworthy managed baseline exists".to_string());
    }
    Ok(())
}

fn remove_exact_ini_line(input: &str, exact: &str) -> Result<String, String> {
    let mut count = 0_usize;
    let mut output = String::with_capacity(input.len());
    for line in input.split_inclusive('\n') {
        let body = line.trim_end_matches(['\r', '\n']);
        if body == exact {
            count += 1;
            continue;
        }
        if body.contains("XCom_DLC_Day0") {
            return Err(format!("Unexpected Day0 edit-package content near {exact}"));
        }
        output.push_str(line);
    }
    if count != 1 {
        return Err(format!("Expected exactly one {exact} line, found {count}"));
    }
    Ok(output)
}

fn dominant_eol(input: &str) -> &'static str {
    let crlf = input.matches("\r\n").count();
    let lf = input.matches('\n').count().saturating_sub(crlf);
    if crlf > lf {
        "\r\n"
    } else {
        "\n"
    }
}

fn patch_ini_setting(input: &str, section: &str, key: &str, value: &str) -> Result<String, String> {
    let eol = dominant_eol(input);
    let mut lines: Vec<String> = input.split_inclusive('\n').map(str::to_string).collect();
    if !input.is_empty() && !input.ends_with('\n') && lines.is_empty() {
        lines.push(input.to_string());
    }
    let section_header = format!("[{section}]");
    let mut section_indexes = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if line.trim_end_matches(['\r', '\n']) == section_header {
            section_indexes.push(index);
        }
    }
    if section_indexes.len() > 1 {
        return Err(format!("Duplicate [{section}] sections are unsafe"));
    }
    if section_indexes.is_empty() {
        if !lines.is_empty() && !lines.last().is_some_and(|line| line.ends_with('\n')) {
            lines.last_mut().expect("non-empty").push_str(eol);
        }
        lines.push(format!("{section_header}{eol}"));
        lines.push(format!("{key}={value}{eol}"));
        return Ok(lines.concat());
    }
    let start = section_indexes[0] + 1;
    let end = lines[start..]
        .iter()
        .position(|line| line.trim_start().starts_with('['))
        .map_or(lines.len(), |offset| start + offset);
    let prefix = format!("{key}=");
    let matches: Vec<_> = (start..end)
        .filter(|index| {
            lines[*index]
                .trim_end_matches(['\r', '\n'])
                .starts_with(&prefix)
        })
        .collect();
    if matches.len() > 1 {
        return Err(format!(
            "Duplicate {key} settings in [{section}] are unsafe"
        ));
    }
    if let Some(index) = matches.first() {
        let ending = if lines[*index].ends_with("\r\n") {
            "\r\n"
        } else if lines[*index].ends_with('\n') {
            "\n"
        } else {
            ""
        };
        lines[*index] = format!("{key}={value}{ending}");
    } else {
        lines.insert(end, format!("{key}={value}{eol}"));
    }
    Ok(lines.concat())
}

fn read_utf8_regular(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Required SDK configuration is not a regular file".to_string());
    }
    String::from_utf8(fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|_| "Required SDK configuration is not UTF-8".to_string())
}

fn audit_vanilla_setup(
    products: &[NativeProductInstall; 2],
) -> Result<(Vec<SetupOperation>, SetupBaseline), String> {
    let game = &products[0];
    let sdk = &products[1];
    let mut operations = Vec::new();
    let patches = [
        (DEFAULT_ENGINE, "+EditPackages=XCom_DLC_Day0"),
        (XCOM_ENGINE, "EditPackages=XCom_DLC_Day0"),
    ];
    for (relative, exact) in patches {
        let before = read_utf8_regular(&sdk.install_root.join(relative))?;
        let after = remove_exact_ini_line(&before, exact)?;
        operations.push(SetupOperation {
            id: format!("patch-{}", relative.replace('/', "-")),
            kind: OperationKind::AtomicTextPatch,
            relative_path: relative.to_string(),
            generated_content: Some(after),
            link_target: None,
            executable: true,
        });
    }
    let editor_path = sdk.install_root.join(EDITOR_SETTINGS);
    let editor = read_utf8_regular(&editor_path)?;
    let editor = patch_ini_setting(&editor, "SourceControl", "Disabled", "True")?;
    let editor = patch_ini_setting(&editor, "GameAssetDatabase", "OfflineMode", "true")?;
    operations.push(SetupOperation {
        id: "patch-editor-user-settings".to_string(),
        kind: OperationKind::AtomicTextPatch,
        relative_path: EDITOR_SETTINGS.to_string(),
        generated_content: Some(editor),
        link_target: None,
        executable: true,
    });

    let classes = sdk.install_root.join(TLE_CLASSES);
    let metadata = fs::symlink_metadata(&classes).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("TLE classes directory is suspicious".to_string());
    }
    let mut tle = Vec::new();
    for entry in fs::read_dir(&classes).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.contains("TLE") {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() || !file_type.is_file() || name.contains(['/', '\\']) {
            return Err("TLE inventory contains a suspicious path or type".to_string());
        }
        tle.push(name);
    }
    tle.sort();
    if tle.len() != 11 {
        return Err(format!(
            "Expected exactly 11 direct TLE files, found {}",
            tle.len()
        ));
    }
    for name in tle {
        operations.push(SetupOperation {
            id: format!("quarantine-{name}"),
            kind: OperationKind::QuarantineFile,
            relative_path: format!("{TLE_CLASSES}/{name}"),
            generated_content: None,
            link_target: None,
            executable: true,
        });
    }

    let game_target = game.install_root.join(GAME_COOKED);
    let game_target = game_target
        .canonicalize()
        .map_err(|error| format!("Installed WOTC CookedPCConsole is unavailable: {error}"))?;
    if !game_target.is_dir() {
        return Err("Installed WOTC CookedPCConsole target is not a directory".to_string());
    }
    let link = sdk.install_root.join(COOKED_LINK);
    match fs::symlink_metadata(&link) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            operations.push(SetupOperation {
                id: "create-cooked-pc-console-link".to_string(),
                kind: OperationKind::CreateSymlink,
                relative_path: COOKED_LINK.to_string(),
                generated_content: None,
                link_target: Some(game_target.to_string_lossy().into_owned()),
                executable: true,
            })
        }
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let actual = link.canonicalize().map_err(|error| error.to_string())?;
            if actual != game_target {
                return Err("Existing CookedPCConsole symlink has the wrong target".to_string());
            }
        }
        Ok(_) => return Err("Existing CookedPCConsole path conflicts with setup".to_string()),
        Err(error) => return Err(error.to_string()),
    }
    Ok((operations, baseline_from_products(products)))
}

fn rehydrate_transaction(tx: &mut SetupTransaction, root: &Path) -> Result<(), String> {
    if tx.baseline.is_none() || tx.state != TransactionState::Prepared {
        return Ok(());
    }
    let products = discover_native_setup_products()?;
    if products[1].install_root != root {
        return Err("Journal target identity differs from the allowlisted SDK root".to_string());
    }
    let (operations, _) = audit_vanilla_setup(&products)?;
    let by_id: BTreeMap<_, _> = operations
        .into_iter()
        .map(|operation| (operation.id.clone(), operation))
        .collect();
    for step in &mut tx.steps {
        let operation = by_id
            .get(&step.operation.id)
            .ok_or("Prepared journal no longer matches vanilla audit")?;
        step.operation.generated_content = operation.generated_content.clone();
        step.operation.link_target = operation.link_target.clone();
    }
    Ok(())
}

fn unique_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, TransactionInner) {
        let root = std::env::temp_dir().join(format!("xcom2-transaction-test-{}", unique_id()));
        fs::create_dir_all(&root).unwrap();
        (root.canonicalize().unwrap(), TransactionInner::default())
    }
    fn op(kind: OperationKind, path: &str, content: Option<&str>) -> SetupOperation {
        SetupOperation {
            id: format!("op-{path}"),
            kind,
            relative_path: path.to_string(),
            generated_content: content.map(str::to_string),
            link_target: None,
            executable: true,
        }
    }
    fn prepare(
        inner: &mut TransactionInner,
        root: &Path,
        operations: Vec<SetupOperation>,
    ) -> SetupTransaction {
        initialize(inner, root).unwrap();
        prepare_internal(
            inner,
            root,
            "fixture".to_string(),
            7,
            operations,
            true,
            vec![],
            None,
        )
        .unwrap()
    }
    fn apply(inner: &mut TransactionInner, root: &Path, tx: &SetupTransaction) -> SetupTransaction {
        apply_internal(
            inner,
            root,
            &tx.transaction_id,
            &tx.operation_digest,
            "fixture",
            7,
            true,
        )
        .unwrap()
    }
    fn fixture_states(root: &Path, paths: &[&str]) -> BTreeMap<String, FileState> {
        paths
            .iter()
            .map(|path| {
                (
                    (*path).to_string(),
                    observe(&root.join(path)).expect("fixture state must be observable"),
                )
            })
            .collect()
    }

    #[cfg(unix)]
    #[test]
    fn complete_synthetic_fixture_is_hash_exact_across_two_cycles() {
        let (root, mut inner) = fixture();
        fs::write(root.join("patch.ini"), "original patch\n").unwrap();
        fs::write(
            root.join("quarantine.bin"),
            b"proprietary fixture bytes\0\xff",
        )
        .unwrap();
        fs::write(root.join("target"), "symlink target").unwrap();
        let tracked = [
            "patch.ini",
            "quarantine.bin",
            "generated.txt",
            "generated-dir",
            "generated-link",
            "target",
        ];
        let original = fixture_states(&root, &tracked);

        for _cycle in 0..2 {
            let mut link = op(OperationKind::CreateSymlink, "generated-link", None);
            link.link_target = Some("target".to_string());
            let tx = prepare(
                &mut inner,
                &root,
                vec![
                    op(
                        OperationKind::AtomicTextPatch,
                        "patch.ini",
                        Some("managed patch\n"),
                    ),
                    op(OperationKind::QuarantineFile, "quarantine.bin", None),
                    op(
                        OperationKind::CreateGeneratedFile,
                        "generated.txt",
                        Some("generated output"),
                    ),
                    op(
                        OperationKind::CreateGeneratedDirectory,
                        "generated-dir",
                        None,
                    ),
                    link,
                ],
            );
            assert_eq!(
                apply(&mut inner, &root, &tx).state,
                TransactionState::Applied
            );
            assert_ne!(fixture_states(&root, &tracked), original);
            assert_eq!(
                rollback_internal(&mut inner, &root, &tx.transaction_id)
                    .unwrap()
                    .state,
                TransactionState::RolledBack
            );
            assert_eq!(fixture_states(&root, &tracked), original);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn patch_apply_rollback_cycles_preserve_hash() {
        let (root, mut inner) = fixture();
        fs::write(root.join("config.ini"), "original\n").unwrap();
        let original = hash_file(&root.join("config.ini")).unwrap().0;
        for _ in 0..2 {
            let tx = prepare(
                &mut inner,
                &root,
                vec![op(
                    OperationKind::AtomicTextPatch,
                    "config.ini",
                    Some("managed\n"),
                )],
            );
            let applied = apply(&mut inner, &root, &tx);
            assert_eq!(applied.state, TransactionState::Applied);
            let rolled = rollback_internal(&mut inner, &root, &tx.transaction_id).unwrap();
            assert_eq!(rolled.state, TransactionState::RolledBack);
            assert_eq!(
                rollback_internal(&mut inner, &root, &tx.transaction_id)
                    .unwrap()
                    .state,
                TransactionState::RolledBack
            );
            assert_eq!(hash_file(&root.join("config.ini")).unwrap().0, original);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn quarantine_and_generated_artifacts_cycle_twice() {
        let (root, mut inner) = fixture();
        for _ in 0..2 {
            fs::write(root.join("old.txt"), "valuable").unwrap();
            let tx = prepare(
                &mut inner,
                &root,
                vec![
                    op(OperationKind::QuarantineFile, "old.txt", None),
                    op(OperationKind::CreateGeneratedDirectory, "generated", None),
                    op(
                        OperationKind::CreateGeneratedFile,
                        "generated.txt",
                        Some("output"),
                    ),
                ],
            );
            apply(&mut inner, &root, &tx);
            assert!(!root.join("old.txt").exists());
            rollback_internal(&mut inner, &root, &tx.transaction_id).unwrap();
            assert_eq!(
                fs::read_to_string(root.join("old.txt")).unwrap(),
                "valuable"
            );
            assert!(!root.join("generated").exists());
            assert!(!root.join("generated.txt").exists());
            fs::remove_file(root.join("old.txt")).unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cycle_twice() {
        let (root, mut inner) = fixture();
        fs::write(root.join("target"), "ok").unwrap();
        for _ in 0..2 {
            let mut link = op(OperationKind::CreateSymlink, "link", None);
            link.link_target = Some("target".to_string());
            let tx = prepare(&mut inner, &root, vec![link]);
            apply(&mut inner, &root, &tx);
            assert_eq!(
                fs::read_link(root.join("link")).unwrap(),
                PathBuf::from("target")
            );
            rollback_internal(&mut inner, &root, &tx.transaction_id).unwrap();
            assert!(!root.join("link").exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_hash_and_digest_refuse_before_mutation() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "before").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("after"))],
        );
        fs::write(root.join("a"), "external").unwrap();
        assert!(apply_internal(
            &mut inner,
            &root,
            &tx.transaction_id,
            &tx.operation_digest,
            "fixture",
            7,
            true
        )
        .is_err());
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "external");
        let (root2, mut inner2) = fixture();
        fs::write(root2.join("a"), "before").unwrap();
        let tx2 = prepare(
            &mut inner2,
            &root2,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("after"))],
        );
        assert!(apply_internal(
            &mut inner2,
            &root2,
            &tx2.transaction_id,
            "bad",
            "fixture",
            7,
            true
        )
        .is_err());
        assert!(apply_internal(
            &mut inner2,
            &root2,
            &tx2.transaction_id,
            &tx2.operation_digest,
            "other",
            7,
            true
        )
        .is_err());
        assert_eq!(fs::read_to_string(root2.join("a")).unwrap(), "before");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(root2).unwrap();
    }

    #[test]
    fn reverse_rollback_conflict_and_idempotence() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "a0").unwrap();
        fs::write(root.join("b"), "b0").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![
                op(OperationKind::AtomicTextPatch, "a", Some("a1")),
                op(OperationKind::AtomicTextPatch, "b", Some("b1")),
            ],
        );
        let applied = apply(&mut inner, &root, &tx);
        assert_eq!(
            apply(&mut inner, &root, &applied).state,
            TransactionState::Applied
        );
        fs::write(root.join("a"), "external").unwrap();
        let rolled = rollback_internal(&mut inner, &root, &tx.transaction_id).unwrap();
        assert_eq!(rolled.state, TransactionState::RollbackConflict);
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "external");
        assert_eq!(fs::read_to_string(root.join("b")).unwrap(), "b0");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retry_rollback_preserves_a_persistent_external_conflict() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "before").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("managed"))],
        );
        apply(&mut inner, &root, &tx);
        fs::write(root.join("a"), "external").unwrap();
        assert_eq!(
            rollback_internal(&mut inner, &root, &tx.transaction_id)
                .unwrap()
                .state,
            TransactionState::RollbackConflict
        );

        let recovered =
            recover_internal(&mut inner, &root, &tx.transaction_id, "retry-rollback").unwrap();
        assert_eq!(recovered.state, TransactionState::RollbackConflict);
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "external");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retry_rollback_succeeds_after_conflict_is_restored_to_after_state() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "before").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("managed"))],
        );
        apply(&mut inner, &root, &tx);
        fs::write(root.join("a"), "external").unwrap();
        rollback_internal(&mut inner, &root, &tx.transaction_id).unwrap();
        fs::write(root.join("a"), "managed").unwrap();

        let recovered =
            recover_internal(&mut inner, &root, &tx.transaction_id, "retry-rollback").unwrap();
        assert_eq!(recovered.state, TransactionState::RolledBack);
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "before");
        assert_eq!(
            recover_internal(&mut inner, &root, &tx.transaction_id, "retry-rollback")
                .unwrap()
                .state,
            TransactionState::RolledBack
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verify_journal_is_inspect_only_and_classifies_conflicts() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "before").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("managed"))],
        );
        apply(&mut inner, &root, &tx);
        fs::write(root.join("a"), "external").unwrap();
        inner
            .transactions
            .get_mut(&tx.transaction_id)
            .unwrap()
            .state = TransactionState::RecoveryRequired;

        let inspected =
            recover_internal(&mut inner, &root, &tx.transaction_id, "verify-journal").unwrap();
        assert_eq!(inspected.state, TransactionState::RollbackConflict);
        assert_eq!(inspected.steps[0].status, StepStatus::Conflict);
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "external");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_strategy_allowlist_matches_command_contract() {
        assert_eq!(
            RecoveryStrategy::parse("resume-rollback").unwrap(),
            RecoveryStrategy::ResumeRollback
        );
        assert_eq!(
            RecoveryStrategy::parse("retry-rollback").unwrap(),
            RecoveryStrategy::RetryRollback
        );
        assert_eq!(
            RecoveryStrategy::parse("verify-journal").unwrap(),
            RecoveryStrategy::VerifyJournal
        );
        assert!(RecoveryStrategy::parse("force-rollback").is_err());

        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "before").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("managed"))],
        );
        apply(&mut inner, &root, &tx);
        assert!(recover_internal(&mut inner, &root, &tx.transaction_id, "unknown").is_err());
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "managed");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn injected_failure_persists_write_ahead_state_and_recovers_after_restart() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "a0").unwrap();
        fs::write(root.join("b"), "b0").unwrap();
        let original = fixture_states(&root, &["a", "b"]);
        let tx = prepare(
            &mut inner,
            &root,
            vec![
                op(OperationKind::AtomicTextPatch, "a", Some("a1")),
                op(OperationKind::AtomicTextPatch, "b", Some("b1")),
            ],
        );
        inner.fail_before_step = Some(1);
        let partial = apply(&mut inner, &root, &tx);
        assert_eq!(partial.state, TransactionState::Partial);
        assert_eq!(partial.steps[0].status, StepStatus::Applied);
        assert_eq!(partial.steps[1].status, StepStatus::Pending);

        let journal_path = transaction_dir(&root, &tx.transaction_id).join("journal.json");
        let durable: SetupTransaction =
            serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
        assert_eq!(durable.state, TransactionState::Partial);
        let backup = durable.steps[0].backup.as_ref().unwrap();
        let backup_path = transaction_dir(&root, &tx.transaction_id).join(&backup.relative_path);
        assert_eq!(hash_file(&backup_path).unwrap().0, backup.content_sha256);
        let FileState::File { sha256, .. } = &original["a"] else {
            panic!("original fixture must be a file");
        };
        assert_eq!(&backup.content_sha256, sha256);

        let mut restarted = TransactionInner::default();
        initialize(&mut restarted, &root).unwrap();
        classify_recovery(&mut restarted, &root, &tx.transaction_id).unwrap();
        assert_eq!(
            restarted.transactions[&tx.transaction_id].state,
            TransactionState::Partial
        );
        let rolled =
            recover_internal(&mut restarted, &root, &tx.transaction_id, "resume-rollback").unwrap();
        assert_eq!(rolled.state, TransactionState::RolledBack);
        assert_eq!(fixture_states(&root, &["a", "b"]), original);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn traversal_symlink_escape_and_corrupt_backup_are_rejected() {
        let (root, mut inner) = fixture();
        assert!(prepare_internal(
            &mut inner,
            &root,
            "fixture".into(),
            7,
            vec![op(
                OperationKind::CreateGeneratedFile,
                "../escape",
                Some("x")
            )],
            true,
            vec![],
            None,
        )
        .is_err());
        fs::write(root.join("a"), "a0").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("a1"))],
        );
        apply(&mut inner, &root, &tx);
        let backup = inner.transactions[&tx.transaction_id].steps[0]
            .backup
            .as_ref()
            .unwrap();
        fs::write(
            transaction_dir(&root, &tx.transaction_id).join(&backup.relative_path),
            "corrupt",
        )
        .unwrap();
        assert!(rollback_internal(&mut inner, &root, &tx.transaction_id).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn ancestor_symlink_escape_is_rejected() {
        let (root, mut inner) = fixture();
        let outside = std::env::temp_dir().join(format!("outside-{}", unique_id()));
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        assert!(prepare_internal(
            &mut inner,
            &root,
            "fixture".into(),
            7,
            vec![op(
                OperationKind::CreateGeneratedFile,
                "escape/file",
                Some("x")
            )],
            true,
            vec![],
            None,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn interrupted_intent_is_classified_without_mutation() {
        let (root, mut inner) = fixture();
        fs::write(root.join("a"), "original").unwrap();
        let tx = prepare(
            &mut inner,
            &root,
            vec![op(OperationKind::AtomicTextPatch, "a", Some("managed"))],
        );
        {
            let interrupted = inner.transactions.get_mut(&tx.transaction_id).unwrap();
            interrupted.state = TransactionState::Applying;
            interrupted.steps[0].status = StepStatus::IntentWritten;
            persist_transaction(&root, interrupted).unwrap();
        }
        classify_recovery(&mut inner, &root, &tx.transaction_id).unwrap();
        assert_eq!(
            inner.transactions[&tx.transaction_id].state,
            TransactionState::Partial
        );
        assert_eq!(fs::read_to_string(root.join("a")).unwrap(), "original");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn production_shaped_prepare_is_non_executable() {
        let (root, mut inner) = fixture();
        initialize(&mut inner, &root).unwrap();
        let tx = prepare_internal(
            &mut inner,
            &root,
            "fixture".into(),
            7,
            vec![],
            false,
            vec!["Required downloads are incomplete".into()],
            None,
        )
        .unwrap();
        assert_eq!(tx.state, TransactionState::Waiting);
        assert!(!tx.executable);
        assert!(apply_internal(
            &mut inner,
            &root,
            &tx.transaction_id,
            &tx.operation_digest,
            "fixture",
            7,
            false,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_events_prove_reverse_operation_order_and_complete_restoration() {
        let (root, mut inner) = fixture();
        fs::write(root.join("first"), "first-before").unwrap();
        fs::write(root.join("second"), "second-before").unwrap();
        fs::write(root.join("third"), "third-before").unwrap();
        let original = fixture_states(&root, &["first", "second", "third"]);
        let tx = prepare(
            &mut inner,
            &root,
            vec![
                op(OperationKind::AtomicTextPatch, "first", Some("first-after")),
                op(
                    OperationKind::AtomicTextPatch,
                    "second",
                    Some("second-after"),
                ),
                op(OperationKind::AtomicTextPatch, "third", Some("third-after")),
            ],
        );
        apply(&mut inner, &root, &tx);
        rollback_internal(&mut inner, &root, &tx.transaction_id).unwrap();
        let rollback_order: Vec<_> = inner
            .events
            .iter()
            .filter(|event| event.message == "Operation rolled back and verified")
            .filter_map(|event| event.operation_id.as_deref())
            .collect();
        assert_eq!(rollback_order, vec!["op-third", "op-second", "op-first"]);
        assert_eq!(
            fixture_states(&root, &["first", "second", "third"]),
            original
        );
        fs::remove_dir_all(root).unwrap();
    }

    static STEAM_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn synthetic_steam() -> (PathBuf, [NativeProductInstall; 2]) {
        let home = std::env::temp_dir().join(format!("xcom2-steam-home-{}", unique_id()));
        let steamapps = home.join(".local/share/Steam/steamapps");
        let game = steamapps.join("common/XCOM2");
        let sdk = steamapps.join("common/XCOM2SDK");
        fs::create_dir_all(game.join(GAME_COOKED)).unwrap();
        fs::create_dir_all(sdk.join("XComGame/Config")).unwrap();
        fs::create_dir_all(sdk.join(TLE_CLASSES)).unwrap();
        fs::write(
            sdk.join(DEFAULT_ENGINE),
            b"[Engine.Engine]\r\n+EditPackages=XCom_DLC_Day0\r\nKeep=1\r\n",
        )
        .unwrap();
        fs::write(
            sdk.join(XCOM_ENGINE),
            b"[UnrealEd.EditorEngine]\nEditPackages=XCom_DLC_Day0\nKeep=2\n",
        )
        .unwrap();
        fs::write(
            sdk.join(EDITOR_SETTINGS),
            b"[SourceControl]\r\nDisabled=False\r\n[Other]\r\nKeep=3\r\n",
        )
        .unwrap();
        for index in 0..11 {
            fs::write(
                sdk.join(TLE_CLASSES)
                    .join(format!("X2TLEFixture{index}.uc")),
                format!("fixture-{index}"),
            )
            .unwrap();
        }
        for (app_id, install, build) in [
            (268_500, "XCOM2", "8270065"),
            (602_410, "XCOM2SDK", "3197185"),
        ] {
            fs::write(
                steamapps.join(format!("appmanifest_{app_id}.acf")),
                format!("\"AppState\" {{ \"appid\" \"{app_id}\" \"installdir\" \"{install}\" \"StateFlags\" \"4\" \"buildid\" \"{build}\" \"BytesDownloaded\" \"100\" \"BytesToDownload\" \"100\" \"BytesStaged\" \"100\" \"BytesToStage\" \"100\" }}"),
            )
            .unwrap();
        }
        let previous = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let products = discover_native_setup_products().unwrap();
        if let Some(previous) = previous {
            std::env::set_var("HOME", previous);
        } else {
            std::env::remove_var("HOME");
        }
        (home, products)
    }

    #[cfg(unix)]
    #[test]
    fn vanilla_apply_rollback_prepare_apply_rollback_is_byte_and_mode_exact() {
        use std::os::unix::fs::PermissionsExt;
        let _guard = STEAM_ENV_LOCK.lock().unwrap();
        let (home, products) = synthetic_steam();
        let previous = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let sdk = products[1].install_root.clone();
        fs::set_permissions(sdk.join(DEFAULT_ENGINE), fs::Permissions::from_mode(0o640)).unwrap();
        let tracked: Vec<_> = [DEFAULT_ENGINE, XCOM_ENGINE, EDITOR_SETTINGS]
            .into_iter()
            .chain((0..11).map(|index| {
                Box::leak(format!("{TLE_CLASSES}/X2TLEFixture{index}.uc").into_boxed_str()) as &str
            }))
            .collect();
        let original = fixture_states(&sdk, &tracked);
        let mut inner = TransactionInner::default();
        for _ in 0..2 {
            let (operations, baseline) =
                audit_vanilla_setup(&discover_native_setup_products().unwrap()).unwrap();
            assert_eq!(operations.len(), 15);
            initialize(&mut inner, &sdk).unwrap();
            let tx = prepare_internal(
                &mut inner,
                &sdk,
                "fixture".into(),
                9,
                operations,
                true,
                vec![],
                Some(baseline),
            )
            .unwrap();
            assert_eq!(
                apply_internal(
                    &mut inner,
                    &sdk,
                    &tx.transaction_id,
                    &tx.operation_digest,
                    "fixture",
                    9,
                    true
                )
                .unwrap()
                .state,
                TransactionState::Applied
            );
            assert!(sdk.join(COOKED_LINK).symlink_metadata().is_ok());
            assert_eq!(
                rollback_internal(&mut inner, &sdk, &tx.transaction_id)
                    .unwrap()
                    .state,
                TransactionState::RolledBack
            );
            assert_eq!(fixture_states(&sdk, &tracked), original);
            assert!(fs::symlink_metadata(sdk.join(COOKED_LINK)).is_err());
            assert_eq!(
                fs::metadata(sdk.join(DEFAULT_ENGINE))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o640
            );
        }
        if let Some(previous) = previous {
            std::env::set_var("HOME", previous);
        } else {
            std::env::remove_var("HOME");
        }
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn ini_patches_preserve_line_endings_and_insert_sections() {
        assert_eq!(
            remove_exact_ini_line(
                "a\r\n+EditPackages=XCom_DLC_Day0\r\nb\r\n",
                "+EditPackages=XCom_DLC_Day0"
            )
            .unwrap(),
            "a\r\nb\r\n"
        );
        let patched = patch_ini_setting(
            "[SourceControl]\nDisabled=False\n[Other]\nX=1\n",
            "SourceControl",
            "Disabled",
            "True",
        )
        .unwrap();
        let patched =
            patch_ini_setting(&patched, "GameAssetDatabase", "OfflineMode", "true").unwrap();
        assert!(patched.contains("Disabled=True\n"));
        assert!(patched.contains("[GameAssetDatabase]\nOfflineMode=true\n"));
        assert!(!patched.contains("\r\n"));
        assert!(remove_exact_ini_line(
            "EditPackages=XCom_DLC_Day0\nEditPackages=XCom_DLC_Day0\n",
            "EditPackages=XCom_DLC_Day0"
        )
        .is_err());
    }

    #[test]
    fn machine_journal_is_not_beneath_mutation_root() {
        let (root, _) = fixture();
        assert!(!state_dir(&root).starts_with(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "read-only audit of the locally installed Steam game and SDK"]
    fn live_prepare_audit_is_executable_and_never_applies() {
        let monitor = Xcom2SetupMonitorState::default();
        let gate = setup_transaction_gate(&monitor)
            .expect("live Steam products must be stable with exact build evidence");
        let (operations, baseline) =
            audit_vanilla_setup(&gate.products).expect("live SDK must be vanilla");
        let root = &gate.products[1].install_root;
        let blockers = gate.blockers;
        let executable = gate.ready && blockers.is_empty();
        let mut steps = Vec::new();
        for operation in operations {
            let precondition =
                observe(&operation_path(root, &operation.relative_path).unwrap()).unwrap();
            steps.push(JournalStep {
                operation,
                precondition,
                after_state: None,
                backup: None,
                status: StepStatus::Pending,
                checkpoint: 0,
            });
        }
        let digest =
            digest_operations("read-only-live-audit", "live", 1, &Some(baseline), &steps).unwrap();
        println!(
            "operations={} digest={} blockers={blockers:?} executable={executable}",
            steps.len(),
            digest
        );
        assert_eq!(steps.len(), 15);
        assert!(blockers.is_empty());
        assert!(executable);
    }

    #[test]
    fn event_and_list_limits_are_bounded() {
        let (root, mut inner) = fixture();
        initialize(&mut inner, &root).unwrap();
        for _ in 0..(MAX_EVENTS + 10) {
            let tx = prepare_internal(
                &mut inner,
                &root,
                "fixture".into(),
                7,
                vec![],
                false,
                vec!["blocked".into()],
                None,
            )
            .unwrap();
            emit(&mut inner, &tx, None, "test");
        }
        assert_eq!(inner.events.len(), MAX_EVENTS);
        assert_eq!(inner.transactions.len(), MAX_TRANSACTIONS);
        assert_eq!(
            fs::read_dir(transactions_dir(&root)).unwrap().count(),
            MAX_TRANSACTIONS
        );
        fs::remove_dir_all(root).unwrap();
    }
}
