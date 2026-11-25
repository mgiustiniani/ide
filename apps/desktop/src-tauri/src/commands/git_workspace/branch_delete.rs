//! Reviewed local branch deletion. Git owns reference, reflog and branch configuration changes.
use super::*;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    name: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    activation: u64,
    revision: String,
    name: String,
    branch_head: String,
    current_head: String,
    commits_not_in_head: u64,
    commits: Vec<Commit>,
    commits_truncated: bool,
    fingerprint: String,
}
pub(super) fn plan(
    root: &Path,
    before: &Snapshot,
    name: &str,
    deadline: Instant,
) -> Result<Plan, String> {
    validate_branch_name(root, name, deadline)?;
    let target_ref = format!("refs/heads/{name}");
    if optional_git(
        root,
        &["symbolic-ref", "--quiet", "--no-recurse", &target_ref],
        deadline,
    )?
    .is_some()
    {
        return Err("Symbolic local branches require the Git CLI for deletion.".into());
    }
    let head_ref = optional_git(
        root,
        &["symbolic-ref", "--quiet", "--no-recurse", "HEAD"],
        deadline,
    )?
    .map(|v| v.trim().to_owned());
    if head_ref
        != before
            .branch
            .as_ref()
            .map(|name| format!("refs/heads/{name}"))
    {
        return Err(
            "Indirect or changed symbolic HEAD requires the Git CLI or a fresh Git inspection."
                .into(),
        );
    }

    if root != Path::new(&before.repository_root) {
        return Err("Open the repository root before deleting a local branch.".into());
    }
    if before.rebase.is_some()
        || !before.merge_heads.is_empty()
        || before.commit_unavailable_reason.is_some()
    {
        return Err("Complete the active Git operation before deleting a local branch.".into());
    }
    let current_head = before
        .head
        .as_deref()
        .ok_or("Create the initial commit before deleting a local branch.")?;
    if before.branch.as_deref() == Some(name) {
        return Err("Switch to another branch before deleting the current branch.".into());
    }
    let target = before
        .local_branches
        .iter()
        .find(|branch| branch.name == name)
        .ok_or("The local branch is no longer available. Refresh Git.")?;
    let worktrees = git(root, &["worktree", "list", "--porcelain", "-z"], deadline)?;
    let field = format!("branch refs/heads/{name}");
    if worktrees.split('\0').any(|value| value == field) {
        return Err("This branch is checked out in a worktree and cannot be deleted.".into());
    }
    let range = format!("{current_head}..{}", target.head);
    let count = git(root, &["rev-list", "--count", &range, "--"], deadline)?
        .trim()
        .parse::<u64>()
        .map_err(|_| "Git returned an invalid unmerged commit count.")?;
    if count > 9_007_199_254_740_991 {
        return Err("The unmerged commit count exceeds the supported review range.".into());
    }
    let raw = git(
        root,
        &[
            "log",
            "-200",
            "--topo-order",
            "--no-show-signature",
            "--no-notes",
            "--encoding=UTF-8",
            "--format=%H%x00%an%x00%aI%x00%s",
            "-z",
            &range,
            "--",
        ],
        deadline,
    )?;
    let commits = parse_commits(&raw, 200)?;
    if commits.len() as u64 != count.min(200) {
        return Err(STALE.into());
    }
    require_revision(
        &snapshot(root, before.activation, deadline)?,
        &before.revision,
    )?;
    let mut result = Plan {
        activation: before.activation,
        revision: before.revision.clone(),
        name: name.into(),
        branch_head: target.head.clone(),
        current_head: current_head.into(),
        commits_not_in_head: count,
        commits,
        commits_truncated: count > 200,
        fingerprint: String::new(),
    };
    result.fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&result).map_err(|_| FAILED)?)
    );
    Ok(result)
}
pub(super) fn delete(
    root: &Path,
    before: &Snapshot,
    name: &str,
    fingerprint: &str,
    confirmation: &str,
    force: bool,
    deadline: Instant,
) -> Result<(), String> {
    let current = plan(root, before, name, deadline)?;
    if current.fingerprint != fingerprint {
        return Err(STALE.into());
    }
    if confirmation != name {
        return Err("Type the exact reviewed branch name before deleting it.".into());
    }
    if current.commits_not_in_head > 0 && !force {
        return Err("This branch has commits not contained in HEAD. Review them and explicitly allow forced deletion.".into());
    }
    delete_ref(root, before, name, &current.branch_head, deadline)?;
    cleanup_configuration(root, name, deadline)?;
    Ok(())
}
/// Expected identities are checked while Git holds all reference locks.
pub(super) fn delete_ref(
    root: &Path,
    before: &Snapshot,
    name: &str,
    expected: &str,
    deadline: Instant,
) -> Result<(), String> {
    validate_branch_name(root, name, deadline)?;
    if !oid(expected) {
        return Err(STALE.into());
    }
    let head = before.head.as_deref().ok_or(STALE)?;
    let input=format!("start\0verify HEAD\0{head}\0option no-deref\0delete refs/heads/{name}\0{expected}\0prepare\0commit\0");
    let captured = private_input_file(&input)?;
    let mut command = git_command(root, &["update-ref", "--stdin", "-z"]);
    let output = super::super::git_diff_review::process::capture_output_with_input(
        &mut command,
        deadline,
        fs::File::open(&captured.0).map_err(|_| FAILED)?,
    ).map_err(|_| "Git could not confirm the reference transaction. The local branch may already have been deleted; refresh Git before retrying. No rollback is confirmed.")?;
    let status = output.status;
    if !status.success() {
        return Err("Git refused the reference transaction. The reviewed branch or HEAD may have changed, a reference may be locked, or a trusted hook may have refused it. Refresh Git.".into());
    }
    Ok(())
}
fn cleanup_configuration(root: &Path, name: &str, deadline: Instant) -> Result<(), String> {
    let partial="The local branch reference was deleted, but its configuration cleanup could not be confirmed. Refresh Git and inspect the local branch configuration; deletion was not rolled back.";
    let target_ref = format!("refs/heads/{name}");
    let (status, _) = git_outcome(
        root,
        &["show-ref", "--verify", "--quiet", &target_ref],
        deadline,
    )
    .map_err(|_| partial)?;
    if status.code() != Some(1) {
        return Err(partial.into());
    }
    let (status, keys) = git_outcome(
        root,
        &[
            "config",
            "--local",
            "--name-only",
            "--get-regexp",
            "^branch\\.",
        ],
        deadline,
    )
    .map_err(|_| partial)?;
    if status.code() == Some(1) {
        return Ok(());
    }
    if !status.success() {
        return Err(partial.into());
    }
    let section = format!("branch.{name}");
    if keys.lines().any(|key| {
        key.rsplit_once('.')
            .is_some_and(|(prefix, _)| prefix == section)
    }) {
        git(
            root,
            &["config", "--local", "--remove-section", &section],
            deadline,
        )
        .map_err(|_| partial)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn git_workspace_branch_delete_plan(request: PlanRequest) -> Result<Plan, String> {
    trusted(request.trusted)?;
    super::super::blocking::run(move || {
        let root =
            with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        let deadline = Instant::now() + READ_TIMEOUT;
        let before = snapshot(&root, request.activation, deadline)?;
        require_revision(&before, &request.revision)?;
        let result = plan(&root, &before, &request.name, deadline);
        with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        result
    })
    .await
}
