//! Reviewed linear local rebases. Git owns history, conflict replay and restoration.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
const MAX_COMMITS: usize = 200;
const MAX_STATE: usize = 2 * 1024 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rebase {
    branch: String,
    original_head: String,
    onto: String,
    stopped_commit: Option<String>,
    completed: usize,
    total: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    upstream: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    activation: u64,
    revision: String,
    branch: String,
    upstream: String,
    original_head: String,
    onto: String,
    commits: Vec<Commit>,
    fingerprint: String,
}
fn bad() -> String {
    "This rebase state is incomplete or unsupported. Use the Git CLI.".into()
}
fn state_files(root: &Path, deadline: Instant) -> Result<Option<BTreeMap<String, String>>, String> {
    let path = git_path(root, "rebase-merge", deadline)?;
    if !path.try_exists().map_err(|_| bad())? {
        return Ok(None);
    }
    if fs::symlink_metadata(&path)
        .map_err(|_| bad())?
        .file_type()
        .is_symlink()
    {
        return Err(bad());
    }
    let mut files = BTreeMap::new();
    let mut bytes = 0;
    for entry in fs::read_dir(&path).map_err(|_| bad())? {
        if Instant::now() >= deadline || files.len() >= 64 {
            return Err(bad());
        }
        let entry = entry.map_err(|_| bad())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| bad())?;
        if !metadata.is_file() || metadata.len() > 512 * 1024 {
            return Err(bad());
        }
        let mut data = Vec::new();
        fs::File::open(entry.path())
            .map_err(|_| bad())?
            .take(512 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| bad())?;
        bytes += data.len();
        if bytes > MAX_STATE || data.len() > 512 * 1024 {
            return Err(bad());
        }
        files.insert(
            entry.file_name().into_string().map_err(|_| bad())?,
            String::from_utf8(data).map_err(|_| bad())?,
        );
    }
    Ok(Some(files))
}
fn picks(raw: &str) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    for row in raw
        .lines()
        .map(str::trim)
        .filter(|v| !v.is_empty() && !v.starts_with('#'))
    {
        if row == "noop" {
            continue;
        }
        let mut fields = row.split_whitespace();
        if fields.next() != Some("pick") {
            return Err(bad());
        }
        let id = fields.next().ok_or_else(bad)?;
        if !oid(id) || ids.len() >= MAX_COMMITS {
            return Err(bad());
        }
        ids.push(id.into());
    }
    Ok(ids)
}
pub(super) fn read_state(
    root: &Path,
    hash: &mut Sha256,
    deadline: Instant,
) -> Result<Option<Rebase>, String> {
    let Some(files) = state_files(root, deadline)? else {
        return Ok(None);
    };
    for (name, data) in &files {
        hash.update(name.as_bytes());
        hash.update([0]);
        hash.update(data.as_bytes());
        hash.update([0]);
    }
    // Never continue executable, merge-preserving, ref-updating or autostash sequences.
    if [
        "autostash",
        "update-refs",
        "rebase-merges",
        "reschedule-failed-exec",
    ]
    .iter()
    .any(|name| files.contains_key(*name))
    {
        return Err(bad());
    }
    let get = |name: &str| files.get(name).map(|v| v.trim()).ok_or_else(bad);
    let branch = get("head-name")?
        .strip_prefix("refs/heads/")
        .ok_or_else(bad)?;
    if branch.is_empty() || branch.len() > 1024 || branch.chars().any(char::is_control) {
        return Err(bad());
    }
    let original = get("orig-head")?;
    let onto = get("onto")?;
    if !oid(original) || !oid(onto) {
        return Err(bad());
    }
    let stopped = files.get("stopped-sha").map(|v| v.trim().to_owned());
    if stopped.as_deref().is_some_and(|v| !oid(v)) {
        return Err(bad());
    }
    let completed = get("msgnum")?.parse::<usize>().map_err(|_| bad())?;
    let total = get("end")?.parse::<usize>().map_err(|_| bad())?;
    if total == 0 || total > MAX_COMMITS || completed > total {
        return Err(bad());
    }
    picks(get("git-rebase-todo")?)?;
    picks(get("done")?)?;
    Ok(Some(Rebase {
        branch: branch.into(),
        original_head: original.into(),
        onto: onto.into(),
        stopped_commit: stopped,
        completed,
        total,
    }))
}
fn no_other_operation(root: &Path, allow_rebase: bool, deadline: Instant) -> Result<(), String> {
    for marker in [
        "MERGE_HEAD",
        "MERGE_AUTOSTASH",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "sequencer",
        "rebase-apply",
    ] {
        if marker == "CHERRY_PICK_HEAD" && allow_rebase {
            continue;
        }
        if git_path(root, marker, deadline)?
            .try_exists()
            .map_err(|_| bad())?
        {
            return Err(
                "Complete the other repository operation through the Git CLI first.".into(),
            );
        }
    }
    if !allow_rebase && git_path(root, "rebase-merge", deadline)?.exists() {
        return Err("A rebase is already active.".into());
    }
    Ok(())
}
fn root_only(root: &Path, before: &Snapshot) -> Result<(), String> {
    if root != Path::new(&before.repository_root) {
        return Err("Open the repository root before rebasing.".into());
    }
    Ok(())
}
pub(super) fn plan(
    root: &Path,
    before: &Snapshot,
    upstream: &str,
    deadline: Instant,
) -> Result<Plan, String> {
    root_only(root, before)?;
    no_other_operation(root, false, deadline)?;
    validate_branch_name(root, upstream, deadline)?;
    let branch = before
        .branch
        .as_deref()
        .ok_or("Select an attached local branch before rebasing.")?;
    let original = before
        .head
        .as_deref()
        .ok_or("Create an initial commit before rebasing.")?;
    if branch == upstream || !before.files.is_empty() {
        return Err("Choose a different local upstream and commit or move all saved changes and untracked files first.".into());
    }
    let target = before
        .local_branches
        .iter()
        .find(|v| v.name == upstream)
        .ok_or("The local upstream is unavailable. Refresh Git.")?;
    let bases = git(
        root,
        &["merge-base", "--all", original, &target.head],
        deadline,
    )?;
    if bases.lines().count() != 1 || !oid(bases.trim()) {
        return Err("Rebase needs one shared merge base. Use the Git CLI for this history.".into());
    }
    let range = format!("{}..{}", target.head, original);
    let merges = git(root, &["rev-list", "--count", "--merges", &range], deadline)?;
    if merges.trim() != "0" {
        return Err("Merge commits in the replay range require the Git CLI.".into());
    }
    let raw = git(
        root,
        &[
            "log",
            "--reverse",
            "--max-count=201",
            "--no-show-signature",
            "--no-notes",
            "--format=%H%x00%an%x00%aI%x00%s",
            "-z",
            &range,
        ],
        deadline,
    )?;
    let fields: Vec<_> = raw.split_terminator('\0').collect();
    if fields.len() % 4 != 0 || fields.len() / 4 > MAX_COMMITS {
        return Err("Rebase review supports at most 200 commits.".into());
    }
    let mut commits = Vec::new();
    for row in fields.chunks_exact(4) {
        if !oid(row[0]) || row[1..].iter().any(|v| v.len() > 4096) {
            return Err(bad());
        }
        commits.push(Commit {
            id: row[0].into(),
            author: row[1].into(),
            date: row[2].into(),
            subject: row[3].into(),
        });
    }
    let mut hash = Sha256::new();
    for value in [&before.revision, branch, upstream, original, &target.head] {
        hash.update(value.as_bytes());
        hash.update([0]);
    }
    for commit in &commits {
        hash.update(commit.id.as_bytes());
        hash.update([0]);
    }
    Ok(Plan {
        activation: before.activation,
        revision: before.revision.clone(),
        branch: branch.into(),
        upstream: upstream.into(),
        original_head: original.into(),
        onto: target.head.clone(),
        commits,
        fingerprint: format!("{:x}", hash.finalize()),
    })
}
// Prevent an added tracked path from replacing an existing ignored/untracked input.
fn protect_added(
    root: &Path,
    onto: Option<&str>,
    commits: &[String],
    deadline: Instant,
) -> Result<(), String> {
    let mut candidates = BTreeSet::new();
    let mut add = |raw: String| -> Result<(), String> {
        for path in raw.split_terminator('\0') {
            relative(path)?;
            candidates.insert(path.to_owned());
            if candidates.len() > MAX_FILES {
                return Err("Too many added rebase paths. Use the Git CLI.".into());
            }
        }
        Ok(())
    };
    if let Some(onto) = onto {
        add(git(
            root,
            &[
                "diff",
                "--no-renames",
                "--diff-filter=A",
                "--name-only",
                "-z",
                "HEAD",
                onto,
            ],
            deadline,
        )?)?;
    }
    for commit in commits {
        add(git(
            root,
            &[
                "diff-tree",
                "--root",
                "--no-renames",
                "--diff-filter=A",
                "--no-commit-id",
                "--name-only",
                "-r",
                "-z",
                commit,
            ],
            deadline,
        )?)?;
    }
    let raw = git(root, &["ls-files", "-z"], deadline)?;
    let tracked: BTreeSet<_> = raw.split_terminator('\0').collect();
    for path in candidates {
        if tracked.contains(path.as_str()) {
            continue;
        }
        if fs::symlink_metadata(root.join(&path)).is_ok() {
            return Err("A rebase input would replace an existing untracked or ignored path. Move it explicitly first.".into());
        }
        let mut parent = root.join(&path);
        while let Some(next) = parent.parent() {
            if next == root {
                break;
            }
            if let Ok(meta) = fs::symlink_metadata(next) {
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Err(
                        "Rebase cannot replace this existing parent path. Use the Git CLI.".into(),
                    );
                }
            }
            parent = next.to_path_buf();
        }
    }
    Ok(())
}
fn run(root: &Path, args: &[&str], deadline: Instant) -> Result<std::process::ExitStatus, String> {
    let mut command = git_command(root, args);
    command
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "false");
    Ok(git_command_outcome(&mut command, deadline)?.0)
}
fn result(root: &Path, exit: std::process::ExitStatus, deadline: Instant) -> Result<(), String> {
    if exit.success() {
        return Ok(());
    }
    if exit.code() == Some(1) {
        if let Some(state) = read_state(root, &mut Sha256::new(), deadline)? {
            if state.stopped_commit.is_some() {
                return Ok(());
            }
        }
    }
    Err(FAILED.into())
}
pub(super) fn start(
    root: &Path,
    before: &Snapshot,
    upstream: &str,
    expected: &str,
    deadline: Instant,
) -> Result<(), String> {
    let plan = plan(root, before, upstream, deadline)?;
    if plan.fingerprint != expected {
        return Err(STALE.into());
    }
    protect_added(
        root,
        Some(&plan.onto),
        &plan
            .commits
            .iter()
            .map(|v| v.id.clone())
            .collect::<Vec<_>>(),
        deadline,
    )?;
    let reference = format!("refs/heads/{upstream}");
    let exit = run(
        root,
        &[
            "-c",
            "submodule.recurse=false",
            "-c",
            "rebase.instructionFormat=%s",
            "-c",
            "rebase.abbreviateCommands=false",
            "rebase",
            "--merge",
            "--no-autostash",
            "--no-update-refs",
            "--no-rebase-merges",
            "--no-autosquash",
            "--no-fork-point",
            "--reapply-cherry-picks",
            "--empty=stop",
            "--keep-empty",
            "--no-rerere-autoupdate",
            "--",
            &reference,
        ],
        deadline,
    )?;
    result(root, exit, deadline)
}
pub(super) fn resume(
    root: &Path,
    before: &Snapshot,
    action: &str,
    deadline: Instant,
) -> Result<(), String> {
    root_only(root, before)?;
    no_other_operation(root, true, deadline)?;
    let state = before
        .rebase
        .as_ref()
        .ok_or("There is no supported rebase to resume. Refresh Git.")?;
    let cherry = git_path(root, "CHERRY_PICK_HEAD", deadline)?;
    if cherry.exists() {
        let mut value = String::new();
        fs::File::open(cherry)
            .map_err(|_| bad())?
            .take(130)
            .read_to_string(&mut value)
            .map_err(|_| bad())?;
        if Some(value.trim()) != state.stopped_commit.as_deref() {
            return Err(bad());
        }
    }
    if action == "--continue" && before.files.iter().any(|file| file.conflict) {
        return Err("Resolve and stage every conflict before continuing the rebase.".into());
    }
    if action != "--abort" {
        let files = state_files(root, deadline)?.ok_or_else(bad)?;
        let remaining = picks(files.get("git-rebase-todo").ok_or_else(bad)?)?;
        protect_added(root, None, &remaining, deadline)?;
        if state.stopped_commit.is_none() {
            return Err(bad());
        }
    }
    let exit = run(
        root,
        &["-c", "submodule.recurse=false", "rebase", action],
        deadline,
    )?;
    result(root, exit, deadline)
}
#[tauri::command]
pub async fn git_workspace_rebase_plan(request: PlanRequest) -> Result<Plan, String> {
    trusted(request.trusted)?;
    super::super::blocking::run(move || {
        let root =
            with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        let deadline = Instant::now() + READ_TIMEOUT;
        let before = snapshot(&root, request.activation, deadline)?;
        require_revision(&before, &request.revision)?;
        let value = plan(&root, &before, &request.upstream, deadline)?;
        require_revision(
            &snapshot(&root, request.activation, deadline)?,
            &request.revision,
        )?;
        with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        Ok(value)
    })
    .await
}
