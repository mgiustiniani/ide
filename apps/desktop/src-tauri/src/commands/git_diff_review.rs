//! Read-only working-tree Git review; the Git executable owns repository interpretation.
pub(super) mod process;
use super::workspace_registry::{active_workspace_generation, with_root_activation};
use crate::workspace::{resolve_existing_path_in_root, workspace_root};
use regex::Regex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn current_root(expected: Option<&str>, generation: u64) -> Result<PathBuf, String> {
    with_root_activation(|| {
        let root = workspace_root()?;
        if active_workspace_generation() != generation
            || expected.is_some_and(|expected| Path::new(expected) != root)
        {
            return Err("The workspace changed; refresh Git changes.".into());
        }
        Ok(root)
    })
}
fn require_current(root: &Path, generation: u64) -> Result<(), String> {
    current_root(root.to_str(), generation).map(|_| ())
}

#[tauri::command]
pub async fn git_status_modified(workspace_path: Option<String>) -> Result<Value, String> {
    let generation = active_workspace_generation();
    super::blocking::run(move || {
        let root = current_root(workspace_path.as_deref(), generation)?;
        let result = list_modified_in_root(&root);
        require_current(&root, generation)?;
        result
    })
    .await
}
fn list_modified_in_root(root: &Path) -> Result<Value, String> {
    serde_json::to_value(modified_paths(root, Instant::now() + process::TIMEOUT)?)
        .map_err(|_| "Git changes could not be decoded.".into())
}

#[tauri::command]
pub async fn git_diff_hunks(
    file_path: String,
    workspace_path: Option<String>,
) -> Result<Value, String> {
    let generation = active_workspace_generation();
    super::blocking::run(move || {
        let root = current_root(workspace_path.as_deref(), generation)?;
        let result = diff_in_root(&root, &file_path);
        require_current(&root, generation)?;
        result
    })
    .await
}
fn unavailable(reason: impl Into<String>) -> Value {
    json!({"kind":"unavailable", "reason": reason.into()})
}
fn diff_in_root(root: &Path, file_path: &str) -> Result<Value, String> {
    let deadline = Instant::now() + process::TIMEOUT;
    let paths = match modified_paths(root, deadline) {
        Ok(paths) => paths,
        Err(error) => return Ok(unavailable(error)),
    };
    if !paths.iter().any(|path| path == file_path) {
        return Ok(unavailable(
            "The selected file has no reviewable tracked changes.",
        ));
    }
    let text = match process::git(
        root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            "--",
            file_path,
        ],
        deadline,
    ) {
        Ok(text) => text,
        Err(error) => return Ok(unavailable(error)),
    };
    let hunks = parse_hunks(&text);
    if hunks.is_empty() {
        return Ok(unavailable(
            "No unstaged text changes are available for this file.",
        ));
    }
    let start = hunks
        .iter()
        .filter_map(|h| h["newStart"].as_u64())
        .min()
        .unwrap_or(1)
        .max(1);
    let end = hunks
        .iter()
        .filter_map(|h| {
            Some(
                h["newStart"]
                    .as_u64()?
                    .saturating_add(h["newLines"].as_u64()?.saturating_sub(1))
                    .max(1),
            )
        })
        .max()
        .unwrap_or(start);
    Ok(
        json!({"kind":"ok", "diff":{"path":file_path,"hunks":hunks,"range":{"path":file_path,"startLine":start,"endLine":end},"readOnly":true}}),
    )
}

#[tauri::command]
pub async fn editor_open_range(
    path: String,
    start_line: u32,
    end_line: u32,
    workspace_path: Option<String>,
) -> Result<Value, String> {
    let generation = active_workspace_generation();
    super::blocking::run(move || {
        let root = current_root(workspace_path.as_deref(), generation)?;
        let resolved = resolve_existing_path_in_root(&root, &path)?;
        if !resolved.is_file() || start_line == 0 || end_line < start_line {
            return Ok(unavailable("The source range is unavailable."));
        }
        require_current(&root, generation)?;
        Ok(json!({"path":resolved.to_string_lossy(),"startLine":start_line,"endLine":end_line}))
    })
    .await
}

fn modified_paths(root: &Path, deadline: Instant) -> Result<Vec<String>, String> {
    let prefix = process::git(root, &["rev-parse", "--show-prefix"], deadline)?;
    let prefix = prefix.strip_suffix('\n').unwrap_or(&prefix);
    let status = process::git(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=no",
            "--",
            ".",
        ],
        deadline,
    )?;
    parse_status(&status, prefix)
}
fn parse_status(status: &str, prefix: &str) -> Result<Vec<String>, String> {
    if !status.is_empty() && !status.ends_with('\0') {
        return Err("Git status output is incomplete.".into());
    }
    let mut records = status.split_terminator('\0');
    let mut paths = Vec::new();
    while let Some(record) = records.next() {
        let bytes = record.as_bytes();
        if bytes.len() < 4
            || bytes[2] != b' '
            || !bytes[..2].iter().all(|c| b" MADRCU?!T".contains(c))
        {
            return Err("Git status output is malformed.".into());
        }
        let code = &bytes[..2];
        if code.iter().any(|c| matches!(c, b'R' | b'C')) && records.next().is_none() {
            return Err("Git status output is incomplete.".into());
        }
        if !code.iter().any(|c| matches!(c, b'M' | b'A')) || code.contains(&b'D') {
            continue;
        }
        let path = record[3..]
            .strip_prefix(prefix)
            .ok_or("Git returned a path outside this workspace.")?;
        if path.is_empty() {
            continue;
        }
        paths.push(path.to_owned());
    }
    Ok(paths)
}

/// Pure parser: splits unified-diff text into hunks. Omitted counts default
/// to 1; each hunk carries old/new start, old/new count, and body text until
/// the next hunk header.
fn parse_hunks(text: &str) -> Vec<Value> {
    let re = Regex::new(r"(?m)^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n?").unwrap();
    let captures: Vec<regex::Captures> = re.captures_iter(text).collect();
    let mut hunks = Vec::new();
    for (idx, caps) in captures.iter().enumerate() {
        let whole = caps.get(0).unwrap();
        let body_start = whole.end();
        let body_end = captures
            .get(idx + 1)
            .map(|next| next.get(0).unwrap().start())
            .unwrap_or(text.len());
        let body = &text[body_start..body_end];
        let old_start: u32 = caps.get(1).unwrap().as_str().parse().unwrap_or(1);
        let old_lines: u32 = caps
            .get(2)
            .map(|m| m.as_str().parse().unwrap_or(1))
            .unwrap_or(1);
        let new_start: u32 = caps.get(3).unwrap().as_str().parse().unwrap_or(1);
        let new_lines: u32 = caps
            .get(4)
            .map(|m| m.as_str().parse().unwrap_or(1))
            .unwrap_or(1);
        hunks.push(json!({
            "oldStart": old_start,
            "oldLines": old_lines,
            "newStart": new_start,
            "newLines": new_lines,
            "text": body,
        }));
    }
    hunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_records_preserve_literal_paths_and_skip_rename_sources() {
        let status = " M src/lib.ts\0AM old -> new.java\0 D removed.java\0RM renamed.java\0old.java\0 M last.java\0";
        assert_eq!(
            parse_status(status, "").unwrap(),
            vec!["src/lib.ts", "old -> new.java", "renamed.java", "last.java"]
        );
        assert!(parse_status("bad", "").is_err());
    }

    #[test]
    fn parse_hunks_extracts_counts_and_bodies() {
        let text = "\
diff --git a/src/lib/git.ts b/src/lib/git.ts
index abc..def 100644
--- a/src/lib/git.ts
+++ b/src/lib/git.ts
@@ -10,3 +11,4 @@ context
  keep1
  keep2
+added
@@ -20 +22,2 @@ other
  keep3
+added2
";
        let hunks = parse_hunks(text);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0]["oldStart"], json!(10));
        assert_eq!(hunks[0]["oldLines"], json!(3));
        assert_eq!(hunks[0]["newStart"], json!(11));
        assert_eq!(hunks[0]["newLines"], json!(4));
        assert!(hunks[0]["text"].as_str().unwrap().contains("+added"));
        assert_eq!(hunks[1]["oldStart"], json!(20));
        assert_eq!(hunks[1]["oldLines"], json!(1));
        assert_eq!(hunks[1]["newStart"], json!(22));
        assert_eq!(hunks[1]["newLines"], json!(2));
        assert!(hunks[1]["text"].as_str().unwrap().contains("+added2"));
    }

    #[test]
    fn parse_hunks_returns_empty_without_headers() {
        let text = "no hunks here\njust lines\n";
        assert!(parse_hunks(text).is_empty());
    }
}

#[cfg(all(test, unix))]
mod git_integration_tests;
