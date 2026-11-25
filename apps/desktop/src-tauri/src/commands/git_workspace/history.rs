//! Paginated, immutable HEAD history and first-parent commit patches. Never reads editor drafts.
use super::*;
const PAGE: usize = 50;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    head: String,
    path: Option<String>,
    offset: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    head: String,
    path: Option<String>,
    offset: u32,
    commit: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    activation: u64,
    revision: String,
    head: String,
    path: Option<String>,
    offset: u32,
    commits: Vec<Commit>,
    next_offset: Option<u32>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitReview {
    activation: u64,
    revision: String,
    head: String,
    path: Option<String>,
    offset: u32,
    commit: String,
    text: String,
}
fn validate(request: &HistoryRequest) -> Result<(), String> {
    trusted(request.trusted)?;
    if !oid(&request.head)
        || request.offset % PAGE as u32 != 0
        || request.offset > u32::MAX - PAGE as u32
    {
        return Err("Choose a valid captured Git history page.".into());
    }
    if let Some(path) = &request.path {
        relative(path)?;
        if path.len() > 32768 {
            return Err("The Git history path exceeds the supported limit.".into());
        }
    }
    Ok(())
}
fn require_snapshot(
    root: &Path,
    request: &HistoryRequest,
    deadline: Instant,
) -> Result<(), String> {
    let state = snapshot(root, request.activation, deadline)?;
    require_revision(&state, &request.revision)?;
    if state.head.as_deref() != Some(request.head.as_str()) {
        return Err(STALE.into());
    }
    Ok(())
}
fn read_in_root(
    root: &Path,
    request: &HistoryRequest,
    deadline: Instant,
) -> Result<History, String> {
    validate(request)?;
    require_snapshot(root, request, deadline)?;
    let skip = format!("--skip={}", request.offset);
    let raw = git(
        root,
        &[
            "log",
            "--topo-order",
            "--no-show-signature",
            "--no-notes",
            "--encoding=UTF-8",
            "--format=%H%x00%an%x00%aI%x00%s",
            "-z",
            "-51",
            &skip,
            &request.head,
            "--",
            request.path.as_deref().unwrap_or("."),
        ],
        deadline,
    )?;
    let mut commits = parse_commits(&raw, PAGE + 1)?;
    let next_offset = (commits.len() > PAGE).then_some(request.offset + PAGE as u32);
    commits.truncate(PAGE);
    require_snapshot(root, request, deadline)?;
    Ok(History {
        activation: request.activation,
        revision: request.revision.clone(),
        head: request.head.clone(),
        path: request.path.clone(),
        offset: request.offset,
        commits,
        next_offset,
    })
}
fn review_in_root(
    root: &Path,
    request: &CommitRequest,
    deadline: Instant,
) -> Result<CommitReview, String> {
    if !oid(&request.commit) {
        return Err("Choose a commit from the captured history page.".into());
    }
    let scope = HistoryRequest {
        workspace_path: request.workspace_path.clone(),
        trusted: request.trusted,
        activation: request.activation,
        revision: request.revision.clone(),
        head: request.head.clone(),
        path: request.path.clone(),
        offset: request.offset,
    };
    // Re-read the exact selected page. This also rejects commits outside the workspace,
    // unreachable objects and a forged commit from another page or path filter.
    let page = read_in_root(root, &scope, deadline)?;
    if !page
        .commits
        .iter()
        .any(|commit| commit.id == request.commit)
    {
        return Err(
            "The selected commit does not belong to this captured Git history page.".into(),
        );
    }
    let text = git(root, &[
        "show", "--no-color", "--no-ext-diff", "--no-textconv", "--no-notes", "--no-show-signature",
        "--encoding=UTF-8", "--format=fuller", "--date=iso-strict", "--diff-merges=first-parent",
        "--no-renames", &request.commit, "--", request.path.as_deref().unwrap_or("."),
    ], deadline).map_err(|_| "Git could not produce this commit review within the five-second and 1 MiB read bounds. Use the Git CLI for larger patches.".to_owned())?;
    require_snapshot(root, &scope, deadline)?;
    Ok(CommitReview {
        activation: request.activation,
        revision: request.revision.clone(),
        head: request.head.clone(),
        path: request.path.clone(),
        offset: request.offset,
        commit: request.commit.clone(),
        text,
    })
}
#[tauri::command]
pub async fn git_workspace_history(request: HistoryRequest) -> Result<History, String> {
    validate(&request)?;
    super::super::blocking::run(move || {
        let root =
            with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        let result = read_in_root(&root, &request, Instant::now() + READ_TIMEOUT);
        with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        result
    })
    .await
}
#[tauri::command]
pub async fn git_workspace_commit_review(request: CommitRequest) -> Result<CommitReview, String> {
    trusted(request.trusted)?;
    super::super::blocking::run(move || {
        let root =
            with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        let result = review_in_root(&root, &request, Instant::now() + READ_TIMEOUT);
        with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        result
    })
    .await
}
#[cfg(all(test, unix))]
mod tests;
