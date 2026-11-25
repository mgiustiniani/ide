//! Local merges stop for explicit review; Git owns conflict construction and abort.
use super::*;
pub(super) fn heads(root: &Path, deadline: Instant) -> Result<Vec<String>, String> {
    let path = git_path(root, "MERGE_HEAD", deadline)?;
    if !path.try_exists().map_err(|_| FAILED)? {
        return Ok(Vec::new());
    }
    let file = fs::File::open(&path).map_err(|_| FAILED)?;
    let mut raw = Vec::new();
    file.take(2049).read_to_end(&mut raw).map_err(|_| FAILED)?;
    if raw.len() > 2048 {
        return Err("The merge state exceeds the supported bounds.".into());
    }
    let raw = std::str::from_utf8(&raw).map_err(|_| FAILED)?;
    let heads: Vec<String> = raw.lines().map(str::to_owned).collect();
    if heads.is_empty() || heads.len() > 16 || heads.iter().any(|head| !oid(head)) {
        return Err("Git returned invalid merge state. Use the Git CLI.".into());
    }
    Ok(heads)
}
fn root_only(root: &Path, before: &Snapshot) -> Result<(), String> {
    if root != Path::new(&before.repository_root) {
        return Err("Open the repository root before merging or aborting a merge.".into());
    }
    Ok(())
}
fn other_operation(root: &Path, deadline: Instant) -> Result<(), String> {
    for name in [
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
        "MERGE_AUTOSTASH",
    ] {
        if git_path(root, name, deadline)?
            .try_exists()
            .map_err(|_| FAILED)?
        {
            return Err(
                "Complete the active sequencer or autostash operation through the Git CLI.".into(),
            );
        }
    }
    Ok(())
}
pub(super) fn start(
    root: &Path,
    before: &Snapshot,
    name: &str,
    deadline: Instant,
) -> Result<(), String> {
    root_only(root, before)?;
    other_operation(root, deadline)?;
    validate_branch_name(root, name, deadline)?;
    if before.head.is_none() || before.branch.is_none() || !before.merge_heads.is_empty() {
        return Err(
            "Choose an attached branch with no active merge before starting another merge.".into(),
        );
    }
    if !before.files.is_empty() {
        return Err("Commit, move or explicitly discard all saved changes and untracked files before merging. Git actions never clean them automatically.".into());
    }
    let target = before
        .local_branches
        .iter()
        .find(|branch| branch.name == name)
        .ok_or("The local merge branch is no longer available. Refresh Git.")?;
    if before.branch.as_deref() == Some(name) {
        return Err("Choose a different local branch to merge.".into());
    }
    let reference = format!("refs/heads/{name}");
    let (exit, _) = git_outcome(
        root,
        &[
            "-c",
            "submodule.recurse=false",
            "merge",
            "--no-commit",
            "--no-ff",
            "--no-edit",
            "--no-squash",
            "--no-autostash",
            "--no-rerere-autoupdate",
            "--no-overwrite-ignore",
            "--",
            &reference,
        ],
        deadline,
    )?;
    if !exit.success() {
        // Exit 1 is Git's ordinary unresolved-merge result, not an invented success.
        // Other failures remain errors even if a hook left some merge state behind.
        if exit.code() != Some(1) || heads(root, deadline)? != [target.head.clone()] {
            return Err(FAILED.into());
        }
        let after = snapshot(root, before.activation, deadline)?;
        if after.head != before.head || !after.files.iter().any(|file| file.conflict) {
            return Err(FAILED.into());
        }
    }
    Ok(())
}
pub(super) fn abort(root: &Path, before: &Snapshot, deadline: Instant) -> Result<(), String> {
    root_only(root, before)?;
    other_operation(root, deadline)?;
    if before.merge_heads.is_empty() {
        return Err("There is no merge to abort. Refresh Git.".into());
    }
    git(
        root,
        &["-c", "submodule.recurse=false", "merge", "--abort"],
        deadline,
    )?;
    Ok(())
}

pub(super) fn hash_saved_changes(
    root: &Path,
    files: &[FileStatus],
    hash: &mut Sha256,
    deadline: Instant,
) -> Result<(), String> {
    let mut bytes = 0u64;
    for file in files {
        if Instant::now() >= deadline {
            return Err(FAILED.into());
        }
        if file.directory {
            return Err(
                "Use the Git CLI for merge states containing directories or submodules.".into(),
            );
        }
        match fs::symlink_metadata(root.join(&file.path)) {
            Ok(metadata) => {
                bytes = bytes.saturating_add(metadata.len());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(FAILED.into()),
        }
        if bytes > 16 * 1024 * 1024 {
            return Err("Saved merge inputs exceed 16 MiB. Use the Git CLI.".into());
        }
        hash.update(file.path.as_bytes());
        hash.update([0]);
        hash.update(fingerprint(root, file)?.as_bytes());
        hash.update([0]);
    }
    Ok(())
}
