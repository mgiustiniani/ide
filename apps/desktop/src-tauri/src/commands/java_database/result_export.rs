//! Export a captured JDBC response through a native create-only save dialog. No SQL is executed.
use super::*;
use crate::commands::workspace_registry::{active_workspace_generation, with_root_activation};
use std::sync::{Arc, Mutex};
const MAX_EXPORT: usize = 2 * 1024 * 1024;
const STALE: &str = "The captured SQL result is no longer available for this workspace.";
static RESULTS: Mutex<Store> = Mutex::new(Store {
    token: 0,
    result: None,
});
static DIALOG_PENDING: AtomicBool = AtomicBool::new(false);
struct Captured {
    root: PathBuf,
    epoch: u64,
    session: Option<String>,
    query: JavaDatabaseQueryResult,
}
struct Store {
    token: u64,
    result: Option<Arc<Captured>>,
}
impl Store {
    fn begin(&mut self) -> u64 {
        self.token = self.token.wrapping_add(1);
        self.result = None;
        self.token
    }
    fn remember(&mut self, token: u64, result: Captured) {
        if token == self.token {
            self.result = Some(Arc::new(result));
        }
    }
    fn capture(&self, request: &ExportRequest) -> Result<Arc<Captured>, String> {
        self.result
            .as_ref()
            .filter(|value| {
                value.query.workspace_id == request.workspace_id
                    && value.query.generation == request.generation
                    && value.query.request_id == request.source_request_id
            })
            .cloned()
            .ok_or_else(|| STALE.into())
    }
    fn is_current(&self, captured: &Arc<Captured>) -> bool {
        self.result
            .as_ref()
            .is_some_and(|value| Arc::ptr_eq(value, captured))
    }
}
pub(super) fn begin() -> u64 {
    RESULTS.lock().map(|mut store| store.begin()).unwrap_or(0)
}
pub(super) fn clear() {
    begin();
}
pub(super) fn clear_session(id: &str) {
    if let Ok(mut store) = RESULTS.lock() {
        if store
            .result
            .as_ref()
            .is_some_and(|v| v.session.as_deref() == Some(id))
        {
            store.begin();
        }
    }
}
pub(super) fn remember(
    token: u64,
    root: PathBuf,
    epoch: u64,
    session: Option<String>,
    query: &JavaDatabaseQueryResult,
) {
    let _ = with_root_activation(|| {
        if active_workspace_generation() == epoch && workspace_root().ok().as_ref() == Some(&root) {
            RESULTS.lock().map_err(|_| STALE)?.remember(
                token,
                Captured {
                    root,
                    epoch,
                    session,
                    query: query.clone(),
                },
            );
        }
        Ok(())
    });
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Csv,
    Json,
}
impl Format {
    fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Json => "json",
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    source_request_id: String,
    format: Format,
    spreadsheet_text: bool,
    allow_partial: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    source_request_id: String,
    format: Format,
    file_path: String,
    byte_length: usize,
    row_count: usize,
    rows_truncated: bool,
    spreadsheet_text: bool,
}
struct DialogGuard;
impl DialogGuard {
    fn acquire() -> Result<Self, String> {
        DIALOG_PENDING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "An SQL result export dialog is already open.".into())
    }
}
impl Drop for DialogGuard {
    fn drop(&mut self) {
        DIALOG_PENDING.store(false, Ordering::Release);
    }
}
fn encode(
    query: &JavaDatabaseQueryResult,
    format: Format,
    prefix: bool,
    allow_partial: bool,
) -> Result<Vec<u8>, String> {
    if query.columns.is_empty()
        || query.columns.len() > 128
        || query.rows.len() > 200
        || query
            .rows
            .iter()
            .any(|row| row.len() != query.columns.len())
    {
        return Err("Only a bounded tabular SQL result can be exported.".into());
    }
    if query.rows_truncated && !allow_partial {
        return Err(
            "Acknowledge that only the captured partial SQL result will be exported.".into(),
        );
    }
    let bytes = match format {
        Format::Json => serde_json::to_vec(&serde_json::json!({
            "kind": "jdbc-result", "version": 1, "columns": query.columns,
            "rows": query.rows, "rowCount": query.rows.len(),
            "rowsTruncated": query.rows_truncated, "updateCount": query.update_count
        }))
        .map_err(|_| "The SQL result cannot be encoded.")?,
        Format::Csv => {
            fn cell(value: &str, prefix: bool) -> String {
                format!(
                    "\"{}{}\"",
                    if prefix { "'" } else { "" },
                    value.replace('"', "\"\"")
                )
            }
            let mut output = query
                .columns
                .iter()
                .map(|column| cell(&column.name, prefix))
                .collect::<Vec<_>>()
                .join(",");
            output.push_str("\r\n");
            for row in &query.rows {
                output.push_str(
                    &row.iter()
                        .map(|value| {
                            value
                                .as_deref()
                                .map(|value| cell(value, prefix))
                                .unwrap_or_default()
                        })
                        .collect::<Vec<_>>()
                        .join(","),
                );
                output.push_str("\r\n");
                if output.len() > MAX_EXPORT {
                    return Err("The SQL export exceeds 2 MiB.".into());
                }
            }
            output.into_bytes()
        }
    };
    if bytes.len() > MAX_EXPORT {
        return Err("The SQL export exceeds 2 MiB.".into());
    }
    Ok(bytes)
}
fn check(captured: &Arc<Captured>, request: &ExportRequest) -> Result<(), String> {
    if active_workspace_generation() != captured.epoch || workspace_root()? != captured.root {
        return Err(STALE.into());
    }
    let binding = current_workspace_binding_at(&captured.root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id
        || !current_workspace_binding_is_current(&binding)
        || !RESULTS.lock().map_err(|_| STALE)?.is_current(captured)
    {
        return Err(STALE.into());
    }
    Ok(())
}
fn publish(selected: &Path, format: Format, bytes: &[u8]) -> Result<String, String> {
    let text = selected
        .to_str()
        .ok_or("Choose a UTF-8 export destination.")?;
    if !selected.is_absolute()
        || text.len() > 32768
        || text.chars().any(char::is_control)
        || selected.extension().and_then(|v| v.to_str()) != Some(format.extension())
    {
        return Err("Choose a new export file with the selected extension and an existing parent directory.".into());
    }
    let parent = fs::canonicalize(
        selected
            .parent()
            .ok_or("The export has no parent directory.")?,
    )
    .map_err(|_| "The export directory is unavailable.")?;
    if !parent.is_dir() {
        return Err("The export parent is not a directory.".into());
    }
    let target = parent.join(selected.file_name().ok_or("Choose an export filename.")?);
    let path = target
        .to_str()
        .ok_or("Choose a UTF-8 export directory.")?
        .to_owned();
    if path.len() > 32768 || path.chars().any(char::is_control) {
        return Err("The export directory has an unsupported path.".into());
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Cannot prepare SQL export.")?;
    let temporary = parent.join(format!(
        ".ide-sql-export-{:x}.tmp",
        u128::from_be_bytes(random)
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Cannot prepare SQL export.")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot write SQL export.")?;
        drop(file);
        fs::hard_link(&temporary, &target).map_err(|_| {
            "The export destination exists or cannot be created. Choose a new filename."
        })?;
        fs::remove_file(&temporary)
            .map_err(|_| "The export was created but temporary cleanup failed.")?;
        #[cfg(unix)]
        fs::File::open(&parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| {
                "The export was created but directory durability could not be verified."
            })?;
        Ok(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
#[tauri::command]
pub async fn export_java_database_result(
    window: WebviewWindow,
    request: ExportRequest,
) -> Result<Option<ExportResult>, String> {
    use tauri_plugin_dialog::DialogExt;
    if window.label() != "main" {
        return Err("SQL result export requires the main window.".into());
    }
    for value in [&request.request_id, &request.source_request_id] {
        if value.is_empty() || value.len() > MAX_REQUEST_ID || value.chars().any(char::is_control) {
            return Err("Invalid SQL result export request.".into());
        }
    }
    let guard = DialogGuard::acquire()?;
    let captured = RESULTS.lock().map_err(|_| STALE)?.capture(&request)?;
    with_root_activation(|| check(&captured, &request))?;
    let bytes = encode(
        &captured.query,
        request.format,
        request.spreadsheet_text,
        request.allow_partial,
    )?;
    super::super::blocking::run(move || {
        let _guard = guard;
        let name = format!(
            "sql-result{}.{}",
            if captured.query.rows_truncated {
                "-partial"
            } else {
                ""
            },
            request.format.extension()
        );
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Export captured SQL result (plain text)")
            .set_file_name(&name)
            .add_filter("SQL result", &[request.format.extension()])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let selected = selected
            .into_path()
            .map_err(|_| "The export destination is not a local path.")?;
        with_root_activation(|| {
            check(&captured, &request)?;
            // Prevent a new query from retiring this exact result between the final check
            // and publication. This lock is held only for the bounded local write.
            let store = RESULTS.lock().map_err(|_| STALE)?;
            if !store.is_current(&captured) {
                return Err(STALE.into());
            }
            let file_path = publish(&selected, request.format, &bytes)?;
            Ok(Some(ExportResult {
                workspace_id: request.workspace_id,
                generation: request.generation,
                request_id: request.request_id,
                source_request_id: request.source_request_id,
                format: request.format,
                file_path,
                byte_length: bytes.len(),
                row_count: captured.query.rows.len(),
                rows_truncated: captured.query.rows_truncated,
                spreadsheet_text: request.format == Format::Csv && request.spreadsheet_text,
            }))
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn query() -> JavaDatabaseQueryResult {
        JavaDatabaseQueryResult {
            workspace_id: "ws-test".into(),
            generation: 4,
            request_id: "query-1".into(),
            columns: vec![
                JavaDatabaseQueryColumn {
                    name: "same".into(),
                    type_name: "VARCHAR".into(),
                },
                JavaDatabaseQueryColumn {
                    name: "same".into(),
                    type_name: "BIGINT".into(),
                },
            ],
            rows: vec![
                vec![
                    Some("é,\"Ada\"\r\n=1+1".into()),
                    Some("9007199254740993".into()),
                ],
                vec![None, Some(String::new())],
            ],
            update_count: None,
            rows_truncated: false,
            elapsed_ms: 2,
        }
    }
    fn request() -> ExportRequest {
        serde_json::from_value(serde_json::json!({"workspaceId":"ws-test","generation":4,"requestId":"export-1","sourceRequestId":"query-1","format":"json","spreadsheetText":false,"allowPartial":false})).unwrap()
    }
    #[test]
    fn formats_preserve_order_duplicate_labels_exact_strings_and_null_without_execution_details() {
        let query = query();
        let raw = String::from_utf8(encode(&query, Format::Csv, false, false).unwrap()).unwrap();
        assert_eq!(
            raw,
            "\"same\",\"same\"\r\n\"é,\"\"Ada\"\"\r\n=1+1\",\"9007199254740993\"\r\n,\"\"\r\n"
        );
        let prefixed =
            String::from_utf8(encode(&query, Format::Csv, true, false).unwrap()).unwrap();
        assert_eq!(
            prefixed,
            "\"'same\",\"'same\"\r\n\"'é,\"\"Ada\"\"\r\n=1+1\",\"'9007199254740993\"\r\n,\"'\"\r\n"
        );
        let json: serde_json::Value =
            serde_json::from_slice(&encode(&query, Format::Json, true, false).unwrap()).unwrap();
        assert_eq!(
            json["rows"],
            serde_json::json!([["é,\"Ada\"\r\n=1+1", "9007199254740993"], [null, ""]])
        );
        assert_eq!(json["columns"][0]["name"], json["columns"][1]["name"]);
        assert_eq!(json.as_object().unwrap().len(), 7);
        assert_eq!(json["rowsTruncated"], false);
    }
    #[test]
    fn partial_results_require_acknowledgment_and_non_tabular_or_oversized_results_are_refused() {
        let mut q = query();
        q.rows_truncated = true;
        assert!(encode(&q, Format::Json, false, false).is_err());
        let json: serde_json::Value =
            serde_json::from_slice(&encode(&q, Format::Json, false, true).unwrap()).unwrap();
        assert_eq!(json["rowsTruncated"], true);
        q.columns.clear();
        assert!(encode(&q, Format::Csv, true, true).is_err());
        q = query();
        q.rows[0].pop();
        assert!(encode(&q, Format::Json, false, false).is_err());
        q = query();
        q.rows[0][0] = Some("x".repeat(MAX_EXPORT));
        for f in [Format::Csv, Format::Json] {
            assert!(encode(&q, f, false, false).is_err());
        }
    }
    #[test]
    fn cache_rejects_late_queries_replaced_results_and_mismatched_request_scope() {
        let mut store = Store {
            token: 0,
            result: None,
        };
        let captured = || Captured {
            root: PathBuf::from("/fixture"),
            epoch: 3,
            session: None,
            query: query(),
        };
        let first = store.begin();
        let second = store.begin();
        store.remember(first, captured());
        assert!(store.capture(&request()).is_err());
        store.remember(second, captured());
        let current = store.capture(&request()).unwrap();
        for req in [
            ExportRequest {
                workspace_id: "other".into(),
                ..request()
            },
            ExportRequest {
                generation: 5,
                ..request()
            },
            ExportRequest {
                source_request_id: "other".into(),
                ..request()
            },
        ] {
            assert!(store.capture(&req).is_err());
        }
        store.begin();
        assert!(!store.is_current(&current));
        assert!(store.capture(&request()).is_err());
    }
    #[test]
    fn renderer_cannot_supply_destination_or_result_data() {
        for key in [
            "destination",
            "filePath",
            "rows",
            "columns",
            "sql",
            "jdbcUrl",
        ] {
            let mut value = serde_json::to_value(serde_json::json!({"workspaceId":"ws-test","generation":4,"requestId":"export-1","sourceRequestId":"query-1","format":"csv","spreadsheetText":true,"allowPartial":false})).unwrap();
            value[key] = serde_json::json!("untrusted");
            assert!(serde_json::from_value::<ExportRequest>(value).is_err());
        }
    }
    #[test]
    fn publication_creates_private_new_files_and_never_overwrites_or_follows_existing_links() {
        let fixture = TemporaryBridgeDirectory::create().unwrap();
        let root = &fixture.path;
        let destination = root.as_path().join("résultat.csv");
        publish(&destination, Format::Csv, b"first\r\n").unwrap();
        assert!(publish(&destination, Format::Csv, b"overwrite").is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"first\r\n");
        assert!(publish(&root.as_path().join("wrong.json"), Format::Csv, b"x").is_err());
        assert!(publish(&root.as_path().join("absent/file.csv"), Format::Csv, b"x").is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            assert_eq!(
                fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
                0o600
            );
            let link = root.as_path().join("link.csv");
            symlink(&destination, &link).unwrap();
            assert!(publish(&link, Format::Csv, b"overwrite").is_err());
            let dangling = root.as_path().join("dangling.csv");
            symlink(root.as_path().join("absent"), &dangling).unwrap();
            assert!(publish(&dangling, Format::Csv, b"overwrite").is_err());
        }
        let hard = root.as_path().join("hard.csv");
        fs::hard_link(&destination, &hard).unwrap();
        assert!(publish(&hard, Format::Csv, b"overwrite").is_err());
        let race = root.as_path().join("race.json");
        let results = std::thread::scope(|scope| {
            let a = scope.spawn(|| publish(&race, Format::Json, b"a"));
            let b = scope.spawn(|| publish(&race, Format::Json, b"b"));
            [a.join().unwrap(), b.join().unwrap()]
        });
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert!(fs::read_dir(root.as_path()).unwrap().all(|v| !v
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".ide-sql-export-")));
        assert_eq!(fs::read(&destination).unwrap(), b"first\r\n");
    }
}
