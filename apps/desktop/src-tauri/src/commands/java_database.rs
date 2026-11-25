//! Explicit, bounded JDBC metadata inspection and SQL execution.
pub mod result_export;
pub mod session;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::WebviewWindow;

use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current,
};
use crate::workspace::{resolve_existing_path_in_root, workspace_root};

const MAX_WORKSPACE_ID: usize = 256;
const MAX_REQUEST_ID: usize = 128;
const MAX_PATH: usize = 4096;
const MAX_JDBC_URL: usize = 4096;
const MAX_CREDENTIAL: usize = 1024;
const MAX_SQL: usize = 64 * 1024;
const MAX_DRIVER_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BRIDGE_OUTPUT: usize = 2 * 1024 * 1024;
const MAX_BRIDGE_ERROR: usize = 64 * 1024;
const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
const COMPILER_TIMEOUT: Duration = Duration::from_secs(20);
static NEXT_TEMP_DIRECTORY: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaDatabaseConnectionInput {
    workspace_id: String,
    generation: u64,
    request_id: String,
    jdk_home: String,
    driver_jar_path: String,
    jdbc_url: String,
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JavaDatabaseQuerySubmission {
    #[serde(flatten)]
    connection: JavaDatabaseConnectionInput,
    sql: String,
    #[serde(default)]
    parameters: Option<Vec<JavaDatabaseParameter>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
enum JavaDatabaseParameterType {
    String,
    Integer,
    Decimal,
    Boolean,
    Null,
    Date,
    Time,
    Timestamp,
    Binary,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JavaDatabaseParameter {
    #[serde(rename = "type")]
    kind: JavaDatabaseParameterType,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDatabaseColumn {
    name: String,
    type_name: String,
    nullable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDatabaseTable {
    catalog: Option<String>,
    schema: Option<String>,
    name: String,
    table_type: String,
    columns: Vec<JavaDatabaseColumn>,
    columns_truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum EstimatedPlanDialect {
    #[serde(rename = "h2")]
    H2,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDatabaseConnectionResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    product_name: String,
    product_version: String,
    estimated_plan_dialect: Option<EstimatedPlanDialect>,
    identifier_quote_string: Option<String>,
    current_catalog: Option<String>,
    tables: Vec<JavaDatabaseTable>,
    truncated: bool,
    elapsed_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDatabaseQueryColumn {
    name: String,
    type_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDatabaseQueryResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    columns: Vec<JavaDatabaseQueryColumn>,
    rows: Vec<Vec<Option<String>>>,
    update_count: Option<u64>,
    rows_truncated: bool,
    elapsed_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeColumn {
    name: String,
    type_name: String,
    nullable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeTable {
    catalog: Option<String>,
    schema: Option<String>,
    name: String,
    table_type: String,
    columns: Vec<BridgeColumn>,
    columns_truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeConnectionResult {
    product_name: String,
    product_version: String,
    #[serde(default)]
    estimated_plan_dialect: Option<EstimatedPlanDialect>,
    #[serde(default)]
    identifier_quote_string: Option<String>,
    #[serde(default)]
    current_catalog: Option<String>,
    tables: Vec<BridgeTable>,
    truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeQueryColumn {
    name: String,
    type_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeQueryResult {
    columns: Vec<BridgeQueryColumn>,
    rows: Vec<Vec<Option<String>>>,
    update_count: Option<u64>,
    rows_truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeError {
    error: String,
    sql_state: Option<String>,
}

struct AuthorizedRequest {
    binding: crate::commands::workspace_registry::CurrentWorkspaceBinding,
    activation_generation: u64,
    jdk_home: PathBuf,
    driver_jar: PathBuf,
}

#[derive(Clone, Copy)]
enum Operation {
    Inspect,
    Execute,
}

#[tauri::command]
pub async fn inspect_java_database(
    window: WebviewWindow,
    request: JavaDatabaseConnectionInput,
) -> Result<JavaDatabaseConnectionResult, String> {
    let authorized = authorize(&window, &request)?;
    result_export::clear();
    super::blocking::run(move || inspect(authorized, request)).await
}

#[tauri::command]
pub async fn execute_java_database(
    window: WebviewWindow,
    request: JavaDatabaseQuerySubmission,
) -> Result<JavaDatabaseQueryResult, String> {
    let authorized = authorize(&window, &request.connection)?;
    validate_sql(&request.sql)?;
    validate_parameters(request.parameters.as_deref())?;
    let token = result_export::begin();
    super::blocking::run(move || {
        let root = authorized.binding.canonical_root.clone();
        let epoch = authorized.activation_generation;
        let result = execute(authorized, request)?;
        result_export::remember(token, root, epoch, None, &result);
        Ok(result)
    })
    .await
}

fn authorize(
    window: &WebviewWindow,
    request: &JavaDatabaseConnectionInput,
) -> Result<AuthorizedRequest, String> {
    if window.label() != "main"
        || request.generation == 0
        || request.generation > 9_007_199_254_740_991
    {
        return Err("Database tools are restricted to the active main workspace.".into());
    }
    validate_text(
        &request.workspace_id,
        1,
        MAX_WORKSPACE_ID,
        "workspace identity",
    )?;
    validate_text(&request.request_id, 1, MAX_REQUEST_ID, "request identity")?;
    validate_text(&request.jdbc_url, 1, MAX_JDBC_URL, "JDBC URL")?;
    if !request.jdbc_url.starts_with("jdbc:") || request.jdbc_url.contains('\0') {
        return Err("Enter a valid JDBC connection URL.".into());
    }
    validate_text(&request.username, 0, MAX_CREDENTIAL, "database username")?;
    validate_text(&request.password, 0, MAX_CREDENTIAL, "database password")?;
    validate_text(&request.jdk_home, 0, MAX_PATH, "selected JDK path")?;
    validate_text(&request.driver_jar_path, 1, MAX_PATH, "JDBC driver path")?;

    let root = workspace_root()?;
    let binding = current_workspace_binding_at(&root, &workspace_registry_path()?)?;
    if binding.workspace_id != request.workspace_id {
        return Err("The active workspace changed before the database operation.".into());
    }
    let activation_generation = super::workspace_registry::active_workspace_generation();
    let driver_jar =
        resolve_existing_path_in_root(&binding.canonical_root, &request.driver_jar_path)
            .map_err(|_| "Select a JDBC driver JAR inside the active workspace.".to_owned())?;
    let driver_metadata = fs::metadata(&driver_jar)
        .map_err(|_| "The selected JDBC driver is unavailable.".to_owned())?;
    if !driver_jar.is_file()
        || driver_jar
            .extension()
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("jar"))
        || driver_metadata.len() > MAX_DRIVER_BYTES
    {
        return Err("The selected JDBC driver must be a JAR no larger than 128 MiB.".into());
    }
    Ok(AuthorizedRequest {
        binding,
        activation_generation,
        jdk_home: resolve_jdk_home(&request.jdk_home)?,
        driver_jar,
    })
}

fn validate_text(value: &str, minimum: usize, maximum: usize, field: &str) -> Result<(), String> {
    if value.len() < minimum || value.len() > maximum || value.contains('\0') {
        return Err(format!("The {field} is invalid or exceeds its size limit."));
    }
    Ok(())
}

fn validate_sql(sql: &str) -> Result<(), String> {
    validate_text(sql, 1, MAX_SQL, "SQL statement")?;
    if sql.trim().is_empty() {
        return Err("Enter a SQL statement.".into());
    }
    Ok(())
}

fn resolve_jdk_home(requested: &str) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if !requested.trim().is_empty() {
        candidates.push(PathBuf::from(requested));
    } else {
        for variable in ["IDE_JAVA_HOME", "JAVA_HOME"] {
            if let Some(path) = std::env::var_os(variable) {
                candidates.push(PathBuf::from(path));
            }
        }
        if let Some(path) = std::env::var_os("PATH") {
            for directory in std::env::split_paths(&path) {
                if directory.join(executable_name("java")).is_file() {
                    if let Some(home) = directory.parent().and_then(Path::parent) {
                        candidates.push(home.to_path_buf());
                        break;
                    }
                }
            }
        }
    }
    for candidate in candidates {
        let Ok(home) = candidate.canonicalize() else {
            continue;
        };
        if home.join("bin").join(executable_name("java")).is_file()
            && home.join("bin").join(executable_name("javac")).is_file()
        {
            return Ok(home);
        }
    }
    Err("A full JDK with java and javac is required for JDBC database tools.".into())
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn inspect(
    authorized: AuthorizedRequest,
    request: JavaDatabaseConnectionInput,
) -> Result<JavaDatabaseConnectionResult, String> {
    let started = Instant::now();
    let output = run_bridge(&authorized, &request, Operation::Inspect, "", None)?;
    ensure_current(&authorized)?;
    let bridge: BridgeConnectionResult = decode_bridge(output)?;
    Ok(JavaDatabaseConnectionResult {
        workspace_id: request.workspace_id,
        generation: request.generation,
        request_id: request.request_id,
        product_name: bridge.product_name,
        product_version: bridge.product_version,
        estimated_plan_dialect: bridge.estimated_plan_dialect,
        identifier_quote_string: bridge.identifier_quote_string,
        current_catalog: bridge.current_catalog,
        tables: bridge
            .tables
            .into_iter()
            .map(|table| JavaDatabaseTable {
                catalog: table.catalog,
                schema: table.schema,
                name: table.name,
                table_type: table.table_type,
                columns: table
                    .columns
                    .into_iter()
                    .map(|column| JavaDatabaseColumn {
                        name: column.name,
                        type_name: column.type_name,
                        nullable: column.nullable,
                    })
                    .collect(),
                columns_truncated: table.columns_truncated,
            })
            .collect(),
        truncated: bridge.truncated,
        elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

fn execute(
    authorized: AuthorizedRequest,
    request: JavaDatabaseQuerySubmission,
) -> Result<JavaDatabaseQueryResult, String> {
    let started = Instant::now();
    let output = run_bridge(
        &authorized,
        &request.connection,
        Operation::Execute,
        &request.sql,
        request.parameters.as_deref(),
    )?;
    ensure_current(&authorized)?;
    let bridge: BridgeQueryResult = decode_bridge(output)?;
    Ok(JavaDatabaseQueryResult {
        workspace_id: request.connection.workspace_id,
        generation: request.connection.generation,
        request_id: request.connection.request_id,
        columns: bridge
            .columns
            .into_iter()
            .map(|column| JavaDatabaseQueryColumn {
                name: column.name,
                type_name: column.type_name,
            })
            .collect(),
        rows: bridge.rows,
        update_count: bridge.update_count,
        rows_truncated: bridge.rows_truncated,
        elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

fn ensure_current(authorized: &AuthorizedRequest) -> Result<(), String> {
    if !current_workspace_binding_is_current(&authorized.binding)
        || super::workspace_registry::active_workspace_generation()
            != authorized.activation_generation
    {
        return Err("The active workspace changed during the database operation.".into());
    }
    Ok(())
}

fn prepare_bridge(
    authorized: &AuthorizedRequest,
    cancel: Option<&AtomicBool>,
) -> Result<TemporaryBridgeDirectory, String> {
    ensure_current(authorized)?;
    let temporary = TemporaryBridgeDirectory::create()?;
    let source = temporary.path.join("IdeDatabaseBridge.java");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&source)
        .map_err(|_| "The temporary JDBC bridge could not be prepared.".to_owned())?;
    file.write_all(include_bytes!("java_database_bridge.java"))
        .map_err(|_| "The temporary JDBC bridge could not be prepared.".to_owned())?;
    drop(file);

    let javac = authorized
        .jdk_home
        .join("bin")
        .join(executable_name("javac"));
    let mut compiler = Command::new(javac);
    compiler
        .arg("-proc:none")
        .arg("-encoding")
        .arg("UTF-8")
        .arg("-d")
        .arg(&temporary.path)
        .arg(&source);
    restrict_process_environment(&mut compiler, authorized, &temporary.path);
    run_process_cancelable(
        compiler,
        Vec::new(),
        COMPILER_TIMEOUT,
        MAX_BRIDGE_ERROR,
        cancel,
    )
    .map_err(|_| "The JDBC bridge could not be compiled with the selected JDK.".to_owned())?;

    Ok(temporary)
}

fn run_bridge(
    authorized: &AuthorizedRequest,
    connection: &JavaDatabaseConnectionInput,
    operation: Operation,
    sql: &str,
    parameters: Option<&[JavaDatabaseParameter]>,
) -> Result<Vec<u8>, String> {
    let temporary = prepare_bridge(authorized, None)?;
    let java = authorized
        .jdk_home
        .join("bin")
        .join(executable_name("java"));
    let class_path = std::env::join_paths([
        temporary.path.as_os_str(),
        authorized.driver_jar.as_os_str(),
    ])
    .map_err(|_| "The JDBC class path is invalid.".to_owned())?;
    let mut command = Command::new(java);
    command
        .arg("-Xms16m")
        .arg("-Xmx256m")
        .arg("-XX:MaxMetaspaceSize=128m")
        .arg("-Dfile.encoding=UTF-8")
        .arg("-cp")
        .arg(class_path)
        .arg("IdeDatabaseBridge")
        .arg(match operation {
            Operation::Inspect => "inspect",
            Operation::Execute => "execute",
        });
    restrict_process_environment(&mut command, authorized, &temporary.path);
    let input = bridge_input(connection, sql, parameters);
    let output = run_process(command, input, OPERATION_TIMEOUT, MAX_BRIDGE_OUTPUT)?;
    ensure_current(authorized)?;
    Ok(output)
}

fn restrict_process_environment(
    command: &mut Command,
    authorized: &AuthorizedRequest,
    temporary: &Path,
) {
    let separator = if cfg!(windows) { ";" } else { ":" };
    let bin = authorized.jdk_home.join("bin");
    let system_path = if cfg!(windows) {
        "C:\\Windows\\System32"
    } else {
        "/usr/bin:/bin"
    };
    command
        .env_clear()
        .env(
            "PATH",
            format!("{}{}{}", bin.display(), separator, system_path),
        )
        .env("HOME", temporary.join("home"))
        .env("TMPDIR", temporary)
        .env("TMP", temporary)
        .env("TEMP", temporary);
}

fn bridge_input(
    connection: &JavaDatabaseConnectionInput,
    sql: &str,
    parameters: Option<&[JavaDatabaseParameter]>,
) -> Vec<u8> {
    let mut input = Vec::new();
    for value in [
        &connection.jdbc_url,
        &connection.username,
        &connection.password,
        sql,
    ] {
        input.extend_from_slice(BASE64.encode(value.as_bytes()).as_bytes());
        input.push(b'\n');
    }
    input.extend_from_slice(
        parameters
            .map_or("-1".to_owned(), |values| values.len().to_string())
            .as_bytes(),
    );
    input.push(b'\n');
    for parameter in parameters.unwrap_or_default() {
        let kind = match parameter.kind {
            JavaDatabaseParameterType::String => "string",
            JavaDatabaseParameterType::Integer => "integer",
            JavaDatabaseParameterType::Decimal => "decimal",
            JavaDatabaseParameterType::Boolean => "boolean",
            JavaDatabaseParameterType::Null => "null",
            JavaDatabaseParameterType::Date => "date",
            JavaDatabaseParameterType::Time => "time",
            JavaDatabaseParameterType::Timestamp => "timestamp",
            JavaDatabaseParameterType::Binary => "binary",
        };
        for field in [kind, parameter.value.as_str()] {
            input.extend_from_slice(BASE64.encode(field.as_bytes()).as_bytes());
            input.push(b'\n');
        }
    }
    input
}

fn validate_parameters(parameters: Option<&[JavaDatabaseParameter]>) -> Result<(), String> {
    let Some(parameters) = parameters else {
        return Ok(());
    };
    if parameters.len() > 256 {
        return Err("Use at most 256 SQL parameters.".into());
    }
    let mut total = 0;
    for (index, parameter) in parameters.iter().enumerate() {
        total += parameter.value.len();
        if parameter.value.len() > 16 * 1024 || total > 64 * 1024 || parameter.value.contains('\0')
        {
            return Err("SQL parameter values exceed their 16 KiB individual or 64 KiB total limit, or contain NUL.".into());
        }
        let valid = match parameter.kind {
            JavaDatabaseParameterType::Integer => parameter.value.parse::<i64>().is_ok(),
            JavaDatabaseParameterType::Boolean => {
                matches!(parameter.value.as_str(), "true" | "false")
            }
            JavaDatabaseParameterType::Null => parameter.value.is_empty(),
            JavaDatabaseParameterType::Binary => BASE64.decode(&parameter.value).is_ok(),
            _ => true,
        };
        if !valid {
            return Err(format!(
                "SQL parameter {} has an invalid value for its selected type.",
                index + 1
            ));
        }
    }
    Ok(())
}

fn decode_bridge<T: for<'de> Deserialize<'de>>(output: Vec<u8>) -> Result<T, String> {
    if output.len() > MAX_BRIDGE_OUTPUT {
        return Err("The JDBC provider returned more data than the display limit.".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&output)
        .map_err(|_| "The JDBC provider returned invalid result data.".to_owned())?;
    if let Some(error) = value.get("error") {
        let message = error.as_str().unwrap_or("Database operation failed.");
        let sql_state = value.get("sqlState").and_then(serde_json::Value::as_str);
        return Err(match sql_state.filter(|state| !state.is_empty()) {
            Some(state) => format!("{message} SQL state: {state}."),
            None => message.to_owned(),
        });
    }
    serde_json::from_value(value)
        .map_err(|_| "The JDBC provider returned malformed result data.".to_owned())
}

fn run_process(
    command: Command,
    input: Vec<u8>,
    timeout: Duration,
    output_limit: usize,
) -> Result<Vec<u8>, String> {
    run_process_cancelable(command, input, timeout, output_limit, None)
}

fn configure_owned_process(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        #[cfg(target_os = "linux")]
        {
            let parent = std::process::id() as libc::pid_t;
            unsafe {
                command.pre_exec(move || {
                    if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    if libc::getppid() != parent {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::Interrupted,
                            "JDBC owner exited",
                        ));
                    }
                    Ok(())
                });
            }
        }
    }
}
fn stop_child(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn run_process_cancelable(
    mut command: Command,
    input: Vec<u8>,
    timeout: Duration,
    output_limit: usize,
    cancel: Option<&AtomicBool>,
) -> Result<Vec<u8>, String> {
    configure_owned_process(&mut command);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "The selected JDK process could not be started.".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "JDBC process output is unavailable.".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "JDBC process error output is unavailable.".to_owned())?;
    let output_reader = thread::spawn(move || bounded_read(stdout, output_limit));
    let error_reader = thread::spawn(move || bounded_read(stderr, MAX_BRIDGE_ERROR));
    let mut stdin = child
        .stdin
        .take()
        .ok_or("JDBC process input is unavailable.")?;
    let input_writer = thread::spawn(move || stdin.write_all(&input));
    // The deadline covers blocked input as well as compilation/query execution.
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {}
            Err(_) => break Err("The JDK process could not be inspected.".to_owned()),
        }
        if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            break Err("The JDBC operation was cancelled.".to_owned());
        }
        if Instant::now() >= deadline {
            break Err("The selected JDK operation timed out.".to_owned());
        }
        thread::sleep(Duration::from_millis(10));
    };
    // Close inherited pipes held by ordinary descendants before joining the readers.
    stop_child(&mut child);
    let input_written = input_writer.join();
    let output = output_reader
        .join()
        .map_err(|_| "JDBC process output could not be read.".to_owned())?
        .map_err(|_| "JDBC process output could not be read.".to_owned())?;
    let _ = error_reader.join();
    let status = status?;
    if !status.success() {
        let value: serde_json::Value = serde_json::from_slice(&output)
            .map_err(|_| "The JDBC provider could not complete the operation.".to_owned())?;
        let error: BridgeError = serde_json::from_value(value)
            .map_err(|_| "The JDBC provider could not complete the operation.".to_owned())?;
        return Err(match error.sql_state.filter(|state| !state.is_empty()) {
            Some(state) => format!("{} SQL state: {state}.", error.error),
            None => error.error,
        });
    }
    input_written
        .map_err(|_| "JDBC process input could not be written.")?
        .map_err(|_| "The JDBC process did not accept its request.")?;
    Ok(output)
}

fn bounded_read(mut reader: impl Read, limit: usize) -> Result<Vec<u8>, std::io::Error> {
    let mut retained = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0u8; 16 * 1024];
    let mut overflow = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return if overflow {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "JDBC process output exceeded its limit",
                ))
            } else {
                Ok(retained)
            };
        }
        let remaining = limit.saturating_sub(retained.len());
        overflow |= count > remaining;
        retained.extend_from_slice(&buffer[..count.min(remaining)]);
    }
}

struct TemporaryBridgeDirectory {
    path: PathBuf,
}

impl TemporaryBridgeDirectory {
    fn create() -> Result<Self, String> {
        let base = std::env::temp_dir();
        for _ in 0..32 {
            let sequence = NEXT_TEMP_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = base.join(format!(
                "ide-jdbc-{}-{timestamp}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(
                            |_| {
                                let _ = fs::remove_dir_all(&path);
                                "The private JDBC temporary directory could not be secured."
                                    .to_owned()
                            },
                        )?;
                    }
                    fs::create_dir(path.join("home")).map_err(|_| {
                        let _ = fs::remove_dir_all(&path);
                        "The private JDBC temporary directory could not be prepared.".to_owned()
                    })?;
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => break,
            }
        }
        Err("The private JDBC temporary directory could not be created.".into())
    }
}

impl Drop for TemporaryBridgeDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> JavaDatabaseConnectionInput {
        JavaDatabaseConnectionInput {
            workspace_id: "workspace-test".into(),
            generation: 2,
            request_id: "database-test".into(),
            jdk_home: "/jdk".into(),
            driver_jar_path: "drivers/h2.jar".into(),
            jdbc_url: "jdbc:h2:mem:ide".into(),
            username: "sa".into(),
            password: "private-password".into(),
        }
    }

    #[test]
    fn validates_jdbc_request_sizes_and_protocol() {
        let valid = request();
        assert!(valid.jdbc_url.starts_with("jdbc:"));
        assert!(validate_sql("select 1").is_ok());
        assert!(validate_sql(" \n ").is_err());
        assert!(validate_sql(&"x".repeat(MAX_SQL + 1)).is_err());
        assert!(validate_text(
            &valid.workspace_id,
            1,
            MAX_WORKSPACE_ID,
            "workspace identity"
        )
        .is_ok());
        assert!(validate_text(&"x".repeat(MAX_JDBC_URL + 1), 1, MAX_JDBC_URL, "JDBC URL").is_err());
    }

    #[test]
    fn sends_credentials_and_sql_only_in_encoded_stdin_fields() {
        let request = request();
        let input =
            String::from_utf8(bridge_input(&request, "select 'private-password'", None)).unwrap();
        assert!(!input.contains("private-password"));
        let fields: Vec<_> = input.lines().collect();
        assert_eq!(fields.len(), 5);
        assert_eq!(BASE64.decode(fields[2]).unwrap(), b"private-password");
        assert_eq!(
            BASE64.decode(fields[3]).unwrap(),
            b"select 'private-password'"
        );
    }
}

#[cfg(test)]
mod parameter_tests {
    use super::*;
    fn parameter(kind: JavaDatabaseParameterType, value: &str) -> JavaDatabaseParameter {
        JavaDatabaseParameter {
            kind,
            value: value.into(),
        }
    }
    #[test]
    #[cfg(unix)]
    fn request_deadline_includes_a_worker_that_does_not_read_stdin() {
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", "import time; time.sleep(5)"]);
        let started = Instant::now();
        let error = run_process(
            command,
            vec![b'x'; 1024 * 1024],
            Duration::from_millis(80),
            128,
        )
        .unwrap_err();
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "A blocked input pipe exceeded the operation deadline"
        );
        assert!(error.contains("timed out"));
    }
    #[test]
    #[cfg(unix)]
    fn refuses_output_overflow_instead_of_accepting_a_truncated_prefix() {
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", "print('x'*1024)"]);
        assert!(run_process(command, vec![], Duration::from_secs(3), 32).is_err());
    }

    #[test]
    fn validates_parameter_limits_and_exact_integer_boolean_null_and_binary_values() {
        assert!(validate_parameters(None).is_ok());
        assert!(validate_parameters(Some(&[])).is_ok());
        for (kind, value) in [
            (JavaDatabaseParameterType::Integer, "9223372036854775807"),
            (JavaDatabaseParameterType::Boolean, "false"),
            (JavaDatabaseParameterType::Null, ""),
            (JavaDatabaseParameterType::Binary, "AQIDBA=="),
        ] {
            assert!(validate_parameters(Some(&[parameter(kind, value)])).is_ok());
        }
        for (kind, value) in [
            (JavaDatabaseParameterType::Integer, "9223372036854775808"),
            (JavaDatabaseParameterType::Boolean, "yes"),
            (JavaDatabaseParameterType::Null, "not-null"),
            (JavaDatabaseParameterType::Binary, "not base64"),
        ] {
            let error = validate_parameters(Some(&[parameter(kind, value)])).unwrap_err();
            assert!(error.contains("parameter 1"));
            assert!(!error.contains(value));
        }
        assert!(validate_parameters(Some(&vec![
            parameter(JavaDatabaseParameterType::String, "");
            257
        ]))
        .is_err());
        assert!(validate_parameters(Some(&[parameter(
            JavaDatabaseParameterType::String,
            &"x".repeat(16 * 1024 + 1)
        )]))
        .is_err());
        assert!(validate_parameters(Some(&vec![
            parameter(
                JavaDatabaseParameterType::String,
                &"x".repeat(16 * 1024)
            );
            5
        ]))
        .is_err());
    }
    #[test]
    fn sends_parameter_types_and_exact_values_only_through_encoded_stdin() {
        let request = JavaDatabaseConnectionInput {
            workspace_id: "one".into(),
            generation: 1,
            request_id: "query".into(),
            jdk_home: "/jdk".into(),
            driver_jar_path: "h2.jar".into(),
            jdbc_url: "jdbc:h2:mem:test".into(),
            username: "sa".into(),
            password: "secret".into(),
        };
        let values = [
            parameter(
                JavaDatabaseParameterType::String,
                "Robert'); DROP TABLE greeting; --",
            ),
            parameter(JavaDatabaseParameterType::Integer, "9223372036854775807"),
        ];
        let data = String::from_utf8(bridge_input(
            &request,
            "INSERT INTO greeting VALUES (?,?)",
            Some(&values),
        ))
        .unwrap();
        assert!(!data.contains("secret"));
        assert!(!data.contains("DROP TABLE"));
        assert!(!data.contains("9223372036854775807"));
        let fields: Vec<_> = data.lines().collect();
        assert_eq!(fields[4], "2");
        assert_eq!(
            BASE64.decode(fields[6]).unwrap(),
            values[0].value.as_bytes()
        );
        assert_eq!(
            BASE64.decode(fields[8]).unwrap(),
            values[1].value.as_bytes()
        );
        let empty = String::from_utf8(bridge_input(&request, "SELECT 1", Some(&[]))).unwrap();
        assert_eq!(empty.lines().last(), Some("0"));
    }
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    #[ignore = "requires IDE_DATABASE_TEST_JDK_HOME and IDE_STORY_JAVA_DATABASE_DRIVER_PATH (H2 2.4.240)"]
    fn real_jdbc_prepared_parameters_preserve_values_and_refuse_invalid_bindings_without_mutation()
    {
        let home = PathBuf::from(std::env::var("IDE_DATABASE_TEST_JDK_HOME").unwrap())
            .canonicalize()
            .unwrap();
        let driver = PathBuf::from(std::env::var("IDE_STORY_JAVA_DATABASE_DRIVER_PATH").unwrap());
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).unwrap();
        let fixture = Fixture(std::env::temp_dir().join(format!(
            "ide-jdbc-parameters-{:x}",
            u128::from_be_bytes(nonce)
        )));
        let root = fixture.0.join("workspace");
        fs::create_dir_all(&root).unwrap();
        fs::copy(driver, root.join("h2.jar")).unwrap();
        let driver_bytes = fs::read(root.join("h2.jar")).unwrap();
        let registry = fixture.0.join("registry.json");
        let info = super::super::workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = current_workspace_binding_at(&root, &registry).unwrap();
        let authorized = || AuthorizedRequest {
            binding: binding.clone(),
            activation_generation: super::super::workspace_registry::active_workspace_generation(),
            jdk_home: home.clone(),
            driver_jar: root.join("h2.jar"),
        };
        let connection = JavaDatabaseConnectionInput {
            workspace_id: info.id,
            generation: 1,
            request_id: "jdbc-parameters".into(),
            jdk_home: home.to_string_lossy().into(),
            driver_jar_path: "h2.jar".into(),
            jdbc_url: format!("jdbc:h2:file:{}", fixture.0.join("data").display()),
            username: "sa".into(),
            password: "".into(),
        };
        let query = |sql: &str, parameters: Option<Vec<JavaDatabaseParameter>>| {
            execute(
                authorized(),
                JavaDatabaseQuerySubmission {
                    connection: connection.clone(),
                    sql: sql.into(),
                    parameters,
                },
            )
        };
        query("CREATE TABLE typed (id BIGINT PRIMARY KEY, text_value VARCHAR(512), exact_value DECIMAL(38,18), flag BOOLEAN, day_value DATE, time_value TIME(6), stamp TIMESTAMP(6), bytes VARBINARY, missing VARCHAR)",None).unwrap();
        let literal = "é 😀 Robert'); DROP TABLE typed; --";
        let parameters = vec![
            parameter(JavaDatabaseParameterType::Integer, "9223372036854775807"),
            parameter(JavaDatabaseParameterType::String, literal),
            parameter(
                JavaDatabaseParameterType::Decimal,
                "12345678901234567890.123456789012345678",
            ),
            parameter(JavaDatabaseParameterType::Boolean, "true"),
            parameter(JavaDatabaseParameterType::Date, "2024-02-29"),
            parameter(JavaDatabaseParameterType::Time, "12:34:56.123456"),
            parameter(
                JavaDatabaseParameterType::Timestamp,
                "2024-02-29T12:34:56.123456",
            ),
            parameter(JavaDatabaseParameterType::Binary, "AQIDBA=="),
            parameter(JavaDatabaseParameterType::Null, ""),
        ];
        validate_parameters(Some(&parameters)).unwrap();
        assert_eq!(
            query(
                "INSERT INTO typed VALUES (?,?,?,?,?,?,?,?,?)",
                Some(parameters)
            )
            .unwrap()
            .update_count,
            Some(1)
        );
        let row=query("SELECT id,text_value,exact_value,flag,day_value,CAST(time_value AS VARCHAR),stamp,bytes,missing FROM typed WHERE id=? AND text_value=?",Some(vec![parameter(JavaDatabaseParameterType::Integer,"9223372036854775807"),parameter(JavaDatabaseParameterType::String,literal)])).unwrap();
        assert_eq!(
            row.rows,
            vec![vec![
                Some("9223372036854775807".into()),
                Some(literal.into()),
                Some("12345678901234567890.123456789012345678".into()),
                Some("true".into()),
                Some("2024-02-29".into()),
                Some("12:34:56.123456".into()),
                Some("2024-02-29 12:34:56.123456".into()),
                Some("[BINARY 4 bytes]".into()),
                None
            ]]
        );
        let quoted = query(
            "SELECT '?' AS literal, CAST(? AS VARCHAR) AS actual /* ? is a comment */",
            Some(vec![parameter(JavaDatabaseParameterType::String, "bound")]),
        )
        .unwrap();
        assert_eq!(quoted.rows[0], vec![Some("?".into()), Some("bound".into())]);
        assert!(query("SELECT CAST(? AS VARCHAR)", Some(vec![]))
            .err()
            .expect("expected bound-query refusal")
            .contains("expects 1 parameters"));
        let unused_parameter_error = query(
            "SELECT 1",
            Some(vec![parameter(
                JavaDatabaseParameterType::String,
                "unused-secret",
            )]),
        )
        .err()
        .expect("expected bound-query refusal");
        assert!(
            unused_parameter_error.contains("expects 0 parameters"),
            "Unexpected binding refusal: {unused_parameter_error}"
        );
        for (sql, parameter) in [
            (
                "INSERT INTO typed(id,exact_value) VALUES (2,?)",
                parameter(JavaDatabaseParameterType::Decimal, "1e-2000"),
            ),
            (
                "INSERT INTO typed(id,day_value) VALUES (3,?)",
                parameter(JavaDatabaseParameterType::Date, "2023-02-29"),
            ),
        ] {
            let error = query(sql, Some(vec![parameter]))
                .err()
                .expect("expected bound-query refusal");
            assert!(error.contains("SQL parameter 1"));
            assert!(!error.contains("1e-2000") && !error.contains("2023-02-29"));
        }
        assert_eq!(
            query("SELECT COUNT(*) FROM typed", None).unwrap().rows[0][0],
            Some("1".into())
        );
        assert_eq!(fs::read(root.join("h2.jar")).unwrap(), driver_bytes);
    }
}
