//! Explicit local Git workflow. Git owns repository and index interpretation.
use super::workspace_registry::{active_workspace_generation, with_root_activation};
use crate::workspace::{resolve_new_path_in_root, workspace_root};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

const MAX_FILES: usize = 2000;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const STALE: &str = "Git state changed. Refresh and review the current changes before continuing.";
const FAILED: &str = "Git could not complete this operation. It may have changed repository state; refresh before retrying. Check repository configuration and Git hooks if the failure persists.";
static MUTATING: AtomicBool = AtomicBool::new(false);
pub(crate) fn mutation_in_progress() -> bool {
    MUTATING.load(Ordering::Acquire)
}
struct MutationGuard;
impl MutationGuard {
    fn acquire() -> Result<Self, String> {
        MUTATING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "Another Git mutation is still running.".into())
    }
}
impl Drop for MutationGuard {
    fn drop(&mut self) {
        MUTATING.store(false, Ordering::Release);
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    workspace_path: String,
    trusted: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    path: Option<String>,
    staged: bool,
}
#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Action {
    Stage {
        path: String,
        #[serde(rename = "savedFingerprint")]
        saved_fingerprint: String,
    },
    Unstage {
        path: String,
    },
    Commit {
        message: String,
        #[serde(rename = "authorName")]
        author_name: String,
        #[serde(rename = "authorEmail")]
        author_email: String,
    },
    CreateBranch {
        name: String,
    },
    SwitchBranch {
        name: String,
    },
    MergeBranch {
        name: String,
    },
    AbortMerge,
    StartRebase {
        upstream: String,
        #[serde(rename = "planFingerprint")]
        plan_fingerprint: String,
    },
    ContinueRebase,
    SkipRebase,
    AbortRebase,
    RenameBranch {
        #[serde(rename = "oldName")]
        old_name: String,
        name: String,
    },
    DeleteBranch {
        name: String,
        #[serde(rename = "planFingerprint")]
        plan_fingerprint: String,
        confirmation: String,
        force: bool,
    },
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    #[serde(flatten)]
    action: Action,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_path: Option<String>,
    index: String,
    worktree: String,
    staged: bool,
    unstaged: bool,
    conflict: bool,
    directory: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    id: String,
    author: String,
    date: String,
    subject: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    activation: u64,
    revision: String,
    branch: Option<String>,
    local_branches: Vec<LocalBranch>,
    head: Option<String>,
    repository_root: String,
    files: Vec<FileStatus>,
    commits: Vec<Commit>,
    author_name: String,
    author_email: String,
    commit_unavailable_reason: Option<String>,
    merge_heads: Vec<String>,
    rebase: Option<rebase::Rebase>,
}
#[derive(Debug, Serialize)]
struct LocalBranch {
    name: String,
    head: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    revision: String,
    staged: bool,
    path: Option<String>,
    text: String,
    saved_fingerprint: Option<String>,
}

fn git_outcome(
    root: &Path,
    args: &[&str],
    deadline: Instant,
) -> Result<(std::process::ExitStatus, String), String> {
    let mut command = git_command(root, args);
    git_command_outcome(&mut command, deadline)
}
fn git_command(root: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .args([
            "--no-pager",
            "--no-optional-locks",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "maintenance.auto=false",
            "-c",
            "gc.auto=0",
        ])
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0");
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_CONFIG",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_COMMITTER_DATE",
    ] {
        command.env_remove(name);
    }
    command
}
fn git_command_outcome(
    command: &mut Command,
    deadline: Instant,
) -> Result<(std::process::ExitStatus, String), String> {
    let output = super::git_diff_review::process::capture_output(command, deadline)
        .map_err(|_| FAILED.to_owned())?;
    let text = String::from_utf8(output.stdout).map_err(|_| {
        "Git returned non-UTF-8 output; this repository is not supported by this view.".to_owned()
    })?;
    Ok((output.status, text))
}
fn git(root: &Path, args: &[&str], deadline: Instant) -> Result<String, String> {
    let (status, text) = git_outcome(root, args, deadline)?;
    if status.success() {
        Ok(text)
    } else {
        Err(FAILED.into())
    }
}
fn optional_git(root: &Path, args: &[&str], deadline: Instant) -> Result<Option<String>, String> {
    let (status, text) = git_outcome(root, args, deadline)?;
    if status.success() {
        Ok(Some(text))
    } else if status.code() == Some(1) && text.is_empty() {
        Ok(None)
    } else {
        Err(FAILED.into())
    }
}
fn trusted(value: bool) -> Result<(), String> {
    if value {
        Ok(())
    } else {
        Err("Trust this repository's Git hooks and filters before using Git actions.".into())
    }
}
fn current_root(expected: &str, activation: u64) -> Result<PathBuf, String> {
    let root = workspace_root()?;
    validate_activation(&root, active_workspace_generation(), expected, activation)?;
    Ok(root)
}
fn validate_activation(
    root: &Path,
    actual: u64,
    expected: &str,
    activation: u64,
) -> Result<(), String> {
    if root != Path::new(expected) || actual != activation {
        return Err("The workspace changed. Refresh Git in the current workspace.".into());
    }
    Ok(())
}
fn line(value: &str) -> &str {
    value.strip_suffix('\n').unwrap_or(value)
}
fn oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn git_path(root: &Path, name: &str, deadline: Instant) -> Result<PathBuf, String> {
    let output = git(root, &["rev-parse", "--git-path", name], deadline)?;
    let path = Path::new(line(&output));
    Ok(if path.is_absolute() {
        path.to_owned()
    } else {
        root.join(path)
    })
}
fn relative(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains(['\0', '\\'])
        || Path::new(path).is_absolute()
        || path
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err("Git returned an unsupported workspace-relative path.".into());
    }
    Ok(())
}
fn allowed_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    relative(path)?;
    let parent = Path::new(path).parent().unwrap_or(Path::new(""));
    resolve_new_path_in_root(root, parent)?;
    Ok(root.join(path))
}
fn digest_file(hash: &mut Sha256, path: &Path, maximum: u64) -> Result<(), String> {
    let mut file =
        fs::File::open(path).map_err(|_| "The saved Git input cannot be read.".to_owned())?;
    if file.metadata().map_err(|_| FAILED.to_owned())?.len() > maximum {
        return Err("The saved Git input exceeds the review size limit.".into());
    }
    let mut total = 0u64;
    let mut chunk = [0u8; 65536];
    loop {
        let size = file.read(&mut chunk).map_err(|_| FAILED.to_owned())?;
        if size == 0 {
            break;
        }
        total += size as u64;
        if total > maximum {
            return Err("The saved Git input exceeds the review size limit.".into());
        }
        hash.update(&chunk[..size]);
    }
    Ok(())
}
fn fingerprint(root: &Path, file: &FileStatus) -> Result<String, String> {
    let mut hash = Sha256::new();
    for path in std::iter::once(file.path.as_str()).chain(file.original_path.as_deref()) {
        hash.update(path.as_bytes());
        hash.update([0]);
        let resolved = allowed_path(root, path)?;
        match fs::symlink_metadata(&resolved) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => hash.update(b"missing"),
            Err(_) => return Err("The saved Git input cannot be inspected.".into()),
            Ok(metadata) if metadata.is_symlink() => {
                hash.update(b"link");
                let target = fs::read_link(resolved).map_err(|_| FAILED.to_owned())?;
                hash.update(
                    target
                        .to_str()
                        .ok_or("Non-UTF-8 symbolic-link targets need the Git CLI.")?
                        .as_bytes(),
                );
            }
            Ok(metadata) if metadata.is_file() => {
                hash.update(b"file");
                hash.update([metadata.permissions().readonly() as u8]);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    hash.update((metadata.permissions().mode() & 0o111).to_le_bytes());
                }
                digest_file(&mut hash, &resolved, 128 * 1024 * 1024)?;
            }
            Ok(_) => {
                return Err("Directory and submodule entries need a separate Git workflow.".into())
            }
        }
        hash.update([0]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn status_files(raw: &str, prefix: &str, root: &Path) -> Result<Vec<FileStatus>, String> {
    if !raw.is_empty() && !raw.ends_with('\0') {
        return Err("Git status output is incomplete.".into());
    }
    let mut records = raw.split_terminator('\0');
    let mut files: Vec<FileStatus> = Vec::new();
    while let Some(record) = records.next() {
        let bytes = record.as_bytes();
        if bytes.len() < 4
            || bytes[2] != b' '
            || !bytes[..2].iter().all(|b| b" MADRCU?!T".contains(b))
        {
            return Err("Git status output is malformed.".into());
        }
        let path = record[3..]
            .strip_prefix(prefix)
            .ok_or("Git returned a path outside this workspace.")?;
        relative(path)?;
        let original_path = if bytes[..2].iter().any(|b| matches!(b, b'R' | b'C')) {
            let original = records.next().ok_or("Git rename output is incomplete.")?;
            Some(
                original
                    .strip_prefix(prefix)
                    .ok_or(
                        "A Git rename crosses this workspace boundary. Open the repository root.",
                    )?
                    .to_owned(),
            )
        } else {
            None
        };
        if let Some(original) = &original_path {
            relative(original)?;
        }
        let file = FileStatus {
            path: path.to_owned(),
            original_path,
            index: (bytes[0] as char).to_string(),
            worktree: (bytes[1] as char).to_string(),
            staged: bytes[0] != b' ' && bytes[0] != b'?',
            unstaged: bytes[1] != b' ',
            conflict: bytes[..2].contains(&b'U') || matches!(&bytes[..2], b"AA" | b"DD"),
            directory: fs::symlink_metadata(root.join(path))
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false),
        };
        if let Some(previous) = files.iter_mut().find(|previous| previous.path == file.path) {
            // Git reports staged deletion and its recreated untracked path separately.
            if previous.index != " "
                && previous.index != "?"
                && file.index != " "
                && file.index != "?"
            {
                return Err("Git returned ambiguous duplicate index entries.".into());
            }
            if file.staged {
                previous.index = file.index;
                previous.staged = true;
            }
            if file.unstaged {
                previous.worktree = file.worktree;
                previous.unstaged = true;
            }
            previous.conflict |= file.conflict;
            previous.directory |= file.directory;
            if file.original_path.is_some() {
                previous.original_path = file.original_path;
            }
        } else {
            files.push(file);
        }
        if files.len() > MAX_FILES {
            return Err(
                "Git status exceeds 2,000 changed paths. Use a smaller workspace or the Git CLI."
                    .into(),
            );
        }
    }
    Ok(files)
}
fn snapshot(root: &Path, activation: u64, deadline: Instant) -> Result<Snapshot, String> {
    let top = git(root, &["rev-parse", "--show-toplevel"], deadline)?;
    let repository = PathBuf::from(line(&top))
        .canonicalize()
        .map_err(|_| FAILED.to_owned())?;
    if !root.starts_with(&repository) {
        return Err("Git does not own this workspace path.".into());
    }
    let prefix = git(root, &["rev-parse", "--show-prefix"], deadline)?;
    let raw = git(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
            "--",
            ".",
        ],
        deadline,
    )?;
    let files = status_files(&raw, line(&prefix), root)?;
    let head = optional_git(
        root,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        deadline,
    )?
    .map(|value| line(&value).to_owned());
    if head.as_ref().is_some_and(|head| !oid(head)) {
        return Err("Git returned an invalid HEAD identity.".into());
    }
    let branch = optional_git(
        root,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        deadline,
    )?
    .map(|value| line(&value).to_owned());
    let branch_refs = git(
        root,
        &[
            "for-each-ref",
            "--count=2001",
            "--sort=refname",
            "--format=%(refname)%00%(objectname)",
            "refs/heads/",
        ],
        deadline,
    )?;
    let mut local_branches = Vec::new();
    for record in branch_refs.lines() {
        let (name, head) = record.split_once('\0').ok_or(FAILED)?;
        let name = name.strip_prefix("refs/heads/").ok_or(FAILED)?;
        if name.is_empty() || !oid(head) {
            return Err(FAILED.into());
        }
        local_branches.push(LocalBranch {
            name: name.into(),
            head: head.into(),
        });
    }
    if local_branches.len() > MAX_FILES {
        return Err("Git has more than 2,000 local branches. Use the Git CLI.".into());
    }
    let mut hash = Sha256::new();
    hash.update(branch_refs.as_bytes());
    hash.update([0]);
    hash.update(head.as_deref().unwrap_or("unborn").as_bytes());
    hash.update([0]);
    hash.update(branch.as_deref().unwrap_or("detached").as_bytes());
    hash.update([0]);
    hash.update(raw.as_bytes());
    let index = git_path(root, "index", deadline)?;
    if index.exists() {
        hash.update(b"index");
        digest_file(&mut hash, &index, 64 * 1024 * 1024)?;
    } else {
        hash.update(b"no-index");
    }
    let mut commit_unavailable_reason = if files.iter().any(|f| f.conflict) {
        Some("Resolve the merge conflicts before committing.".into())
    } else {
        None
    };
    let staged = if head.is_some() {
        git(
            &repository,
            &[
                "diff",
                "--cached",
                "--name-only",
                "--no-relative",
                "--no-renames",
                "-z",
            ],
            deadline,
        )?
    } else {
        git(&repository, &["ls-files", "--cached", "-z"], deadline)?
    };
    if staged
        .split_terminator('\0')
        .any(|path| !path.starts_with(line(&prefix)))
    {
        commit_unavailable_reason = Some("Staged files exist outside this workspace. Open the repository root to review and commit them.".into());
    }
    let merge_heads = merge::heads(root, deadline)?;
    let rebase = rebase::read_state(root, &mut hash, deadline)?;
    if !merge_heads.is_empty() || rebase.is_some() {
        // Abort can discard saved resolutions. Bind all visible saved changes, not
        // merely their status letters, before admitting a reviewed operation.
        merge::hash_saved_changes(root, &files, &mut hash, deadline)?;
    }
    for marker in [
        "MERGE_HEAD",
        "MERGE_MSG",
        "ORIG_HEAD",
        "MERGE_AUTOSTASH",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ] {
        let path = git_path(root, marker, deadline)?;
        if path.exists() {
            hash.update(marker.as_bytes());
            if path.is_file() {
                digest_file(&mut hash, &path, 64 * 1024)?;
            }
            if matches!(
                marker,
                "CHERRY_PICK_HEAD"
                    | "REVERT_HEAD"
                    | "rebase-merge"
                    | "rebase-apply"
                    | "sequencer"
                    | "MERGE_AUTOSTASH"
            ) {
                commit_unavailable_reason = Some("A rebase, sequencer or autostash operation is active. Complete it through the Git CLI.".into());
            }
        }
    }
    if !merge_heads.is_empty() && (merge_heads.len() != 1 || root != repository) {
        commit_unavailable_reason = Some("Open the repository root to complete a single-head merge; other merge layouts require the Git CLI.".into());
    }
    let mut commits = Vec::new();
    if head.is_some() {
        let log = git(
            root,
            &[
                "log",
                "-50",
                "--no-show-signature",
                "--no-notes",
                "--format=%H%x00%an%x00%aI%x00%s",
                "-z",
                "--",
                ".",
            ],
            deadline,
        )?;
        commits = parse_commits(&log, 50)?;
    }
    let author_name = optional_git(root, &["config", "--get", "user.name"], deadline)?
        .map(|value| line(&value).to_owned())
        .unwrap_or_default();
    let author_email = optional_git(root, &["config", "--get", "user.email"], deadline)?
        .map(|value| line(&value).to_owned())
        .unwrap_or_default();
    if Instant::now() >= deadline {
        return Err(FAILED.into());
    }
    Ok(Snapshot {
        activation,
        revision: format!("{:x}", hash.finalize()),
        branch,
        local_branches,
        head,
        repository_root: repository.to_string_lossy().into_owned(),
        files,
        commits,
        author_name,
        author_email,
        commit_unavailable_reason,
        merge_heads,
        rebase,
    })
}
fn parse_commits(raw: &str, maximum: usize) -> Result<Vec<Commit>, String> {
    let fields: Vec<_> = raw.split_terminator('\0').collect();
    if fields.len() % 4 != 0 || fields.len() / 4 > maximum {
        return Err("Git history output is malformed or exceeds its page bound.".into());
    }
    fields
        .chunks_exact(4)
        .map(|fields| {
            if !oid(fields[0])
                || fields[1..]
                    .iter()
                    .any(|value| value.len() > 4096 || value.contains('\0'))
            {
                return Err("Git history has an invalid commit identity or metadata.".into());
            }
            Ok(Commit {
                id: fields[0].into(),
                author: fields[1].into(),
                date: fields[2].into(),
                subject: fields[3].into(),
            })
        })
        .collect()
}
fn require_revision(snapshot: &Snapshot, revision: &str) -> Result<(), String> {
    if snapshot.revision == revision {
        Ok(())
    } else {
        Err(STALE.into())
    }
}

#[tauri::command]
pub async fn git_workspace_status(request: Request) -> Result<Snapshot, String> {
    trusted(request.trusted)?;
    let activation = active_workspace_generation();
    super::blocking::run(move || {
        let root = with_root_activation(|| current_root(&request.workspace_path, activation))?;
        let result = snapshot(&root, activation, Instant::now() + READ_TIMEOUT);
        with_root_activation(|| current_root(&request.workspace_path, activation))?;
        result
    })
    .await
}
#[tauri::command]
pub async fn git_workspace_review(request: ReviewRequest) -> Result<Review, String> {
    trusted(request.trusted)?;
    super::blocking::run(move || {
        let root =
            with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        let deadline = Instant::now() + READ_TIMEOUT;
        let before = snapshot(&root, request.activation, deadline)?;
        require_revision(&before, &request.revision)?;
        let (text, saved_fingerprint) = review_in_root(&root, &before, &request, deadline)?;
        if let (Some(path), Some(expected)) =
            (request.path.as_deref(), saved_fingerprint.as_deref())
        {
            let file = before
                .files
                .iter()
                .find(|file| file.path == path)
                .ok_or(STALE)?;
            if fingerprint(&root, file)? != expected {
                return Err(
                    "The saved file changed during review. Refresh and review it again.".into(),
                );
            }
        }
        require_revision(
            &snapshot(&root, request.activation, deadline)?,
            &request.revision,
        )?;
        with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        Ok(Review {
            revision: request.revision,
            staged: request.staged,
            path: request.path,
            text,
            saved_fingerprint,
        })
    })
    .await
}
fn review_in_root(
    root: &Path,
    before: &Snapshot,
    request: &ReviewRequest,
    deadline: Instant,
) -> Result<(String, Option<String>), String> {
    let file = request
        .path
        .as_deref()
        .map(|path| {
            before
                .files
                .iter()
                .find(|file| file.path == path)
                .ok_or_else(|| STALE.to_owned())
        })
        .transpose()?;
    if request.path.is_none() && !request.staged {
        return Err("Select one saved file for working-tree review.".into());
    }
    if let Some(file) = file {
        allowed_path(root, &file.path)?;
        if file.directory {
            return Err("Directory and submodule entries need a separate Git workflow.".into());
        }
    }
    let saved = if !request.staged {
        Some(fingerprint(root, file.ok_or(STALE)?)?)
    } else {
        None
    };
    if let Some(file) = file.filter(|file| file.worktree == "?") {
        let resolved = allowed_path(root, &file.path)?;
        let metadata = fs::symlink_metadata(&resolved).map_err(|_| FAILED.to_owned())?;
        let text = if metadata.is_symlink() {
            format!(
                "New symbolic link:\n{}",
                fs::read_link(&resolved)
                    .map_err(|_| FAILED.to_owned())?
                    .to_string_lossy()
            )
        } else if metadata.len() <= 512 * 1024 {
            match fs::read(&resolved)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
            {
                Some(text) => format!("Untracked saved file:\n{text}"),
                None => format!("Binary untracked file ({} bytes).", metadata.len()),
            }
        } else {
            format!(
                "Untracked file ({} bytes); content exceeds the display limit.",
                metadata.len()
            )
        };
        return Ok((text, saved));
    }
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--unified=3",
    ];
    if request.staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(request.path.as_deref().unwrap_or("."));
    if let Some(original) = file.and_then(|file| file.original_path.as_deref()) {
        args.push(original);
    }
    let text = git(root, &args, deadline)?;
    if text.is_empty() {
        return Err("No changes are available for this review.".into());
    }
    Ok((text, saved))
}
static MESSAGE_ID: AtomicU64 = AtomicU64::new(0);
struct MessageFile(PathBuf);
impl Drop for MessageFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn private_input_file(text: &str) -> Result<MessageFile, String> {
    use std::io::Write;
    for _ in 0..10 {
        let path = std::env::temp_dir().join(format!(
            "ide-git-message-{}-{}-{}",
            std::process::id(),
            crate::app_config::now_rfc3339().replace(':', ""),
            MESSAGE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                let owned = MessageFile(path);
                file.write_all(text.as_bytes())
                    .map_err(|_| FAILED.to_owned())?;
                return Ok(owned);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(FAILED.into()),
        }
    }
    Err(FAILED.into())
}
fn identity(name: &str, email: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || email.trim().is_empty()
        || name.len() > 256
        || email.len() > 320
        || name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '<' | '>'))
        || email
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '<' | '>'))
    {
        return Err(
            "Enter a Git author name and email without control characters or angle brackets."
                .into(),
        );
    }
    Ok(())
}
fn validate_branch_name(root: &Path, name: &str, deadline: Instant) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 1024
        || name.starts_with('-')
        || name.chars().any(char::is_control)
    {
        return Err("Enter a valid local Git branch name.".into());
    }
    let full_name = format!("refs/heads/{name}");
    let (valid, _) = git_outcome(root, &["check-ref-format", &full_name], deadline)?;
    if !valid.success() {
        return Err("Enter a valid local Git branch name.".into());
    }
    Ok(())
}
fn mutate_in_root(
    root: &Path,
    activation: u64,
    request: &MutationRequest,
    deadline: Instant,
) -> Result<Snapshot, String> {
    let before = snapshot(root, activation, deadline)?;
    require_revision(&before, &request.revision)?;
    if before.rebase.is_some()
        && !matches!(
            request.action,
            Action::Stage { .. }
                | Action::Unstage { .. }
                | Action::ContinueRebase
                | Action::SkipRebase
                | Action::AbortRebase
        )
    {
        return Err(
            "Complete or abort the active rebase before changing local references or committing."
                .into(),
        );
    }
    match &request.action {
        Action::DeleteBranch {
            name,
            plan_fingerprint,
            confirmation,
            force,
        } => branch_delete::delete(
            root,
            &before,
            name,
            plan_fingerprint,
            confirmation,
            *force,
            deadline,
        )?,
        Action::StartRebase {
            upstream,
            plan_fingerprint,
        } => rebase::start(root, &before, upstream, plan_fingerprint, deadline)?,
        Action::ContinueRebase => rebase::resume(root, &before, "--continue", deadline)?,
        Action::SkipRebase => rebase::resume(root, &before, "--skip", deadline)?,
        Action::AbortRebase => rebase::resume(root, &before, "--abort", deadline)?,
        Action::MergeBranch { name } => merge::start(root, &before, name, deadline)?,
        Action::AbortMerge => merge::abort(root, &before, deadline)?,
        Action::CreateBranch { name } | Action::SwitchBranch { name } => {
            validate_branch_name(root, name, deadline)?;
            let head = before
                .head
                .as_deref()
                .ok_or("Create the initial commit before using local branches.")?;
            if matches!(request.action, Action::CreateBranch { .. }) {
                git(root, &["branch", "--no-track", "--", name, head], deadline)?;
            } else {
                if root != Path::new(&before.repository_root) {
                    return Err("Open the repository root before switching branches; a switch can change files outside this workspace.".into());
                }
                if !before.merge_heads.is_empty() {
                    return Err(
                        "Complete or abort the current merge before switching branches.".into(),
                    );
                }
                if let Some(reason) = before.commit_unavailable_reason {
                    return Err(reason);
                }
                if !before
                    .local_branches
                    .iter()
                    .any(|branch| branch.name == *name)
                {
                    return Err("The local branch is no longer available. Refresh Git.".into());
                }
                git(
                    root,
                    &[
                        "switch",
                        "--no-guess",
                        "--no-recurse-submodules",
                        "--",
                        name,
                    ],
                    deadline,
                )?;
            }
        }
        Action::RenameBranch { old_name, name } => {
            validate_branch_name(root, old_name, deadline)?;
            validate_branch_name(root, name, deadline)?;
            if !before
                .local_branches
                .iter()
                .any(|branch| branch.name == *old_name)
            {
                return Err("The local branch is no longer available. Refresh Git.".into());
            }
            if before
                .local_branches
                .iter()
                .any(|branch| branch.name == *name)
            {
                return Err("A local branch already uses that name. Choose another name.".into());
            }
            // Git can rename a branch checked out in a linked worktree and update that
            // worktree's HEAD. Keep this UI action confined to the active repository view.
            let worktrees = git(root, &["worktree", "list", "--porcelain", "-z"], deadline)?;
            let branch_field = format!("branch refs/heads/{old_name}");
            for record in worktrees.split("\0\0") {
                let fields: Vec<_> = record.split('\0').collect();
                if fields.contains(&branch_field.as_str()) {
                    let path = fields
                        .first()
                        .and_then(|field| field.strip_prefix("worktree "))
                        .ok_or("Git returned malformed worktree information.")?;
                    if Path::new(path) != Path::new(&before.repository_root) {
                        return Err("Open the worktree that has this branch checked out before renaming it.".into());
                    }
                }
            }
            git(root, &["branch", "--move", "--", old_name, name], deadline)?;
        }
        Action::Stage { path, .. } | Action::Unstage { path } => {
            let file = before
                .files
                .iter()
                .find(|file| file.path == *path)
                .ok_or(STALE)?;
            allowed_path(root, path)?;
            if file.directory {
                return Err("Directory and submodule entries need a separate Git workflow.".into());
            }
            let mut paths = vec![path.as_str()];
            if let Some(original) = file.original_path.as_deref() {
                allowed_path(root, original)?;
                if matches!(request.action, Action::Unstage { .. }) && file.index == "R"
                    || matches!(request.action, Action::Stage { .. }) && file.worktree == "R"
                {
                    paths.push(original);
                }
            }
            match &request.action {
                Action::Stage {
                    saved_fingerprint, ..
                } => {
                    if fingerprint(root, file)? != *saved_fingerprint {
                        return Err(
                            "The saved file changed after review. Refresh and review it again."
                                .into(),
                        );
                    }
                    let mut args = vec!["add", "--"];
                    args.extend(paths);
                    git(root, &args, deadline)?;
                    if fingerprint(root, file)? != *saved_fingerprint {
                        return Err("The saved file changed during staging. Git may have staged it; refresh and review the current index.".into());
                    }
                }
                Action::Unstage { .. } => {
                    let mut args = if before.head.is_some() {
                        vec!["restore", "--staged", "--source=HEAD", "--"]
                    } else {
                        vec!["rm", "--cached", "--force", "--"]
                    };
                    args.extend(paths);
                    git(root, &args, deadline)?;
                }
                _ => unreachable!(),
            }
        }
        Action::Commit {
            message,
            author_name,
            author_email,
        } => {
            if let Some(reason) = before.commit_unavailable_reason {
                return Err(reason);
            }
            if !before.files.iter().any(|file| file.staged) && before.merge_heads.is_empty() {
                return Err("There are no staged changes to commit in this workspace.".into());
            }
            identity(author_name, author_email)?;
            if message.trim().is_empty() || message.len() > 65536 || message.contains('\0') {
                return Err("Enter a nonempty Git commit message of at most 64 KiB.".into());
            }
            let file = private_input_file(message)?;
            let name = format!("user.name={author_name}");
            let email = format!("user.email={author_email}");
            git(
                root,
                &[
                    "-c",
                    &name,
                    "-c",
                    &email,
                    "commit",
                    "--quiet",
                    "--cleanup=verbatim",
                    "--file",
                    file.0.to_str().ok_or(FAILED)?,
                ],
                deadline,
            )?;
        }
    }
    snapshot(root, activation, deadline)
}
#[tauri::command]
pub async fn git_workspace_mutate(request: MutationRequest) -> Result<Snapshot, String> {
    trusted(request.trusted)?;
    let guard = MutationGuard::acquire()?;
    super::blocking::run(move || {
        let _guard = guard;
        with_root_activation(|| {
            let root = current_root(&request.workspace_path, request.activation)?;
            mutate_in_root(
                &root,
                request.activation,
                &request,
                Instant::now() + WRITE_TIMEOUT,
            )
        })
    })
    .await
}
pub mod blame;
mod merge;
pub mod rebase;
#[cfg(all(test, unix))]
mod tests;

pub mod history;

pub mod branch_delete;
