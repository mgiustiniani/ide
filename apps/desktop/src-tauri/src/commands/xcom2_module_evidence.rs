use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::workspace::workspace_root;

const MAXIMUM_DEPTH: usize = 8;
const MAXIMUM_ENCOUNTERED_ENTRIES: usize = 20_000;
const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_CORRELATION_ID_BYTES: usize = 256;
const IGNORED_DIRECTORY_NAMES: [&str; 8] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".vite",
];

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Xcom2ModuleScanLimits {
    pub maximum_depth: usize,
    pub maximum_encountered_entries: usize,
}

pub(crate) const REQUIRED_LIMITS: Xcom2ModuleScanLimits = Xcom2ModuleScanLimits {
    maximum_depth: MAXIMUM_DEPTH,
    maximum_encountered_entries: MAXIMUM_ENCOUNTERED_ENTRIES,
};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Xcom2ModuleScanRequest {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub scan_id: String,
    pub scan_generation: u64,
    pub limits: Xcom2ModuleScanLimits,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Xcom2ModuleEvidenceKind {
    #[serde(rename = "x2proj")]
    X2proj,
    #[serde(rename = "xcommod")]
    Xcommod,
    #[serde(rename = "x2mbc-script-pair")]
    X2mbcScriptPair,
    #[serde(rename = "engine-config")]
    EngineConfig,
    #[serde(rename = "unrealscript-layout")]
    UnrealscriptLayout,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Xcom2ModuleEvidenceObservation {
    pub evidence_kind: Xcom2ModuleEvidenceKind,
    pub module_root: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Xcom2ModuleScanIssueKind {
    #[serde(rename = "unreadable-entry")]
    UnreadableEntry,
    #[serde(rename = "unreadable-subtree")]
    UnreadableSubtree,
    #[serde(rename = "depth-limit-reached")]
    DepthLimitReached,
    #[serde(rename = "encountered-entry-limit-reached")]
    EncounteredEntryLimitReached,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Xcom2ModuleScanIssue {
    pub kind: Xcom2ModuleScanIssueKind,
    pub relative_path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Xcom2ModuleScanCompleteness {
    Complete,
    Partial,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Xcom2ModuleScanSnapshot {
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub scan_id: String,
    pub scan_generation: u64,
    pub completeness: Xcom2ModuleScanCompleteness,
    pub issues: Vec<Xcom2ModuleScanIssue>,
    pub limits: Xcom2ModuleScanLimits,
    pub observations: Vec<Xcom2ModuleEvidenceObservation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RegularEntryKind {
    File,
    Directory,
}

#[derive(Default)]
struct ScriptPairCandidates {
    build_scripts: BTreeSet<String>,
    common_directories: BTreeSet<String>,
}

struct ScanAccumulator {
    observations: Vec<Xcom2ModuleEvidenceObservation>,
    issues: Vec<Xcom2ModuleScanIssue>,
    script_pairs: BTreeMap<String, ScriptPairCandidates>,
    encountered_entries: usize,
}

impl ScanAccumulator {
    fn new() -> Self {
        Self {
            observations: Vec::new(),
            issues: Vec::new(),
            script_pairs: BTreeMap::new(),
            encountered_entries: 0,
        }
    }

    fn issue(&mut self, kind: Xcom2ModuleScanIssueKind, relative_path: String) {
        self.issues.push(Xcom2ModuleScanIssue {
            kind,
            relative_path,
        });
    }

    fn observation(
        &mut self,
        evidence_kind: Xcom2ModuleEvidenceKind,
        module_root: String,
        relative_path: String,
    ) {
        self.observations.push(Xcom2ModuleEvidenceObservation {
            evidence_kind,
            module_root,
            relative_path,
        });
    }
}

/// Scans only the process's current canonical workspace authority. The request deliberately has no
/// provider, root, source, content, or classifier-policy field.
#[tauri::command]
pub fn scan_xcom2_module_evidence(
    request: Xcom2ModuleScanRequest,
) -> Result<Xcom2ModuleScanSnapshot, String> {
    validate_request(&request)?;

    if !cfg!(target_os = "linux") {
        return Err("XCOM 2 module evidence scanning is available only on Linux".to_string());
    }

    let root = workspace_root()
        .map_err(|_| "Cannot resolve the current authorized workspace root".to_string())?;
    scan_workspace_with_limits(&root, request, REQUIRED_LIMITS)
}

pub(crate) fn validate_request(request: &Xcom2ModuleScanRequest) -> Result<(), String> {
    if !valid_correlation_id(&request.workspace_id) {
        return Err("Invalid XCOM 2 module scan workspace correlation ID".to_string());
    }
    if !valid_correlation_id(&request.scan_id) {
        return Err("Invalid XCOM 2 module scan correlation ID".to_string());
    }
    if request.workspace_generation == 0 || request.workspace_generation > JS_MAX_SAFE_INTEGER {
        return Err("Invalid XCOM 2 module scan workspace generation".to_string());
    }
    if request.scan_generation == 0 || request.scan_generation > JS_MAX_SAFE_INTEGER {
        return Err("Invalid XCOM 2 module scan generation".to_string());
    }
    if request.limits != REQUIRED_LIMITS {
        return Err(format!(
            "Invalid XCOM 2 module scan limits; maximumDepth must be {MAXIMUM_DEPTH} and maximumEncounteredEntries must be {MAXIMUM_ENCOUNTERED_ENTRIES}"
        ));
    }
    Ok(())
}

fn valid_correlation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CORRELATION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}

pub(crate) fn scan_workspace_with_limits(
    root: &Path,
    request: Xcom2ModuleScanRequest,
    limits: Xcom2ModuleScanLimits,
) -> Result<Xcom2ModuleScanSnapshot, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Cannot resolve the current authorized workspace root".to_string())?;
    if !canonical_root.is_dir() {
        return Err("The current authorized workspace root is not a directory".to_string());
    }

    let mut accumulator = ScanAccumulator::new();
    let mut directories = VecDeque::from([(canonical_root.clone(), Vec::<String>::new(), 0usize)]);
    let mut budget_reached = false;

    if limits.maximum_depth == 0 {
        accumulator.issue(Xcom2ModuleScanIssueKind::DepthLimitReached, ".".to_string());
        directories.clear();
    }
    if limits.maximum_encountered_entries == 0 {
        accumulator.issue(
            Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
            ".".to_string(),
        );
        directories.clear();
    }

    'scan: while let Some((directory, relative_components, directory_depth)) =
        directories.pop_front()
    {
        let relative_directory = normalized_relative_path(&relative_components);
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                accumulator.issue(
                    Xcom2ModuleScanIssueKind::UnreadableSubtree,
                    relative_directory,
                );
                continue;
            }
        };

        for entry_result in entries {
            if accumulator.encountered_entries >= limits.maximum_encountered_entries {
                accumulator.issue(
                    Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
                    relative_directory.clone(),
                );
                budget_reached = true;
                break 'scan;
            }
            accumulator.encountered_entries += 1;

            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    accumulator.issue(
                        Xcom2ModuleScanIssueKind::UnreadableEntry,
                        relative_directory.clone(),
                    );
                    if accumulator.encountered_entries == limits.maximum_encountered_entries {
                        accumulator.issue(
                            Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
                            relative_directory.clone(),
                        );
                        budget_reached = true;
                        break 'scan;
                    }
                    continue;
                }
            };

            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                accumulator.issue(
                    Xcom2ModuleScanIssueKind::UnreadableEntry,
                    relative_directory.clone(),
                );
                if accumulator.encountered_entries == limits.maximum_encountered_entries {
                    accumulator.issue(
                        Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
                        relative_directory.clone(),
                    );
                    budget_reached = true;
                    break 'scan;
                }
                continue;
            };

            let mut entry_components = relative_components.clone();
            entry_components.push(name.clone());
            let relative_path = normalized_relative_path(&entry_components);
            let candidate = canonical_root.join(entry_components.iter().collect::<PathBuf>());
            let metadata = match fs::symlink_metadata(&candidate) {
                Ok(metadata) => metadata,
                Err(_) => {
                    accumulator.issue(
                        Xcom2ModuleScanIssueKind::UnreadableEntry,
                        relative_path.clone(),
                    );
                    if accumulator.encountered_entries == limits.maximum_encountered_entries {
                        accumulator.issue(
                            Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
                            relative_path,
                        );
                        budget_reached = true;
                        break 'scan;
                    }
                    continue;
                }
            };

            // A symlink or unsupported file type is counted, but it is neither canonicalized as a
            // regular path nor traversed nor accepted as evidence.
            let Some(entry_kind) = regular_entry_kind(&metadata) else {
                if accumulator.encountered_entries == limits.maximum_encountered_entries {
                    accumulator.issue(
                        Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
                        relative_path,
                    );
                    budget_reached = true;
                    break 'scan;
                }
                continue;
            };

            if !canonically_contained_regular_entry(
                &canonical_root,
                &candidate,
                &metadata,
                entry_kind,
            ) {
                accumulator.issue(
                    Xcom2ModuleScanIssueKind::UnreadableEntry,
                    relative_path.clone(),
                );
            } else {
                match entry_kind {
                    RegularEntryKind::File => {
                        record_regular_file(&entry_components, &relative_path, &mut accumulator);
                    }
                    RegularEntryKind::Directory => {
                        record_regular_directory(
                            &entry_components,
                            &relative_path,
                            &mut accumulator,
                        );
                        let entry_depth = directory_depth + 1;
                        if !IGNORED_DIRECTORY_NAMES.contains(&name.as_str()) {
                            if entry_depth >= limits.maximum_depth {
                                accumulator.issue(
                                    Xcom2ModuleScanIssueKind::DepthLimitReached,
                                    relative_path.clone(),
                                );
                            } else {
                                directories.push_back((candidate, entry_components, entry_depth));
                            }
                        }
                    }
                }
            }

            if accumulator.encountered_entries == limits.maximum_encountered_entries {
                accumulator.issue(
                    Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached,
                    relative_path,
                );
                budget_reached = true;
                break 'scan;
            }
        }
    }

    // If a limit was reached while queued subtrees remained, the single budget issue already
    // represents all unvisited regions. No path outside the workspace is ever included.
    let _ = budget_reached;
    emit_complete_script_pairs(&mut accumulator);
    accumulator.observations.sort_by(|left, right| {
        left.evidence_kind
            .cmp(&right.evidence_kind)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.module_root.cmp(&right.module_root))
    });
    accumulator.observations.dedup();
    accumulator.issues.sort();
    accumulator.issues.dedup();

    let completeness = if accumulator.issues.is_empty() {
        Xcom2ModuleScanCompleteness::Complete
    } else {
        Xcom2ModuleScanCompleteness::Partial
    };

    Ok(Xcom2ModuleScanSnapshot {
        workspace_id: request.workspace_id,
        workspace_generation: request.workspace_generation,
        scan_id: request.scan_id,
        scan_generation: request.scan_generation,
        completeness,
        issues: accumulator.issues,
        limits,
        observations: accumulator.observations,
    })
}

fn regular_entry_kind(metadata: &Metadata) -> Option<RegularEntryKind> {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        None
    } else if file_type.is_file() {
        Some(RegularEntryKind::File)
    } else if file_type.is_dir() {
        Some(RegularEntryKind::Directory)
    } else {
        None
    }
}

fn canonically_contained_regular_entry(
    root: &Path,
    candidate: &Path,
    first_metadata: &Metadata,
    expected_kind: RegularEntryKind,
) -> bool {
    let Ok(canonical) = candidate.canonicalize() else {
        return false;
    };
    if canonical != candidate || !canonical.starts_with(root) {
        return false;
    }

    let Ok(second_metadata) = fs::symlink_metadata(candidate) else {
        return false;
    };
    if regular_entry_kind(&second_metadata) != Some(expected_kind) {
        return false;
    }

    same_filesystem_entry(first_metadata, &second_metadata)
}

#[cfg(unix)]
fn same_filesystem_entry(first: &Metadata, second: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    first.dev() == second.dev() && first.ino() == second.ino()
}

#[cfg(not(unix))]
fn same_filesystem_entry(_first: &Metadata, _second: &Metadata) -> bool {
    true
}

fn record_regular_file(
    components: &[String],
    relative_path: &str,
    accumulator: &mut ScanAccumulator,
) {
    let Some(file_name) = components.last() else {
        return;
    };

    if file_name
        .strip_suffix(".x2proj")
        .is_some_and(|stem| !stem.is_empty())
    {
        accumulator.observation(
            Xcom2ModuleEvidenceKind::X2proj,
            module_root(&components[..components.len() - 1]),
            relative_path.to_string(),
        );
    }
    if file_name
        .strip_suffix(".XComMod")
        .is_some_and(|stem| !stem.is_empty())
    {
        accumulator.observation(
            Xcom2ModuleEvidenceKind::Xcommod,
            module_root(&components[..components.len() - 1]),
            relative_path.to_string(),
        );
    }

    if components.len() >= 2
        && components[components.len() - 2] == "Config"
        && file_name == "XComEngine.ini"
    {
        accumulator.observation(
            Xcom2ModuleEvidenceKind::EngineConfig,
            module_root(&components[..components.len() - 2]),
            relative_path.to_string(),
        );
    }

    if components.len() >= 4
        && components[components.len() - 4] == "Src"
        && !components[components.len() - 3].is_empty()
        && components[components.len() - 2] == "Classes"
        && file_name
            .strip_suffix(".uc")
            .is_some_and(|stem| !stem.is_empty())
    {
        accumulator.observation(
            Xcom2ModuleEvidenceKind::UnrealscriptLayout,
            module_root(&components[..components.len() - 4]),
            relative_path.to_string(),
        );
    }

    if components.len() >= 2
        && components[components.len() - 2] == ".scripts"
        && file_name == "build.ps1"
    {
        accumulator
            .script_pairs
            .entry(module_root(&components[..components.len() - 2]))
            .or_default()
            .build_scripts
            .insert(relative_path.to_string());
    }
}

fn record_regular_directory(
    components: &[String],
    relative_path: &str,
    accumulator: &mut ScanAccumulator,
) {
    if components.len() >= 2
        && components[components.len() - 2] == ".scripts"
        && components
            .last()
            .is_some_and(|name| name == "X2ModBuildCommon")
    {
        accumulator
            .script_pairs
            .entry(module_root(&components[..components.len() - 2]))
            .or_default()
            .common_directories
            .insert(relative_path.to_string());
    }
}

fn emit_complete_script_pairs(accumulator: &mut ScanAccumulator) {
    for (module_root, candidates) in std::mem::take(&mut accumulator.script_pairs) {
        if candidates.build_scripts.is_empty() || candidates.common_directories.is_empty() {
            continue;
        }
        for relative_path in candidates
            .build_scripts
            .into_iter()
            .chain(candidates.common_directories)
        {
            accumulator.observation(
                Xcom2ModuleEvidenceKind::X2mbcScriptPair,
                module_root.clone(),
                relative_path,
            );
        }
    }
}

fn module_root(components: &[String]) -> String {
    normalized_relative_path(components)
}

fn normalized_relative_path(components: &[String]) -> String {
    if components.is_empty() {
        ".".to_string()
    } else {
        components.join("/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestWorkspace(PathBuf);

    impl TestWorkspace {
        fn new(label: &str) -> Self {
            static NEXT_ID: AtomicU64 = AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "ide-xcom2-module-evidence-{label}-{nonce}-{}",
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).expect("create test workspace");
            Self(root.canonicalize().expect("canonical test workspace"))
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn file(&self, relative_path: &str, content: &[u8]) {
            let path = self.0.join(relative_path);
            fs::create_dir_all(path.parent().expect("file parent")).expect("create parent");
            fs::write(path, content).expect("write fixture");
        }

        fn directory(&self, relative_path: &str) {
            fs::create_dir_all(self.0.join(relative_path)).expect("create fixture directory");
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn request(limits: Xcom2ModuleScanLimits) -> Xcom2ModuleScanRequest {
        Xcom2ModuleScanRequest {
            workspace_id: "workspace:authorized".to_string(),
            workspace_generation: 7,
            scan_id: "xcom2-module-scan:7".to_string(),
            scan_generation: 3,
            limits,
        }
    }

    fn scan(root: &Path) -> Xcom2ModuleScanSnapshot {
        scan_workspace_with_limits(root, request(REQUIRED_LIMITS), REQUIRED_LIMITS)
            .expect("scan fixture")
    }

    fn triples(snapshot: &Xcom2ModuleScanSnapshot) -> Vec<(Xcom2ModuleEvidenceKind, &str, &str)> {
        snapshot
            .observations
            .iter()
            .map(|item| {
                (
                    item.evidence_kind,
                    item.module_root.as_str(),
                    item.relative_path.as_str(),
                )
            })
            .collect()
    }

    #[test]
    fn generic_xcom_names_are_not_evidence() {
        let workspace = TestWorkspace::new("generic");
        workspace.file("xcom-project-repository/notes.txt", b"ordinary notes");
        workspace.directory("XCOM2-module-name-only");

        let result = scan(workspace.path());

        assert_eq!(result.completeness, Xcom2ModuleScanCompleteness::Complete);
        assert!(result.observations.is_empty());
    }

    #[test]
    fn one_exact_kind_is_returned_without_classifier_policy() {
        let workspace = TestWorkspace::new("weak");
        workspace.file(
            "mods/Maybe/Config/XComEngine.ini",
            b"contents are never read",
        );

        let result = scan(workspace.path());

        assert_eq!(
            triples(&result),
            vec![(
                Xcom2ModuleEvidenceKind::EngineConfig,
                "mods/Maybe",
                "mods/Maybe/Config/XComEngine.ini"
            )]
        );
    }

    #[test]
    fn credible_exact_fixture_emits_all_kinds_in_canonical_order() {
        let workspace = TestWorkspace::new("credible");
        workspace.file("CovertOps.x2proj", b"descriptor");
        workspace.file("CovertOps.XComMod", b"descriptor");
        workspace.file(".scripts/build.ps1", b"script");
        workspace.directory(".scripts/X2ModBuildCommon");
        workspace.file("Config/XComEngine.ini", b"config");
        workspace.file("Src/CovertOps/Classes/Content.uc", b"source");

        let result = scan(workspace.path());

        assert_eq!(result.completeness, Xcom2ModuleScanCompleteness::Complete);
        assert_eq!(result.observations.len(), 6);
        assert!(result
            .observations
            .iter()
            .all(|item| item.module_root == "."));
        assert_eq!(
            result
                .observations
                .iter()
                .map(|item| (item.evidence_kind, item.relative_path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (Xcom2ModuleEvidenceKind::X2proj, "CovertOps.x2proj"),
                (Xcom2ModuleEvidenceKind::Xcommod, "CovertOps.XComMod"),
                (
                    Xcom2ModuleEvidenceKind::X2mbcScriptPair,
                    ".scripts/X2ModBuildCommon"
                ),
                (
                    Xcom2ModuleEvidenceKind::X2mbcScriptPair,
                    ".scripts/build.ps1"
                ),
                (
                    Xcom2ModuleEvidenceKind::EngineConfig,
                    "Config/XComEngine.ini"
                ),
                (
                    Xcom2ModuleEvidenceKind::UnrealscriptLayout,
                    "Src/CovertOps/Classes/Content.uc"
                ),
            ]
        );
    }

    #[test]
    fn wrong_case_and_empty_stems_are_rejected() {
        let workspace = TestWorkspace::new("case");
        for path in [
            "Mod.X2PROJ",
            "Mod.xcommod",
            ".x2proj",
            ".XComMod",
            "config/XComEngine.ini",
            "Config/xcomengine.ini",
            "src/Pkg/Classes/Good.uc",
            "Src/Pkg/classes/Good.uc",
            "Src/Pkg/Classes/Bad.UC",
            "Src/Pkg/Classes/.uc",
            ".Scripts/build.ps1",
            ".scripts/Build.ps1",
        ] {
            workspace.file(path, b"wrong case");
        }
        workspace.directory(".scripts/x2modbuildcommon");

        assert!(scan(workspace.path()).observations.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn internal_and_external_symlinks_are_neither_traversed_nor_evidence() {
        use std::os::unix::fs::symlink;

        let workspace = TestWorkspace::new("symlink");
        workspace.file("build/Internal.x2proj", b"ignored target");
        workspace.directory("build/internal-module");
        workspace.file("build/internal-module/Nested.XComMod", b"ignored target");
        let outside = TestWorkspace::new("outside");
        outside.file("External.XComMod", b"external target");
        outside.file("Config/XComEngine.ini", b"external target");

        symlink(
            workspace.path().join("build/Internal.x2proj"),
            workspace.path().join("Internal.x2proj"),
        )
        .expect("internal file symlink");
        symlink(
            workspace.path().join("build/internal-module"),
            workspace.path().join("linked-module"),
        )
        .expect("internal directory symlink");
        symlink(
            outside.path().join("External.XComMod"),
            workspace.path().join("External.XComMod"),
        )
        .expect("external file symlink");
        symlink(outside.path(), workspace.path().join("outside-module"))
            .expect("external directory symlink");

        let result = scan(workspace.path());

        assert_eq!(result.completeness, Xcom2ModuleScanCompleteness::Complete);
        assert!(result.observations.is_empty());
    }

    #[test]
    fn script_pair_requires_both_exact_regular_entry_types_and_reports_both_paths() {
        let workspace = TestWorkspace::new("pair");
        workspace.file("mods/incomplete/.scripts/build.ps1", b"script");
        workspace.file(
            "mods/wrong-type/.scripts/X2ModBuildCommon",
            b"must be a directory",
        );
        workspace.file("mods/wrong-type/.scripts/build.ps1", b"script");
        workspace.file("mods/complete/.scripts/build.ps1", b"script");
        workspace.directory("mods/complete/.scripts/X2ModBuildCommon");

        let result = scan(workspace.path());

        assert_eq!(
            triples(&result),
            vec![
                (
                    Xcom2ModuleEvidenceKind::X2mbcScriptPair,
                    "mods/complete",
                    "mods/complete/.scripts/X2ModBuildCommon"
                ),
                (
                    Xcom2ModuleEvidenceKind::X2mbcScriptPair,
                    "mods/complete",
                    "mods/complete/.scripts/build.ps1"
                ),
            ]
        );
    }

    #[test]
    fn nested_module_roots_remain_independent() {
        let workspace = TestWorkspace::new("nested");
        workspace.file("mods/outer/Outer.x2proj", b"outer");
        workspace.file("mods/outer/nested/Nested.XComMod", b"nested");
        workspace.file("mods/outer/nested/Config/XComEngine.ini", b"nested config");

        let result = scan(workspace.path());

        assert_eq!(
            triples(&result),
            vec![
                (
                    Xcom2ModuleEvidenceKind::X2proj,
                    "mods/outer",
                    "mods/outer/Outer.x2proj"
                ),
                (
                    Xcom2ModuleEvidenceKind::Xcommod,
                    "mods/outer/nested",
                    "mods/outer/nested/Nested.XComMod"
                ),
                (
                    Xcom2ModuleEvidenceKind::EngineConfig,
                    "mods/outer/nested",
                    "mods/outer/nested/Config/XComEngine.ini"
                ),
            ]
        );
    }

    #[test]
    fn configured_small_budget_and_depth_helpers_report_partial_issues() {
        let budget_workspace = TestWorkspace::new("budget");
        budget_workspace.file("one.txt", b"one");
        budget_workspace.file("two.txt", b"two");
        let budget_limits = Xcom2ModuleScanLimits {
            maximum_depth: 8,
            maximum_encountered_entries: 1,
        };
        let budget = scan_workspace_with_limits(
            budget_workspace.path(),
            request(budget_limits),
            budget_limits,
        )
        .expect("budget scan");
        assert_eq!(budget.completeness, Xcom2ModuleScanCompleteness::Partial);
        assert!(budget
            .issues
            .iter()
            .any(|issue| issue.kind == Xcom2ModuleScanIssueKind::EncounteredEntryLimitReached));

        let depth_workspace = TestWorkspace::new("depth");
        depth_workspace.file("one/two/TooDeep.x2proj", b"too deep");
        let depth_limits = Xcom2ModuleScanLimits {
            maximum_depth: 2,
            maximum_encountered_entries: 100,
        };
        let depth =
            scan_workspace_with_limits(depth_workspace.path(), request(depth_limits), depth_limits)
                .expect("depth scan");
        assert_eq!(depth.completeness, Xcom2ModuleScanCompleteness::Partial);
        assert!(depth.observations.is_empty());
        assert_eq!(
            depth.issues,
            vec![Xcom2ModuleScanIssue {
                kind: Xcom2ModuleScanIssueKind::DepthLimitReached,
                relative_path: "one/two".to_string(),
            }]
        );
    }

    #[test]
    fn invalid_limits_and_correlation_are_rejected() {
        let exact_json = serde_json::json!({
            "workspaceId": "workspace:authorized",
            "workspaceGeneration": 7,
            "scanId": "xcom2-module-scan:7",
            "scanGeneration": 3,
            "limits": {
                "maximumDepth": 8,
                "maximumEncounteredEntries": 20_000
            }
        });
        let decoded: Xcom2ModuleScanRequest =
            serde_json::from_value(exact_json.clone()).expect("exact request schema");
        assert_eq!(decoded, request(REQUIRED_LIMITS));
        let mut unexpected_root = exact_json;
        unexpected_root["root"] = serde_json::json!("/external");
        assert!(serde_json::from_value::<Xcom2ModuleScanRequest>(unexpected_root).is_err());

        let mut candidate = request(REQUIRED_LIMITS);
        candidate.limits.maximum_depth = 7;
        assert!(validate_request(&candidate).is_err());

        let mut candidate = request(REQUIRED_LIMITS);
        candidate.limits.maximum_encountered_entries = 19_999;
        assert!(validate_request(&candidate).is_err());

        for mutate in [
            |value: &mut Xcom2ModuleScanRequest| value.workspace_id.clear(),
            |value: &mut Xcom2ModuleScanRequest| value.scan_id = "../scan".to_string(),
            |value: &mut Xcom2ModuleScanRequest| value.workspace_generation = 0,
            |value: &mut Xcom2ModuleScanRequest| value.scan_generation = JS_MAX_SAFE_INTEGER + 1,
        ] {
            let mut candidate = request(REQUIRED_LIMITS);
            mutate(&mut candidate);
            assert!(validate_request(&candidate).is_err());
        }
    }

    #[test]
    fn output_is_deterministic_provider_neutral_and_read_only() {
        let workspace = TestWorkspace::new("deterministic");
        workspace.file("z/Zeta.x2proj", b"zeta descriptor bytes");
        workspace.file("a/Alpha.XComMod", b"alpha descriptor bytes");
        workspace.file("a/Config/XComEngine.ini", b"config bytes");
        workspace.file("node_modules/Hidden.x2proj", b"ignored bytes");
        let before = fixture_bytes(workspace.path());

        let first = scan(workspace.path());
        let second = scan(workspace.path());
        let after = fixture_bytes(workspace.path());

        assert_eq!(first, second);
        assert_eq!(before, after);
        let serialized = serde_json::to_value(&first).expect("serialize snapshot");
        assert_eq!(serialized["workspaceId"], "workspace:authorized");
        assert_eq!(serialized["workspaceGeneration"], 7);
        assert_eq!(serialized["scanId"], "xcom2-module-scan:7");
        assert_eq!(serialized["scanGeneration"], 3);
        assert!(serialized.get("provider").is_none());
        assert!(serialized.get("source").is_none());
        assert!(!serialized
            .to_string()
            .contains(workspace.path().to_string_lossy().as_ref()));
    }

    fn fixture_bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn visit(root: &Path, directory: &Path, result: &mut BTreeMap<String, Vec<u8>>) {
            let mut entries = fs::read_dir(directory)
                .expect("read fixture directory")
                .collect::<Result<Vec<_>, _>>()
                .expect("read fixture entries");
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path).expect("fixture metadata");
                if metadata.is_dir() {
                    visit(root, &path, result);
                } else if metadata.is_file() {
                    result.insert(
                        path.strip_prefix(root)
                            .expect("fixture relative path")
                            .to_string_lossy()
                            .replace('\\', "/"),
                        fs::read(path).expect("fixture bytes"),
                    );
                }
            }
        }

        let mut result = BTreeMap::new();
        visit(root, root, &mut result);
        result
    }
}
