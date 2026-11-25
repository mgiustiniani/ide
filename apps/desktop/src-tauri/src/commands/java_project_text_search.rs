//! Bounded literal search over supported text files in the active Java project.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::Path;

use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current,
};
use crate::workspace::{ensure_within_root, workspace_root};

const MAX_QUERY_CHARS: usize = 256;
const MAX_DEPTH: usize = 32;
const MAX_ENTRIES: usize = 100_000;
const MAX_DIRECTORY_ENTRIES: usize = 8_192;
const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MATCHES: usize = 200;
const MAX_SNIPPET_CHARS: usize = 400;
const SEARCHABLE_TEXT_EXTENSIONS: &[&str] = &[
    "java",
    "kt",
    "kts",
    "xml",
    "properties",
    "yaml",
    "yml",
    "json",
    "jsonc",
    "sql",
    "html",
    "htm",
    "txt",
    "csv",
    "conf",
    "config",
    "gradle",
    "groovy",
    "toml",
    "md",
    "prefs",
];
const SEARCHABLE_EXTENSIONLESS_FILES: &[&str] = &[
    ".classpath",
    ".project",
    ".editorconfig",
    ".gitignore",
    ".gitattributes",
];
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".gradle",
    ".hg",
    ".idea",
    ".next",
    ".svn",
    ".turbo",
    "node_modules",
];
const BUILD_OUTPUT_DIRECTORIES: &[&str] = &["build", "coverage", "dist", "out", "target"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_path: String,
    query: String,
    case_sensitive: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    path: String,
    line: usize,
    column: usize,
    snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_path: String,
    query: String,
    matches: Vec<SearchMatch>,
    scanned_files: usize,
    skipped_files: usize,
    truncated: bool,
}

#[derive(Default)]
struct SearchState {
    matches: Vec<SearchMatch>,
    scanned_files: usize,
    skipped_files: usize,
    omitted_paths: bool,
    inspected_files: usize,
    visited_entries: usize,
    scanned_bytes: u64,
    truncated: bool,
}

#[tauri::command]
pub async fn search_java_project_text(
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_path: String,
    query: String,
    case_sensitive: bool,
) -> Result<serde_json::Value, String> {
    let request = SearchRequest {
        workspace_id,
        generation,
        request_id,
        project_path,
        query,
        case_sensitive,
    };
    super::blocking::run(move || search_active_project(request)).await
}

fn search_active_project(request: SearchRequest) -> Result<serde_json::Value, String> {
    validate_request(&request)?;
    let root = workspace_root()?;
    let registry = workspace_registry_path()?;
    let binding = current_workspace_binding_at(&root, &registry)?;
    if binding.workspace_id != request.workspace_id {
        return Err("The active workspace changed before Java search.".into());
    }

    let project = if request.project_path.is_empty() {
        binding.canonical_root.clone()
    } else {
        binding
            .canonical_root
            .join(&request.project_path)
            .canonicalize()
            .map_err(|_| "The selected Java project directory is unavailable.".to_owned())?
    };
    ensure_within_root(&binding.canonical_root, &project)
        .map_err(|_| "The selected Java project escapes the workspace.".to_owned())?;
    if !project.is_dir() {
        return Err("Select an existing Java project directory.".into());
    }

    let mut state = SearchState::default();
    let folded_query = (!request.case_sensitive).then(|| request.query.to_lowercase());
    visit_directory(
        &project,
        &binding.canonical_root,
        &project,
        0,
        &request.query,
        folded_query.as_deref(),
        &mut state,
    );

    if !current_workspace_binding_is_current(&binding) {
        return Err("The active workspace changed during Java search.".into());
    }

    serde_json::to_value(SearchResult {
        workspace_id: request.workspace_id,
        generation: request.generation,
        request_id: request.request_id,
        project_path: request.project_path,
        query: request.query,
        matches: state.matches,
        scanned_files: state.scanned_files,
        skipped_files: state.skipped_files,
        truncated: state.truncated || state.omitted_paths,
    })
    .map_err(|_| "Java search results could not be encoded.".into())
}

fn validate_request(request: &SearchRequest) -> Result<(), String> {
    let valid_relative = request.project_path.is_empty()
        || (!request.project_path.starts_with('/')
            && !request.project_path.contains('\\')
            && !request.project_path.contains(':')
            && !request.project_path.contains('\0')
            && request
                .project_path
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."));
    if request.workspace_id.is_empty()
        || request.workspace_id.len() > 256
        || request.request_id.is_empty()
        || request.request_id.len() > 256
        || request.project_path.len() > 4096
        || !valid_relative
        || request.query.trim().is_empty()
        || request.query.chars().count() > MAX_QUERY_CHARS
        || request
            .query
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\0'))
    {
        return Err("The Java project search request is invalid.".into());
    }
    Ok(())
}

fn visit_directory(
    project_root: &Path,
    workspace_root: &Path,
    directory: &Path,
    depth: usize,
    query: &str,
    folded_query: Option<&str>,
    state: &mut SearchState,
) {
    if state.truncated || depth > MAX_DEPTH {
        if depth > MAX_DEPTH {
            state.truncated = true;
        }
        return;
    }

    let read_entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            state.truncated = true;
            return;
        }
    };
    let remaining_entry_budget = MAX_ENTRIES.saturating_sub(state.visited_entries);
    let directory_entry_budget = remaining_entry_budget.min(MAX_DIRECTORY_ENTRIES);
    let mut entries = Vec::with_capacity(directory_entry_budget.min(4096));
    let mut directory_has_more_entries = false;
    for entry in read_entries.take(directory_entry_budget.saturating_add(1)) {
        match entry {
            Ok(entry) if entries.len() < directory_entry_budget => entries.push(entry),
            Ok(_) => directory_has_more_entries = true,
            Err(_) => state.truncated = true,
        }
        if state.truncated || directory_has_more_entries {
            break;
        }
    }
    if state.truncated {
        return;
    }
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if state.truncated {
            return;
        }
        if state.visited_entries >= MAX_ENTRIES {
            state.truncated = true;
            return;
        }
        state.visited_entries += 1;
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                state.truncated = true;
                continue;
            }
        };
        if file_type.is_symlink() {
            if is_searchable_project_text(&path) {
                record_skipped(state);
            }
            // A link may point to a Java source directory. Do not follow it,
            // since it may escape the workspace, and do not claim completeness.
            state.omitted_paths = true;
            continue;
        }
        if file_type.is_dir() {
            let name = entry.file_name();
            if name.to_str().is_some_and(|name| {
                IGNORED_DIRECTORIES.contains(&name)
                    || (BUILD_OUTPUT_DIRECTORIES.contains(&name)
                        && !is_inside_source_tree(project_root, &path))
            }) {
                continue;
            }
            visit_directory(
                project_root,
                workspace_root,
                &path,
                depth + 1,
                query,
                folded_query,
                state,
            );
            continue;
        }
        if !file_type.is_file() || !is_searchable_project_text(&path) {
            continue;
        }
        if state.inspected_files >= MAX_FILES {
            state.truncated = true;
            return;
        }
        state.inspected_files += 1;

        let size = match entry.metadata() {
            Ok(metadata) => metadata.len(),
            Err(_) => {
                record_skipped(state);
                continue;
            }
        };
        if size > MAX_FILE_BYTES {
            record_skipped(state);
            continue;
        }
        if state.scanned_bytes.saturating_add(size) > MAX_TOTAL_BYTES {
            state.truncated = true;
            return;
        }
        let mut bytes = Vec::with_capacity(size.min(MAX_FILE_BYTES) as usize);
        let file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(_) => {
                record_skipped(state);
                continue;
            }
        };
        let read_limit = MAX_FILE_BYTES.min(MAX_TOTAL_BYTES.saturating_sub(state.scanned_bytes));
        if file
            .take(read_limit.saturating_add(1))
            .read_to_end(&mut bytes)
            .is_err()
        {
            record_skipped(state);
            continue;
        }
        if bytes.len() as u64 > MAX_FILE_BYTES {
            record_skipped(state);
            continue;
        }
        if bytes.len() as u64 > read_limit {
            state.truncated = true;
            return;
        }
        state.scanned_bytes = state.scanned_bytes.saturating_add(bytes.len() as u64);
        let source = match std::str::from_utf8(&bytes) {
            Ok(source) if !bytes.contains(&0) => source,
            _ => {
                record_skipped(state);
                continue;
            }
        };
        state.scanned_files += 1;
        let relative_path = match path
            .strip_prefix(workspace_root)
            .ok()
            .and_then(Path::to_str)
        {
            Some(path) => path.replace('\\', "/"),
            None => {
                record_skipped(state);
                continue;
            }
        };

        for (index, line) in source.lines().enumerate() {
            let (columns, line_truncated) = literal_match_columns(
                line,
                query,
                folded_query.as_deref(),
                MAX_MATCHES.saturating_sub(state.matches.len()),
            );
            for column in columns {
                state.matches.push(SearchMatch {
                    path: relative_path.clone(),
                    line: index + 1,
                    column,
                    snippet: bounded_snippet(line),
                });
            }
            if line_truncated {
                state.truncated = true;
                return;
            }
        }
    }

    if directory_has_more_entries {
        state.truncated = true;
    }
}

fn literal_match_columns(
    line: &str,
    query: &str,
    folded_query: Option<&str>,
    limit: usize,
) -> (Vec<usize>, bool) {
    if limit == 0 {
        let contains_match = folded_query.map_or_else(
            || line.contains(query),
            |folded| line.to_lowercase().contains(folded),
        );
        return (Vec::new(), contains_match);
    }

    let mut columns = Vec::new();
    if let Some(folded_query) = folded_query {
        let mut folded_line = String::with_capacity(line.len());
        let mut source_byte_by_folded_byte = Vec::with_capacity(line.len());
        for (source_byte, character) in line.char_indices() {
            let lowered: String = character.to_lowercase().collect();
            folded_line.push_str(&lowered);
            source_byte_by_folded_byte.extend(std::iter::repeat(source_byte).take(lowered.len()));
        }
        for (folded_byte, _) in folded_line.match_indices(folded_query) {
            if columns.len() == limit {
                return (columns, true);
            }
            let source_byte = source_byte_by_folded_byte[folded_byte];
            columns.push(line[..source_byte].encode_utf16().count() + 1);
        }
    } else {
        for (source_byte, _) in line.match_indices(query) {
            if columns.len() == limit {
                return (columns, true);
            }
            columns.push(line[..source_byte].encode_utf16().count() + 1);
        }
    }
    (columns, false)
}

fn bounded_snippet(line: &str) -> String {
    let mut chars = line.chars();
    let mut snippet: String = chars.by_ref().take(MAX_SNIPPET_CHARS).collect();
    if chars.next().is_some() {
        snippet.push('…');
    }
    snippet
}

fn record_skipped(state: &mut SearchState) {
    state.skipped_files = state.skipped_files.saturating_add(1).min(MAX_FILES);
}

fn is_searchable_project_text(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SEARCHABLE_TEXT_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
    {
        return true;
    }

    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            SEARCHABLE_EXTENSIONLESS_FILES
                .iter()
                .any(|supported| name.eq_ignore_ascii_case(supported))
        })
}

fn is_inside_source_tree(project: &Path, path: &Path) -> bool {
    path.strip_prefix(project).is_ok_and(|relative| {
        let components: Vec<_> = relative.components().collect();
        components
            .iter()
            .take(components.len().saturating_sub(1))
            .any(|component| component.as_os_str().to_str() == Some("src"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP: AtomicUsize = AtomicUsize::new(0);

    struct TempProject(PathBuf);

    impl TempProject {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ide-java-project-search-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn searches_java_and_project_text_files_case_insensitively_and_omits_unsupported_files_and_build_outputs(
    ) {
        let project = TempProject::new();
        fs::create_dir_all(project.0.join("src/main/java/pkg")).unwrap();
        fs::create_dir_all(project.0.join("target/generated-sources")).unwrap();
        fs::create_dir_all(project.0.join("src/main/java/build")).unwrap();
        fs::write(
            project.0.join("src/main/java/pkg/Runner.java"),
            "package pkg;\npublic class Runner { void run() { System.out.println(\"Ready\"); } }\n",
        )
        .unwrap();
        fs::write(
            project.0.join("target/generated-sources/Generated.java"),
            "class Generated { String state = \"Ready\"; }\n",
        )
        .unwrap();
        fs::write(
            project.0.join("src/main/java/build/PackageType.java"),
            "package build; class PackageType { String state = \"Ready\"; }\n",
        )
        .unwrap();
        fs::create_dir_all(project.0.join("src/main/resources")).unwrap();
        fs::write(
            project.0.join("pom.xml"),
            "<project><name>Ready</name></project>\n",
        )
        .unwrap();
        fs::write(
            project.0.join("src/main/resources/application.properties"),
            "app.state=Ready\n",
        )
        .unwrap();
        fs::write(project.0.join("README.md"), "Ready\n").unwrap();
        fs::write(project.0.join("opaque.bin"), "Ready\n").unwrap();

        let mut state = SearchState::default();
        visit_directory(
            &project.0,
            &project.0,
            &project.0,
            0,
            "ready",
            Some("ready"),
            &mut state,
        );

        assert_eq!(state.matches.len(), 5);
        let paths: Vec<_> = state
            .matches
            .iter()
            .map(|item| item.path.as_str())
            .collect();
        assert_eq!(
            paths,
            [
                "README.md",
                "pom.xml",
                "src/main/java/build/PackageType.java",
                "src/main/java/pkg/Runner.java",
                "src/main/resources/application.properties"
            ]
        );
        assert_eq!(state.matches[3].line, 2);
        assert_eq!(state.matches[0].column, 1);
        assert_eq!(state.scanned_files, 5);
        assert!(!state.truncated);
    }

    #[test]
    fn reports_truncation_when_the_match_limit_is_reached() {
        let project = TempProject::new();
        let mut source = String::new();
        for _ in 0..=MAX_MATCHES {
            source.push_str("class Match {}\n");
        }
        fs::write(project.0.join("Many.java"), source).unwrap();

        let mut state = SearchState::default();
        visit_directory(
            &project.0, &project.0, &project.0, 0, "Match", None, &mut state,
        );

        assert_eq!(state.matches.len(), MAX_MATCHES);
        assert!(state.truncated);
    }

    #[test]
    fn returns_workspace_relative_paths_for_a_project_subdirectory() {
        let workspace = TempProject::new();
        let project = workspace.0.join("service");
        fs::create_dir_all(project.join("src/main/java")).unwrap();
        fs::write(project.join("src/main/java/App.java"), "class App {}\n").unwrap();

        let mut state = SearchState::default();
        visit_directory(&project, &workspace.0, &project, 0, "App", None, &mut state);

        assert_eq!(state.matches.len(), 1);
        assert_eq!(state.matches[0].path, "service/src/main/java/App.java");
        assert_eq!(state.matches[0].column, 7);
    }

    #[cfg(unix)]
    #[test]
    fn reports_incomplete_results_when_symlinked_sources_are_excluded() {
        use std::os::unix::fs::symlink;

        let project = TempProject::new();
        let linked = TempProject::new();
        fs::create_dir_all(linked.0.join("src/main/java")).unwrap();
        let linked_source = linked.0.join("src/main/java/Linked.java");
        fs::write(
            &linked_source,
            "class Linked { String value = \"needle\"; }\n",
        )
        .unwrap();
        fs::write(
            project.0.join("Visible.java"),
            "class Visible { String value = \"needle\"; }\n",
        )
        .unwrap();
        symlink(&linked_source, project.0.join("Alias.java")).unwrap();
        symlink(linked.0.join("src"), project.0.join("linked-source")).unwrap();

        let mut state = SearchState::default();
        visit_directory(
            &project.0, &project.0, &project.0, 0, "needle", None, &mut state,
        );

        assert_eq!(state.matches.len(), 1);
        assert_eq!(state.matches[0].path, "Visible.java");
        assert_eq!(state.scanned_files, 1);
        assert_eq!(state.skipped_files, 1);
        assert!(state.omitted_paths);
        assert!(!state.truncated);
    }

    #[test]
    fn reports_all_non_overlapping_match_columns_in_utf16_units() {
        assert_eq!(
            literal_match_columns(
                "😀 call WIDGET(); and widget;",
                "widget",
                Some("widget"),
                10
            ),
            (vec![9, 23], false)
        );
        assert_eq!(
            literal_match_columns("aaaaa", "aa", None, 10),
            (vec![1, 3], false)
        );
        assert_eq!(
            literal_match_columns("İname", "\u{307}", Some("\u{307}"), 10),
            (vec![1], false)
        );
        assert_eq!(
            literal_match_columns("class Other {}", "Widget", None, 10),
            (vec![], false)
        );
    }

    #[test]
    fn reports_when_non_overlapping_matches_exceed_the_result_limit() {
        let line = "x ".repeat(MAX_MATCHES + 1);
        let (columns, truncated) = literal_match_columns(&line, "x", None, MAX_MATCHES);

        assert_eq!(columns.len(), MAX_MATCHES);
        assert!(truncated);
    }

    #[test]
    fn refuses_absolute_or_parent_project_paths_and_multiline_queries() {
        let valid = SearchRequest {
            workspace_id: "workspace".into(),
            generation: 1,
            request_id: "request".into(),
            project_path: "../outside".into(),
            query: "needle".into(),
            case_sensitive: false,
        };
        assert!(validate_request(&valid).is_err());
        let mut multiline = valid;
        multiline.project_path.clear();
        multiline.query = "first\nsecond".into();
        assert!(validate_request(&multiline).is_err());
    }
}
