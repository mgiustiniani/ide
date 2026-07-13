use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::workspace::resolve_new_path;
use crate::workspace::{resolve_existing_path, resolve_existing_path_in_root};

#[tauri::command]
pub fn read_file(path: String) -> Result<Value, String> {
    read_file_from_workspace(&path)
}

fn read_file_from_workspace(path: &str) -> Result<Value, String> {
    let path_buf = resolve_existing_path(path)?;
    read_resolved_file(&path_buf, path)
}

/// Runs the command's authorization, read, and response logic against an explicit root.
/// This is public so native integration tests can exercise the production implementation
/// without mutating the process-global active workspace.
pub fn read_file_in_root(root: &Path, path: &str) -> Result<Value, String> {
    let path_buf = resolve_existing_path_in_root(root, path)?;
    read_resolved_file(&path_buf, path)
}

fn read_resolved_file(path_buf: &Path, requested_path: &str) -> Result<Value, String> {
    if !path_buf.is_file() {
        return Err(format!("Path is not a file: {requested_path}"));
    }

    let content = fs::read_to_string(path_buf)
        .map_err(|e| format!("Cannot read file '{}': {e}", path_buf.display()))?;

    serde_json::to_value(serde_json::json!({
        "path": path_buf.to_string_lossy(),
        "content": content,
        "language": infer_language(path_buf)
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<Value, String> {
    let path_buf = resolve_new_path(&path)?;

    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent directories: {e}"))?;
    }

    fs::write(&path_buf, &content)
        .map_err(|e| format!("Cannot write file '{}': {e}", path_buf.display()))?;

    serde_json::to_value(serde_json::json!({
        "success": true,
        "path": path_buf.to_string_lossy()
    }))
    .map_err(|e| format!("Serialization error: {e}"))
}

/// Infer a simple language identifier from the file extension.
fn infer_language(path: &Path) -> String {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "rs" => "rust",
        "js" => "javascript",
        "ts" => "typescript",
        "tsx" => "typescriptreact",
        "jsx" => "javascriptreact",
        "py" => "python",
        "json" => "json",
        "html" => "html",
        "css" => "css",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "md" => "markdown",
        "sh" => "shell",
        "bash" => "shell",
        "c" => "c",
        "cpp" | "hpp" | "h" => "cpp",
        "go" => "go",
        "java" => "java",
        "rb" => "ruby",
        "php" => "php",
        "swift" => "swift",
        "kt" => "kotlin",
        "sql" => "sql",
        "xml" => "xml",
        "svg" => "svg",
        _ => "plaintext",
    }
    .to_string()
}
