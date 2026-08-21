// ---------------------------------------------------------------------------
// git_diff_review.rs — read-only git diff-review commands
//
// Native implementations behind REQ-IDE-GIT-DIFF-REVIEW-001:
//   git_status_modified  -> `git status --porcelain=v1` modified/added paths
//   git_diff_hunks       -> `git diff --no-ext-diff --unified=3` hunks + range
//   editor_open_range    -> resolve an existing path and report the exact
//                           range the editor port is asked to open
//
// The whole flow is strictly read-only: no command ever mutates the working
// tree, and unavailable states are reported honestly instead of fabricated.
// ---------------------------------------------------------------------------

use std::path::Path;
use std::process::Command;

use regex::Regex;
use serde_json::{json, Value};

use crate::workspace::{resolve_existing_path, workspace_root};

/// Lists the modified/added tracked paths (git status porcelain v1, M/A only).
#[tauri::command]
pub fn git_status_modified() -> Result<Value, String> {
    let root = workspace_root()?;
    let paths = modified_paths(&root);
    serde_json::to_value(paths).map_err(|e| format!("Serialization error: {e}"))
}

/// Read-only hunk-level diff for one modified/added working-tree path.
#[tauri::command]
pub fn git_diff_hunks(file_path: String) -> Result<Value, String> {
    let root = workspace_root()?;

    // Extract: the path must be a known modified/added working-tree file.
    let paths = modified_paths(&root);
    if !paths.iter().any(|p| p == &file_path) {
        return Ok(json!({
            "kind": "unavailable",
            "reason": format!("not a modified working-tree file: {file_path}")
        }));
    }

    // Delegate: read-only diff for exactly this path (no working-tree writes).
    let output = Command::new("git")
        .args(["diff", "--no-ext-diff", "--unified=3", "--", &file_path])
        .current_dir(&root)
        .output();
    let text = match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).into_owned()
        }
        _ => {
            return Ok(json!({
                "kind": "unavailable",
                "reason": format!("git diff failed for {file_path}")
            }));
        }
    };

    let hunks = parse_hunks(&text);
    if hunks.is_empty() {
        return Ok(json!({
            "kind": "unavailable",
            "reason": format!("no hunks available for {file_path}")
        }));
    }

    // Range: union of newStart..newStart+newLines-1 across all hunks.
    let mut range_start = u32::MAX;
    let mut range_end = 0u32;
    for hunk in &hunks {
        let new_start = hunk["newStart"].as_u64().unwrap_or(1) as u32;
        let new_lines = hunk["newLines"].as_u64().unwrap_or(1) as u32;
        let hunk_end = new_start
            .saturating_add(new_lines)
            .saturating_sub(1);
        if new_start < range_start {
            range_start = new_start;
        }
        if hunk_end > range_end {
            range_end = hunk_end;
        }
    }

    Ok(json!({
        "kind": "ok",
        "diff": {
            "path": file_path,
            "hunks": hunks,
            "range": {
                "path": file_path,
                "startLine": range_start,
                "endLine": range_end
            },
            "readOnly": true
        }
    }))
}

/// Resolves an existing workspace path and reports the exact requested range.
/// Performs no write: it only confirms what the editor port asks to open.
#[tauri::command]
pub fn editor_open_range(path: String, start_line: u32, end_line: u32) -> Result<Value, String> {
    let resolved = resolve_existing_path(&path)?;
    if !resolved.is_file() || start_line == 0 || end_line < start_line {
        return Ok(json!({
            "kind": "unavailable",
            "reason": format!(
                "cannot open range {start_line}..{end_line} in {path}: not a file or invalid range"
            )
        }));
    }
    Ok(json!({
        "kind": "ok",
        "opened": {
            "path": resolved.to_string_lossy(),
            "startLine": start_line,
            "endLine": end_line
        }
    }))
}

/// Runs `git status --porcelain=v1` in `root` and returns the M/A paths.
/// On process failure it returns an empty list (Ok(json!([])) semantics).
fn modified_paths(root: &Path) -> Vec<String> {
    let output = Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(root)
        .output();
    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<String> = stdout.lines().map(|s| s.to_owned()).collect();
            parse_status(&lines)
        }
        Err(_) => Vec::new(),
    }
}

/// Pure parser: keeps porcelain-v1 lines whose first two status columns
/// contain M or A (skips `??`, `D`, and renames), then trims the path and
/// keeps the destination after ` -> `.
fn parse_status(paths: &[String]) -> Vec<String> {
    let mut kept = Vec::new();
    for line in paths {
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < 3 {
            continue;
        }
        let x = chars[0];
        let y = chars[1];
        if !((x == 'M' || x == 'A') || (y == 'M' || y == 'A')) {
            continue;
        }
        let mut path = line.get(3..).unwrap_or("").trim().to_string();
        if let Some(arrow) = path.find(" -> ") {
            path = path.get(arrow + 4..).unwrap_or("").trim().to_string();
        }
        if path.is_empty() {
            continue;
        }
        kept.push(path);
    }
    kept
}

/// Pure parser: splits unified-diff text into hunks. Omitted counts default
/// to 1; each hunk carries old/new start, old/new count, and body text until
/// the next hunk header.
fn parse_hunks(text: &str) -> Vec<Value> {
    let re = Regex::new(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@").unwrap();
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
    fn parse_status_keeps_only_ma_lines() {
        let lines = vec![
            " M src/lib/git.ts".to_string(),
            "M  src/a.rs".to_string(),
            "MM src/b.rs".to_string(),
            "AM src/c.rs".to_string(),
            "?? untracked/".to_string(),
            " D deleted.rs".to_string(),
            "R  old.txt -> new.txt".to_string(),
            "!! ignored/".to_string(),
        ];
        let paths = parse_status(&lines);
        assert_eq!(
            paths,
            vec!["src/lib/git.ts", "src/a.rs", "src/b.rs", "src/c.rs"]
        );
    }

    #[test]
    fn parse_status_keeps_destination_after_arrow() {
        let lines = vec!["A  old.txt -> new.txt".to_string()];
        let paths = parse_status(&lines);
        assert_eq!(paths, vec!["new.txt"]);
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
