use super::*;
use std::os::unix::fs::{symlink, PermissionsExt};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        Self::with_format("sha1")
    }
    fn with_format(format: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-local-git-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let repo = Self(root.canonicalize().unwrap());
        repo.run(&[
            "-c",
            "init.templateDir=",
            "init",
            "--quiet",
            &format!("--object-format={format}"),
        ]);
        fs::create_dir(repo.0.join("empty-hooks")).unwrap();
        repo.write(".gitignore", "empty-hooks/\nhook-ran\n");
        for (key, value) in [
            ("user.name", "Fixture Author"),
            ("user.email", "fixture@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
            ("core.hooksPath", "empty-hooks"),
        ] {
            repo.run(&["config", key, value]);
        }
        repo
    }
    fn run(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.0)
            .env_remove("GIT_INDEX_FILE")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{:?}: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn initial(&self) {
        self.write("tracked.txt", "original\n");
        self.run(&["add", "--", "tracked.txt", ".gitignore"]);
        self.run(&["commit", "--quiet", "-m", "Initial fixture"]);
    }
    fn status(&self) -> Snapshot {
        snapshot(&self.0, 7, Instant::now() + READ_TIMEOUT).unwrap()
    }
    fn review(&self, state: &Snapshot, path: &str, staged: bool) -> (String, Option<String>) {
        review_in_root(
            &self.0,
            state,
            &ReviewRequest {
                workspace_path: self.0.to_str().unwrap().into(),
                trusted: true,
                activation: 7,
                revision: state.revision.clone(),
                path: Some(path.into()),
                staged,
            },
            Instant::now() + READ_TIMEOUT,
        )
        .unwrap()
    }
    fn mutate(&self, revision: &str, action: Action) -> Result<Snapshot, String> {
        mutate_in_root(
            &self.0,
            7,
            &MutationRequest {
                workspace_path: self.0.to_str().unwrap().into(),
                trusted: true,
                activation: 7,
                revision: revision.into(),
                action,
            },
            Instant::now() + WRITE_TIMEOUT,
        )
    }
    fn stage(&self, path: &str) -> Snapshot {
        let before = self.status();
        let (_, hash) = self.review(&before, path, false);
        self.mutate(
            &before.revision,
            Action::Stage {
                path: path.into(),
                saved_fingerprint: hash.unwrap(),
            },
        )
        .unwrap()
    }
    fn index(&self) -> Vec<u8> {
        fs::read(self.0.join(".git/index")).unwrap_or_default()
    }
    fn commit(&self, state: &Snapshot, message: &str) -> Snapshot {
        self.mutate(
            &state.revision,
            Action::Commit {
                message: message.into(),
                author_name: "IDE Fixture".into(),
                author_email: "ide@example.invalid".into(),
            },
        )
        .unwrap()
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
#[test]
fn stage_and_unstage_literal_paths_preserve_sources_and_unrelated_index_entries() {
    let repo = Repo::new();
    repo.initial();
    let path = ":(glob)caffè -> only\nfile.txt";
    repo.write(path, "saved literal\n");
    repo.write("tracked.txt", "other changed\n");
    let bytes = fs::read(repo.0.join(path)).unwrap();
    let state = repo.stage(path);
    assert!(state.files.iter().find(|f| f.path == path).unwrap().staged);
    assert_eq!(
        repo.run(&["diff", "--cached", "--name-only", "-z"]),
        format!("{path}\0")
    );
    let state = repo
        .mutate(&state.revision, Action::Unstage { path: path.into() })
        .unwrap();
    assert!(!state.files.iter().find(|f| f.path == path).unwrap().staged);
    assert_eq!(fs::read(repo.0.join(path)).unwrap(), bytes);
    assert!(repo.run(&["diff", "--cached", "--name-only"]).is_empty());
}
#[test]
fn unborn_unstage_keeps_the_new_file() {
    let repo = Repo::new();
    repo.write("New.java", "class New {}\n");
    let state = repo.stage("New.java");
    assert!(state.head.is_none());
    repo.mutate(
        &state.revision,
        Action::Unstage {
            path: "New.java".into(),
        },
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(repo.0.join("New.java")).unwrap(),
        "class New {}\n"
    );
    assert!(repo.run(&["ls-files", "--cached"]).is_empty());
}
#[test]
fn inspect_and_review_never_refresh_the_index_or_write_source() {
    let repo = Repo::new();
    repo.initial();
    repo.write("tracked.txt", "new saved\n");
    let index = repo.index();
    let state = repo.status();
    let (patch, _) = repo.review(&state, "tracked.txt", false);
    assert!(patch.contains("+new saved"));
    assert_eq!(repo.index(), index);
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "new saved\n"
    );
    assert_eq!(state.commits[0].subject, "Initial fixture");
}
#[test]
fn saved_drift_refuses_staging_without_index_change() {
    let repo = Repo::new();
    repo.initial();
    repo.write("tracked.txt", "first\n");
    let state = repo.status();
    let (_, hash) = repo.review(&state, "tracked.txt", false);
    let index = repo.index();
    repo.write("tracked.txt", "later\n");
    let error = repo
        .mutate(
            &state.revision,
            Action::Stage {
                path: "tracked.txt".into(),
                saved_fingerprint: hash.unwrap(),
            },
        )
        .unwrap_err();
    assert!(error.contains("saved file changed"));
    assert_eq!(repo.index(), index);
}
#[test]
fn index_drift_refuses_an_old_operation() {
    let repo = Repo::new();
    repo.initial();
    repo.write("tracked.txt", "changed\n");
    repo.write("Other.java", "class Other {}\n");
    let state = repo.status();
    let (_, hash) = repo.review(&state, "tracked.txt", false);
    repo.run(&["add", "--", "Other.java"]);
    let index = repo.index();
    assert_eq!(
        repo.mutate(
            &state.revision,
            Action::Stage {
                path: "tracked.txt".into(),
                saved_fingerprint: hash.unwrap()
            }
        )
        .unwrap_err(),
        STALE
    );
    assert_eq!(repo.index(), index);
}
#[test]
fn commit_records_the_index_and_preserves_later_unstaged_source() {
    let repo = Repo::new();
    repo.initial();
    repo.write("tracked.txt", "staged version\n");
    repo.stage("tracked.txt");
    repo.write("tracked.txt", "later disk bytes\n");
    let state = repo.status();
    let (patch, _) = repo.review(&state, "tracked.txt", true);
    assert!(patch.contains("+staged version"));
    assert!(!patch.contains("later disk"));
    let after = repo.commit(&state, "# Literal café commit\n\nDescription\n");
    assert_eq!(repo.run(&["show", "HEAD:tracked.txt"]), "staged version\n");
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "later disk bytes\n"
    );
    assert_eq!(after.commits[0].subject, "# Literal café commit");
    assert_eq!(after.commits[0].author, "IDE Fixture");
    assert_ne!(state.head, after.head);
}
#[test]
fn commit_honors_hooks() {
    let repo = Repo::new();
    repo.initial();
    let hook = repo.0.join("empty-hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\nprintf ran > hook-ran\n").unwrap();
    fs::set_permissions(hook, fs::Permissions::from_mode(0o700)).unwrap();
    repo.write("tracked.txt", "hook input\n");
    let state = repo.stage("tracked.txt");
    repo.commit(&state, "Hook fixture");
    assert_eq!(fs::read_to_string(repo.0.join("hook-ran")).unwrap(), "ran");
}
#[test]
fn nested_workspace_cannot_commit_outside_staged_files_including_unborn() {
    for initial in [false, true] {
        let repo = Repo::new();
        if initial {
            repo.initial();
        }
        repo.write("inside/New.java", "class New {}\n");
        repo.write("outside.txt", "outside staged\n");
        repo.run(&["add", "--", "inside/New.java", "outside.txt"]);
        let state = snapshot(&repo.0.join("inside"), 7, Instant::now() + READ_TIMEOUT).unwrap();
        assert!(state
            .commit_unavailable_reason
            .unwrap()
            .contains("outside this workspace"));
        assert!(state.files.iter().all(|f| f.path == "New.java"));
    }
}
#[test]
fn rename_unstage_and_deletion_do_not_recreate_or_overwrite_files() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["mv", "--", "tracked.txt", "renamed.txt"]);
    let state = repo.status();
    assert_eq!(
        state
            .files
            .iter()
            .find(|f| f.path == "renamed.txt")
            .unwrap()
            .original_path
            .as_deref(),
        Some("tracked.txt")
    );
    repo.mutate(
        &state.revision,
        Action::Unstage {
            path: "renamed.txt".into(),
        },
    )
    .unwrap();
    assert!(!repo.0.join("tracked.txt").exists());
    assert!(repo.0.join("renamed.txt").exists());
    repo.stage("tracked.txt");
    assert!(repo
        .run(&["diff", "--cached", "--name-status"])
        .contains("D\ttracked.txt"));
}
#[test]
fn existing_git_lock_refuses_mutation_without_overwrite() {
    let repo = Repo::new();
    repo.initial();
    repo.write("tracked.txt", "changed\n");
    let state = repo.status();
    let (_, hash) = repo.review(&state, "tracked.txt", false);
    let index = repo.index();
    fs::write(repo.0.join(".git/index.lock"), "external owner").unwrap();
    assert!(repo
        .mutate(
            &state.revision,
            Action::Stage {
                path: "tracked.txt".into(),
                saved_fingerprint: hash.unwrap()
            }
        )
        .is_err());
    assert_eq!(repo.index(), index);
    assert_eq!(
        fs::read_to_string(repo.0.join(".git/index.lock")).unwrap(),
        "external owner"
    );
}
#[test]
fn unsupported_paths_and_incomplete_status_do_not_fabricate_success() {
    let repo = Repo::new();
    assert!(status_files(" M truncated", "", &repo.0).is_err());
    assert!(status_files("R  new\0", "", &repo.0).is_err());
    assert!(relative("../outside").is_err());
    assert!(relative("/outside").is_err());
    assert!(trusted(false).is_err());
    let outside = Repo::new();
    symlink(&outside.0, repo.0.join("escape")).unwrap();
    assert!(allowed_path(&repo.0, "escape/secret").is_err());
}
#[test]
fn identity_and_message_files_are_bounded_and_private() {
    assert!(identity("bad\nname", "a@example.invalid").is_err());
    assert!(identity("Name", "bad>email").is_err());
    let file = private_input_file("# literal\n").unwrap();
    let path = file.0.clone();
    assert_eq!(fs::read_to_string(&path).unwrap(), "# literal\n");
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    drop(file);
    assert!(!path.exists());
}

#[test]
fn a_symbolic_link_to_a_directory_is_staged_as_a_link_without_target_writes() {
    let repo = Repo::new();
    repo.initial();
    let outside = Repo::new();
    symlink(&outside.0, repo.0.join("link")).unwrap();
    let before = repo.status();
    assert!(
        !before
            .files
            .iter()
            .find(|file| file.path == "link")
            .unwrap()
            .directory
    );
    let (text, _) = repo.review(&before, "link", false);
    assert!(text.contains(outside.0.to_str().unwrap()));
    let state = repo.stage("link");
    repo.commit(&state, "Add saved link");
    assert_eq!(
        repo.run(&["show", "HEAD:link"]),
        outside.0.to_str().unwrap()
    );
    assert!(repo.0.join("link").symlink_metadata().unwrap().is_symlink());
}
#[test]
fn staged_deletion_accepts_a_missing_parent_without_recreating_it() {
    let repo = Repo::new();
    repo.initial();
    repo.write("folder/Nested.java", "class Nested {}\n");
    repo.run(&["add", "--", "folder/Nested.java"]);
    repo.run(&["commit", "--quiet", "-m", "Nested fixture"]);
    fs::remove_dir_all(repo.0.join("folder")).unwrap();
    repo.stage("folder/Nested.java");
    assert!(!repo.0.join("folder").exists());
    assert!(repo
        .run(&["diff", "--cached", "--name-status"])
        .contains("D\tfolder/Nested.java"));
}
#[test]
fn scope_rejects_a_new_activation_even_for_the_same_root() {
    assert!(validate_activation(Path::new("/workspace"), 8, "/workspace", 7).is_err());
    assert!(validate_activation(Path::new("/new"), 7, "/workspace", 7).is_err());
    assert!(validate_activation(Path::new("/workspace"), 7, "/workspace", 7).is_ok());
}

#[test]
fn staged_deletion_and_recreated_file_share_one_reviewable_entry() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["rm", "--cached", "--", "tracked.txt"]);
    let state = repo.status();
    let matches: Vec<_> = state
        .files
        .iter()
        .filter(|file| file.path == "tracked.txt")
        .collect();
    assert_eq!(matches.len(), 1);
    assert!(matches[0].staged && matches[0].unstaged);
    let (text, _) = repo.review(&state, "tracked.txt", false);
    assert!(text.contains("original"));
    repo.stage("tracked.txt");
    assert!(repo.run(&["diff", "--cached", "--name-only"]).is_empty());
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "original\n"
    );
}
#[test]
fn updating_a_staged_rename_does_not_stage_an_untracked_recreated_original() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["mv", "--", "tracked.txt", "renamed.txt"]);
    repo.write("tracked.txt", "untracked original name\n");
    repo.write("renamed.txt", "updated renamed file\n");
    repo.stage("renamed.txt");
    let paths = repo.run(&["ls-files", "--cached", "-z"]);
    assert!(paths
        .split_terminator('\0')
        .any(|path| path == "renamed.txt"));
    assert!(!paths
        .split_terminator('\0')
        .any(|path| path == "tracked.txt"));
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "untracked original name\n"
    );
}

#[test]
fn optional_metadata_distinguishes_absence_from_command_failure_or_timeout() {
    let repo = Repo::new();
    assert!(optional_git(
        &repo.0,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        Instant::now() + READ_TIMEOUT
    )
    .unwrap()
    .is_none());
    assert!(optional_git(
        &repo.0,
        &["config", "--get", "ide-fixture-absent.value"],
        Instant::now() + READ_TIMEOUT
    )
    .unwrap()
    .is_none());
    assert!(optional_git(
        &repo.0,
        &["config", "--invalid-fixture-option"],
        Instant::now() + READ_TIMEOUT
    )
    .is_err());
    assert!(optional_git(&repo.0, &["config", "--get", "user.name"], Instant::now()).is_err());
    repo.initial();
    assert!(optional_git(
        &repo.0.join("tracked.txt"),
        &["config", "--get", "user.name"],
        Instant::now() + READ_TIMEOUT
    )
    .is_err());
}
#[test]
fn detached_head_remains_a_real_commit_rather_than_an_unborn_repository() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["checkout", "--detach", "--quiet", "HEAD"]);
    let state = repo.status();
    assert!(state.branch.is_none());
    assert!(state.head.is_some());
    assert_eq!(state.commits[0].subject, "Initial fixture");
}

#[test]
fn local_branch_creation_is_literal_and_keeps_head_index_and_working_tree() {
    let repo = Repo::new();
    repo.initial();
    repo.write("tracked.txt", "saved local edit\n");
    let state = repo.status();
    let index = repo.index();
    let name = "feature/caffè-$(literal)";
    let created = repo
        .mutate(&state.revision, Action::CreateBranch { name: name.into() })
        .unwrap();
    assert_eq!(created.branch, state.branch);
    assert_eq!(created.head, state.head);
    assert_eq!(repo.index(), index);
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "saved local edit\n"
    );
    assert!(created
        .local_branches
        .iter()
        .any(|b| b.name == name && Some(&b.head) == state.head.as_ref()));
    assert!(repo
        .mutate(
            &created.revision,
            Action::CreateBranch { name: name.into() }
        )
        .is_err());
    assert_eq!(repo.status().head, state.head);
}

#[test]
fn branch_creation_rejects_invalid_names_and_an_unborn_head() {
    let repo = Repo::new();
    let unborn = repo.status();
    assert!(repo
        .mutate(
            &unborn.revision,
            Action::CreateBranch {
                name: "feature/new".into()
            }
        )
        .is_err());
    repo.initial();
    for name in [
        "",
        "--force",
        "@{-1}",
        "bad..name",
        "with space",
        "refs/../escape",
        "line\nbreak",
    ] {
        let state = repo.status();
        assert!(
            repo.mutate(&state.revision, Action::CreateBranch { name: name.into() })
                .is_err(),
            "{name}"
        );
    }
    assert_eq!(repo.status().local_branches.len(), 1);
}

#[test]
fn switch_updates_sources_and_retains_non_overlapping_saved_changes() {
    let repo = Repo::new();
    repo.initial();
    let original = repo.status().branch.unwrap();
    repo.run(&["switch", "--quiet", "-c", "feature/target"]);
    repo.write("tracked.txt", "target branch\n");
    repo.write("added.txt", "target only\n");
    repo.run(&["add", "--", "tracked.txt", "added.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Target fixture"]);
    repo.run(&["switch", "--quiet", &original]);
    repo.write("local.txt", "untracked retained\n");
    let state = repo.status();
    let result = repo
        .mutate(
            &state.revision,
            Action::SwitchBranch {
                name: "feature/target".into(),
            },
        )
        .unwrap();
    assert_eq!(result.branch.as_deref(), Some("feature/target"));
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "target branch\n"
    );
    assert_eq!(
        fs::read_to_string(repo.0.join("added.txt")).unwrap(),
        "target only\n"
    );
    assert_eq!(
        fs::read_to_string(repo.0.join("local.txt")).unwrap(),
        "untracked retained\n"
    );
}

#[test]
fn switch_refuses_overwritten_saved_edits_and_never_forces_or_stashes() {
    let repo = Repo::new();
    repo.initial();
    let original = repo.status().branch.unwrap();
    repo.run(&["switch", "--quiet", "-c", "target"]);
    repo.write("tracked.txt", "target\n");
    repo.run(&["add", "--", "tracked.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Target fixture"]);
    repo.run(&["switch", "--quiet", &original]);
    repo.write("tracked.txt", "local saved\n");
    let state = repo.status();
    let index = repo.index();
    assert!(repo
        .mutate(
            &state.revision,
            Action::SwitchBranch {
                name: "target".into()
            }
        )
        .is_err());
    assert_eq!(repo.status().branch, Some(original));
    assert_eq!(repo.index(), index);
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "local saved\n"
    );
    assert!(repo.run(&["stash", "list"]).is_empty());
}

#[test]
fn branch_revision_rejects_target_ref_changes_and_missing_or_remote_branches() {
    let repo = Repo::new();
    repo.initial();
    let state = repo.status();
    repo.run(&["branch", "target"]);
    assert_ne!(state.revision, repo.status().revision);
    assert!(repo
        .mutate(
            &state.revision,
            Action::SwitchBranch {
                name: "target".into()
            }
        )
        .unwrap_err()
        .contains("Git state changed"));
    let current = repo.status();
    assert!(repo
        .mutate(
            &current.revision,
            Action::SwitchBranch {
                name: "missing".into()
            }
        )
        .unwrap_err()
        .contains("no longer available"));
    repo.run(&["update-ref", "refs/remotes/origin/remote-only", "HEAD"]);
    let current = repo.status();
    assert!(repo
        .mutate(
            &current.revision,
            Action::SwitchBranch {
                name: "remote-only".into()
            }
        )
        .is_err());
    assert!(!repo
        .status()
        .local_branches
        .iter()
        .any(|b| b.name == "remote-only"));
}

#[test]
fn branch_switch_requires_repository_root_and_refuses_an_active_merge() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "target"]);
    fs::create_dir(repo.0.join("subdir")).unwrap();
    let sub = repo.0.join("subdir");
    let before = snapshot(&sub, 7, Instant::now() + READ_TIMEOUT).unwrap();
    let request = MutationRequest {
        workspace_path: sub.to_str().unwrap().into(),
        trusted: true,
        activation: 7,
        revision: before.revision,
        action: Action::SwitchBranch {
            name: "target".into(),
        },
    };
    assert!(
        mutate_in_root(&sub, 7, &request, Instant::now() + WRITE_TIMEOUT)
            .unwrap_err()
            .contains("repository root")
    );
    repo.write(".git/MERGE_HEAD", &repo.run(&["rev-parse", "HEAD"]));
    let before = repo.status();
    assert!(repo
        .mutate(
            &before.revision,
            Action::SwitchBranch {
                name: "target".into()
            }
        )
        .unwrap_err()
        .contains("merge"));
}

#[test]
fn rename_current_branch_preserves_head_index_sources_config_and_reflog() {
    let repo = Repo::new();
    repo.initial();
    let original = repo.status().branch.unwrap();
    repo.run(&["config", &format!("branch.{original}.remote"), "."]);
    repo.run(&[
        "config",
        &format!("branch.{original}.merge"),
        "refs/heads/upstream",
    ]);
    repo.write("tracked.txt", "staged version\n");
    repo.run(&["add", "--", "tracked.txt"]);
    repo.write("tracked.txt", "saved unstaged version\n");
    let before = repo.status();
    let index = repo.index();
    let name = "feature/caffè-$(literal)";
    let after = repo
        .mutate(
            &before.revision,
            Action::RenameBranch {
                old_name: original.clone(),
                name: name.into(),
            },
        )
        .unwrap();
    assert_eq!(after.branch.as_deref(), Some(name));
    assert_eq!(after.head, before.head);
    assert_eq!(repo.index(), index);
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "saved unstaged version\n"
    );
    assert_eq!(
        repo.run(&["config", "--get", &format!("branch.{name}.remote")])
            .trim(),
        "."
    );
    assert_eq!(
        repo.run(&["config", "--get", &format!("branch.{name}.merge")])
            .trim(),
        "refs/heads/upstream"
    );
    assert!(repo
        .run(&["reflog", "show", "--format=%gs", name])
        .contains("Initial fixture"));
    assert!(!after
        .local_branches
        .iter()
        .any(|branch| branch.name == original));
    assert_ne!(after.revision, before.revision);
}

#[test]
fn rename_other_branch_does_not_checkout_or_overwrite_an_existing_name() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "topic"]);
    let before = repo.status();
    let renamed = repo
        .mutate(
            &before.revision,
            Action::RenameBranch {
                old_name: "topic".into(),
                name: "renamed".into(),
            },
        )
        .unwrap();
    assert_eq!(renamed.branch, before.branch);
    assert_eq!(renamed.head, before.head);
    let error = repo
        .mutate(
            &renamed.revision,
            Action::RenameBranch {
                old_name: "renamed".into(),
                name: before.branch.clone().unwrap(),
            },
        )
        .unwrap_err();
    assert!(error.contains("already uses"));
    assert_eq!(repo.status().revision, renamed.revision);
}

#[test]
fn rename_refuses_invalid_missing_and_stale_branch_selections() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "topic"]);
    let before = repo.status();
    for (old_name, name) in [
        ("topic", "--force"),
        ("topic", "bad..name"),
        ("@{-1}", "other"),
        ("missing", "other"),
        ("topic", "topic"),
    ] {
        assert!(repo
            .mutate(
                &before.revision,
                Action::RenameBranch {
                    old_name: old_name.into(),
                    name: name.into(),
                }
            )
            .is_err());
        assert_eq!(repo.status().revision, before.revision);
    }
    repo.run(&["branch", "another"]);
    assert_eq!(
        repo.mutate(
            &before.revision,
            Action::RenameBranch {
                old_name: "topic".into(),
                name: "other".into(),
            }
        )
        .unwrap_err(),
        STALE
    );
    assert!(repo
        .status()
        .local_branches
        .iter()
        .any(|branch| branch.name == "topic"));
}

#[test]
fn rename_refuses_a_branch_checked_out_in_another_worktree() {
    let repo = Repo::new();
    repo.initial();
    // A path with a newline verifies that porcelain -z is parsed as NUL fields.
    repo.write(".git/info/exclude", ".linked-worktrees/\n");
    let worktree = repo.0.join(".linked-worktrees/linked\nworktree");
    repo.run(&[
        "worktree",
        "add",
        "--quiet",
        "-b",
        "topic",
        worktree.to_str().unwrap(),
    ]);
    let before = repo.status();
    let error = repo
        .mutate(
            &before.revision,
            Action::RenameBranch {
                old_name: "topic".into(),
                name: "other".into(),
            },
        )
        .unwrap_err();
    assert!(error.contains("Open the worktree"));
    assert!(fs::read_to_string(worktree.join(".git"))
        .unwrap()
        .contains("gitdir:"));
    assert_eq!(repo.status().revision, before.revision);
}

fn merge_fixture() -> (Repo, String, String) {
    let repo = Repo::new();
    repo.initial();
    let branch = repo
        .run(&["symbolic-ref", "--short", "HEAD"])
        .trim()
        .to_owned();
    repo.run(&["switch", "--quiet", "-c", "feature/merge"]);
    repo.write("tracked.txt", "theirs\n");
    repo.run(&["add", "--", "tracked.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Theirs"]);
    let target = repo.run(&["rev-parse", "HEAD"]).trim().to_owned();
    repo.run(&["switch", "--quiet", &branch]);
    repo.write("tracked.txt", "ours\n");
    repo.run(&["add", "--", "tracked.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Ours"]);
    let head = repo.run(&["rev-parse", "HEAD"]).trim().to_owned();
    (repo, head, target)
}
#[test]
fn conflicting_merge_pauses_for_review_aborts_and_can_be_explicitly_resolved_and_committed() {
    let (repo, head, target) = merge_fixture();
    let initial = repo.status();
    let config = fs::read(repo.0.join(".git/config")).unwrap();
    let begin = || {
        repo.mutate(
            &repo.status().revision,
            Action::MergeBranch {
                name: "feature/merge".into(),
            },
        )
        .unwrap()
    };
    let paused = begin();
    assert_eq!(paused.merge_heads, [target.clone()]);
    assert_eq!(paused.head.as_deref(), Some(head.as_str()));
    assert!(paused.files.iter().any(|file| file.conflict));
    assert!(paused
        .commit_unavailable_reason
        .as_deref()
        .unwrap()
        .contains("conflicts"));
    assert!(fs::read_to_string(repo.0.join("tracked.txt"))
        .unwrap()
        .contains("<<<<<<<"));
    assert!(repo
        .mutate(&initial.revision, Action::AbortMerge)
        .unwrap_err()
        .contains("Git state changed"));
    let restored = repo.mutate(&paused.revision, Action::AbortMerge).unwrap();
    assert!(restored.merge_heads.is_empty());
    assert_eq!(restored.head.as_deref(), Some(head.as_str()));
    assert!(restored.files.is_empty());
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "ours\n"
    );
    begin();
    repo.write("tracked.txt", "resolved\n");
    let staged = repo.stage("tracked.txt");
    assert!(staged.commit_unavailable_reason.is_none());
    assert_eq!(staged.merge_heads, [target.clone()]);
    let done = repo.commit(&staged, "Explicit merge review");
    assert!(done.merge_heads.is_empty());
    let parents = repo.run(&["rev-list", "--parents", "-1", "HEAD"]);
    let parts: Vec<_> = parents.split_whitespace().collect();
    assert_eq!(&parts[1..], [head, target]);
    assert_eq!(repo.run(&["show", "HEAD:tracked.txt"]), "resolved\n");
    assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
}
#[test]
fn fast_forward_candidate_stops_without_commit_and_identical_tree_merge_can_commit() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "feature/ff"]);
    repo.run(&["switch", "--quiet", "feature/ff"]);
    repo.write("new.txt", "new\n");
    repo.run(&["add", "--", "new.txt"]);
    repo.run(&["commit", "--quiet", "-m", "New"]);
    let target = repo.run(&["rev-parse", "HEAD"]).trim().to_owned();
    repo.run(&["switch", "--quiet", "-"]);
    let head = repo.status().head.unwrap();
    let paused = repo
        .mutate(
            &repo.status().revision,
            Action::MergeBranch {
                name: "feature/ff".into(),
            },
        )
        .unwrap();
    assert_eq!(paused.head.as_deref(), Some(head.as_str()));
    assert_eq!(paused.merge_heads, [target]);
    assert!(paused.files.iter().any(|file| file.staged));
    repo.mutate(&paused.revision, Action::AbortMerge).unwrap();
    // Divergent commits with identical trees still need a reviewable merge commit.
    repo.run(&["commit", "--quiet", "--allow-empty", "-m", "Ours empty"]);
    repo.run(&["switch", "--quiet", "feature/ff"]);
    repo.run(&["rm", "--", "new.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Remove"]);
    repo.run(&["switch", "--quiet", "-"]);
    let paused = repo
        .mutate(
            &repo.status().revision,
            Action::MergeBranch {
                name: "feature/ff".into(),
            },
        )
        .unwrap();
    assert!(paused.files.is_empty());
    assert_eq!(paused.merge_heads.len(), 1);
    let done = repo.commit(&paused, "Identical-tree merge");
    assert!(done.merge_heads.is_empty());
}
#[test]
fn merge_refuses_saved_changes_unknown_branches_autostash_and_stale_state() {
    let (repo, head, _) = merge_fixture();
    let initial = repo.status();
    repo.write("untracked.txt", "keep\n");
    let dirty = repo.status();
    assert!(repo
        .mutate(
            &dirty.revision,
            Action::MergeBranch {
                name: "feature/merge".into()
            }
        )
        .unwrap_err()
        .contains("untracked"));
    assert_eq!(repo.run(&["rev-parse", "HEAD"]).trim(), head);
    fs::remove_file(repo.0.join("untracked.txt")).unwrap();
    assert!(repo
        .mutate(
            &initial.revision,
            Action::MergeBranch {
                name: "missing".into()
            }
        )
        .is_err());
    assert!(repo
        .mutate(&initial.revision, Action::AbortMerge)
        .unwrap_err()
        .contains("no merge"));
    repo.write(".git/MERGE_AUTOSTASH", &head);
    assert_ne!(repo.status().revision, initial.revision);
    assert!(repo
        .mutate(
            &initial.revision,
            Action::MergeBranch {
                name: "feature/merge".into()
            }
        )
        .unwrap_err()
        .contains("Git state changed"));
    let state = repo.status();
    assert!(repo
        .mutate(
            &state.revision,
            Action::MergeBranch {
                name: "feature/merge".into()
            }
        )
        .unwrap_err()
        .contains("autostash"));
    assert_eq!(repo.run(&["rev-parse", "HEAD"]).trim(), head);
}
#[test]
fn merge_marker_changes_invalidate_reviews_and_non_root_completion_is_refused() {
    let (repo, _, _) = merge_fixture();
    repo.mutate(
        &repo.status().revision,
        Action::MergeBranch {
            name: "feature/merge".into(),
        },
    )
    .unwrap();
    let state = repo.status();
    repo.write(".git/MERGE_MSG", "Changed externally\n");
    assert_ne!(repo.status().revision, state.revision);
    assert!(repo.mutate(&state.revision, Action::AbortMerge).is_err());
    fs::create_dir(repo.0.join("nested")).unwrap();
    let nested = snapshot(&repo.0.join("nested"), 7, Instant::now() + READ_TIMEOUT).unwrap();
    assert!(nested
        .commit_unavailable_reason
        .unwrap()
        .contains("repository root"));
    assert!(merge::abort(
        &repo.0.join("nested"),
        &repo.status(),
        Instant::now() + WRITE_TIMEOUT
    )
    .unwrap_err()
    .contains("repository root"));
}

#[test]
fn saved_merge_resolution_drift_invalidates_abort_even_when_status_letters_match() {
    let (repo, _, _) = merge_fixture();
    repo.mutate(
        &repo.status().revision,
        Action::MergeBranch {
            name: "feature/merge".into(),
        },
    )
    .unwrap();
    repo.write("tracked.txt", "first resolution\n");
    let reviewed = repo.status();
    let letters = repo.run(&["--no-optional-locks", "status", "--porcelain=v1"]);
    repo.write("tracked.txt", "other resolution\n");
    assert_eq!(
        repo.run(&["--no-optional-locks", "status", "--porcelain=v1"]),
        letters
    );
    assert!(repo
        .mutate(&reviewed.revision, Action::AbortMerge)
        .unwrap_err()
        .contains("Git state changed"));
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "other resolution\n"
    );
    assert!(!repo.status().merge_heads.is_empty());
}

fn start_rebase(repo: &Repo, upstream: &str) -> Snapshot {
    let before = repo.status();
    let plan = rebase::plan(&repo.0, &before, upstream, Instant::now() + READ_TIMEOUT).unwrap();
    let value = serde_json::to_value(plan).unwrap();
    repo.mutate(
        &before.revision,
        Action::StartRebase {
            upstream: upstream.into(),
            plan_fingerprint: value["fingerprint"].as_str().unwrap().into(),
        },
    )
    .unwrap()
}
#[test]
fn real_rebase_review_pause_abort_and_resolution_preserve_original_messages_and_other_refs() {
    let (repo, original, target) = merge_fixture();
    let before = repo.status();
    let index = repo.index();
    let plan = rebase::plan(
        &repo.0,
        &before,
        "feature/merge",
        Instant::now() + READ_TIMEOUT,
    )
    .unwrap();
    let plan = serde_json::to_value(plan).unwrap();
    assert_eq!(plan["commits"].as_array().unwrap().len(), 1);
    assert_eq!(plan["originalHead"], original);
    assert_eq!(plan["onto"], target);
    assert_eq!(repo.index(), index);
    assert!(repo.status().rebase.is_none());
    let paused = start_rebase(&repo, "feature/merge");
    let state = serde_json::to_value(paused.rebase.as_ref().unwrap()).unwrap();
    assert_eq!(state["stoppedCommit"], original);
    assert_eq!(state["total"], 1);
    assert!(paused.files.iter().any(|v| v.conflict));
    assert!(repo
        .mutate(&paused.revision, Action::ContinueRebase)
        .unwrap_err()
        .contains("conflict"));
    let aborted = repo.mutate(&paused.revision, Action::AbortRebase).unwrap();
    assert!(aborted.rebase.is_none());
    assert_eq!(aborted.head.as_deref(), Some(original.as_str()));
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "ours\n"
    );
    start_rebase(&repo, "feature/merge");
    repo.write("tracked.txt", "resolved\n");
    repo.stage("tracked.txt");
    let done = repo
        .mutate(&repo.status().revision, Action::ContinueRebase)
        .unwrap();
    assert!(done.rebase.is_none());
    assert_eq!(repo.run(&["rev-parse", "HEAD^"]).trim(), target);
    assert_eq!(repo.run(&["log", "-1", "--format=%s"]).trim(), "Ours");
    assert_eq!(repo.run(&["show", "HEAD:tracked.txt"]), "resolved\n");
    assert_eq!(repo.run(&["rev-parse", "feature/merge"]).trim(), target);
}
#[test]
fn rebase_keeps_earlier_replayed_commits_and_pauses_without_executing_todo_commands() {
    let repo = Repo::new();
    repo.initial();
    let original = repo
        .run(&["symbolic-ref", "--short", "HEAD"])
        .trim()
        .to_owned();
    repo.run(&["switch", "-qc", "upstream"]);
    repo.write("tracked.txt", "upstream\n");
    repo.run(&["commit", "-qam", "Upstream"]);
    repo.run(&["switch", "-q", &original]);
    repo.write("first.txt", "first\n");
    repo.run(&["add", "first.txt"]);
    repo.run(&["commit", "-qm", "First"]);
    repo.write("tracked.txt", "local\n");
    repo.run(&["commit", "-qam", "Conflict"]);
    repo.write("last.txt", "last\n");
    repo.run(&["add", "last.txt"]);
    repo.run(&["commit", "-qm", "Last"]);
    let paused = start_rebase(&repo, "upstream");
    let state = serde_json::to_value(paused.rebase.as_ref().unwrap()).unwrap();
    assert_eq!(state["completed"], 2);
    assert_eq!(state["total"], 3);
    repo.write("tracked.txt", "resolved\n");
    repo.stage("tracked.txt");
    let done = repo
        .mutate(&repo.status().revision, Action::ContinueRebase)
        .unwrap();
    assert!(done.rebase.is_none());
    assert_eq!(
        repo.run(&["rev-list", "--count", "upstream..HEAD"]).trim(),
        "3"
    );
    assert_eq!(repo.run(&["show", "HEAD:first.txt"]), "first\n");
    assert_eq!(repo.run(&["show", "HEAD:last.txt"]), "last\n");
}
#[test]
fn a_reapplied_patch_that_becomes_empty_stops_until_explicit_skip() {
    let repo = Repo::new();
    repo.initial();
    let original = repo
        .run(&["symbolic-ref", "--short", "HEAD"])
        .trim()
        .to_owned();
    repo.run(&["switch", "-qc", "upstream"]);
    repo.write("tracked.txt", "same\n");
    repo.run(&["commit", "-qam", "Upstream version"]);
    let target = repo.run(&["rev-parse", "HEAD"]).trim().to_owned();
    repo.run(&["switch", "-q", &original]);
    repo.write("tracked.txt", "same\n");
    repo.run(&["commit", "-qam", "Local version"]);
    let paused = start_rebase(&repo, "upstream");
    assert!(paused.rebase.is_some());
    assert!(paused.files.is_empty());
    let done = repo.mutate(&paused.revision, Action::SkipRebase).unwrap();
    assert!(done.rebase.is_none());
    assert_eq!(done.head.as_deref(), Some(target.as_str()));
}
#[test]
fn rebase_review_and_pause_reject_stale_metadata_saved_resolution_and_unknown_plans() {
    let (repo, original, _) = merge_fixture();
    let before = repo.status();
    assert!(repo
        .mutate(
            &before.revision,
            Action::StartRebase {
                upstream: "feature/merge".into(),
                plan_fingerprint: "wrong".into()
            }
        )
        .is_err());
    assert_eq!(repo.run(&["rev-parse", "HEAD"]).trim(), original);
    let paused = start_rebase(&repo, "feature/merge");
    repo.write("tracked.txt", "first saved resolution\n");
    let reviewed = repo.status();
    repo.write("tracked.txt", "other saved resolution\n");
    assert!(repo
        .mutate(&reviewed.revision, Action::AbortRebase)
        .unwrap_err()
        .contains("Git state changed"));
    assert!(repo.mutate(&paused.revision, Action::SkipRebase).is_err());
    repo.write(
        ".git/rebase-merge/git-rebase-todo",
        "exec touch must-not-run\n",
    );
    assert!(snapshot(&repo.0, 7, Instant::now() + READ_TIMEOUT)
        .unwrap_err()
        .contains("unsupported"));
    assert!(!repo.0.join("must-not-run").exists());
}
#[test]
fn rebase_refuses_untracked_or_ignored_overwrites_and_a_merge_commit_replay_range() {
    let repo = Repo::new();
    repo.initial();
    repo.write(".gitignore", "empty-hooks/\nhook-ran\nIgnored.java\n");
    repo.run(&["add", ".gitignore"]);
    repo.run(&["commit", "-qm", "Ignore"]);
    let original = repo
        .run(&["symbolic-ref", "--short", "HEAD"])
        .trim()
        .to_owned();
    repo.run(&["switch", "-qc", "upstream"]);
    repo.write("Ignored.java", "upstream\n");
    repo.run(&["add", "-f", "Ignored.java"]);
    repo.run(&["commit", "-qm", "New"]);
    repo.run(&["switch", "-q", &original]);
    repo.write("Ignored.java", "private saved input\n");
    let before = repo.status();
    let plan = serde_json::to_value(
        rebase::plan(&repo.0, &before, "upstream", Instant::now() + READ_TIMEOUT).unwrap(),
    )
    .unwrap();
    assert!(repo
        .mutate(
            &before.revision,
            Action::StartRebase {
                upstream: "upstream".into(),
                plan_fingerprint: plan["fingerprint"].as_str().unwrap().into()
            }
        )
        .unwrap_err()
        .contains("ignored"));
    assert_eq!(
        fs::read_to_string(repo.0.join("Ignored.java")).unwrap(),
        "private saved input\n"
    );
    repo.write("untracked.txt", "keep\n");
    assert!(rebase::plan(
        &repo.0,
        &repo.status(),
        "upstream",
        Instant::now() + READ_TIMEOUT
    )
    .is_err());
    let (merged, _, _) = merge_fixture();
    merged.run(&["merge", "-s", "ours", "--no-edit", "feature/merge"]);
    assert!(rebase::plan(
        &merged.0,
        &merged.status(),
        "feature/merge",
        Instant::now() + READ_TIMEOUT
    )
    .unwrap_err()
    .contains("Merge commits"));
}

fn deletion_plan(repo: &Repo, name: &str) -> serde_json::Value {
    serde_json::to_value(
        branch_delete::plan(&repo.0, &repo.status(), name, Instant::now() + READ_TIMEOUT).unwrap(),
    )
    .unwrap()
}
fn deletion_action(plan: &serde_json::Value, confirmation: &str, force: bool) -> Action {
    Action::DeleteBranch {
        name: plan["name"].as_str().unwrap().into(),
        plan_fingerprint: plan["fingerprint"].as_str().unwrap().into(),
        confirmation: confirmation.into(),
        force,
    }
}
#[test]
fn reviewed_merged_branch_deletion_preserves_head_index_saved_files_and_unrelated_configuration() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "merged"]);
    repo.run(&[
        "config",
        "branch.merged.description",
        "Discarded branch metadata",
    ]);
    repo.run(&[
        "config",
        "remote.origin.url",
        "https://example.invalid/unchanged.git",
    ]);
    repo.write("tracked.txt", "staged content\n");
    repo.stage("tracked.txt");
    repo.write("tracked.txt", "retained saved content\n");
    let index = repo.index();
    let head = repo.run(&["rev-parse", "HEAD"]);
    let branch = repo.run(&["symbolic-ref", "HEAD"]);
    let plan = deletion_plan(&repo, "merged");
    assert_eq!(plan["commitsNotInHead"], 0);
    assert_eq!(plan["commitsTruncated"], false);
    assert!(repo.0.join(".git/logs/refs/heads/merged").exists());
    let after = repo
        .mutate(
            plan["revision"].as_str().unwrap(),
            deletion_action(&plan, "merged", false),
        )
        .unwrap();
    assert!(!after.local_branches.iter().any(|b| b.name == "merged"));
    assert!(!repo.0.join(".git/logs/refs/heads/merged").exists());
    assert_eq!(repo.run(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.run(&["symbolic-ref", "HEAD"]), branch);
    assert_eq!(repo.index(), index);
    assert_eq!(
        fs::read_to_string(repo.0.join("tracked.txt")).unwrap(),
        "retained saved content\n"
    );
    assert_eq!(
        repo.run(&["config", "--get", "remote.origin.url"]).trim(),
        "https://example.invalid/unchanged.git"
    );
    assert!(!fs::read_to_string(repo.0.join(".git/config"))
        .unwrap()
        .contains("Discarded branch metadata"));
}
#[test]
fn branch_deletion_requires_exact_confirmation_and_explicit_force_for_commits_outside_head() {
    let repo = Repo::new();
    repo.initial();
    let branch = repo
        .run(&["symbolic-ref", "--short", "HEAD"])
        .trim()
        .to_owned();
    repo.run(&["checkout", "--quiet", "-b", "unmerged"]);
    repo.write("Branch.java", "class Branch {}\n");
    repo.run(&["add", "--", "Branch.java"]);
    repo.run(&["commit", "--quiet", "-m", "Unmerged Java source"]);
    repo.run(&["checkout", "--quiet", &branch]);
    let plan = deletion_plan(&repo, "unmerged");
    assert_eq!(plan["commitsNotInHead"], 1);
    assert_eq!(plan["commits"][0]["subject"], "Unmerged Java source");
    let revision = plan["revision"].as_str().unwrap();
    assert!(repo
        .mutate(revision, deletion_action(&plan, "unmerged", false))
        .unwrap_err()
        .contains("explicitly allow"));
    assert!(repo
        .mutate(revision, deletion_action(&plan, "wrong name", true))
        .unwrap_err()
        .contains("exact reviewed branch name"));
    let result = repo
        .mutate(revision, deletion_action(&plan, "unmerged", true))
        .unwrap();
    assert!(!result.local_branches.iter().any(|b| b.name == "unmerged"));
    assert_eq!(
        repo.run(&["symbolic-ref", "--short", "HEAD"]).trim(),
        branch
    );
    assert!(!repo.0.join("Branch.java").exists());
    assert!(branch_delete::plan(
        &repo.0,
        &repo.status(),
        &branch,
        Instant::now() + READ_TIMEOUT
    )
    .is_err());
}
#[test]
fn branch_deletion_refuses_stale_plans_new_worktree_ownership_nested_roots_and_invalid_names() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "disposable"]);
    repo.write("tracked.txt", "new committed source\n");
    repo.run(&["add", "tracked.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Advance current branch"]);
    let old = deletion_plan(&repo, "disposable");
    repo.run(&["branch", "-f", "disposable", "HEAD"]);
    assert_eq!(
        repo.mutate(
            old["revision"].as_str().unwrap(),
            deletion_action(&old, "disposable", true)
        )
        .unwrap_err(),
        STALE
    );
    assert_eq!(
        repo.mutate(
            &repo.status().revision,
            deletion_action(&old, "disposable", true)
        )
        .unwrap_err(),
        STALE
    );
    let plan = deletion_plan(&repo, "disposable");
    let linked = repo.0.with_extension("linked\nworktree");
    repo.run(&[
        "worktree",
        "add",
        "--quiet",
        linked.to_str().unwrap(),
        "disposable",
    ]);
    assert!(repo
        .mutate(
            plan["revision"].as_str().unwrap(),
            deletion_action(&plan, "disposable", true)
        )
        .unwrap_err()
        .contains("worktree"));
    repo.run(&["worktree", "remove", "--force", linked.to_str().unwrap()]);
    for name in ["missing", "--all", "../outside"] {
        assert!(
            branch_delete::plan(&repo.0, &repo.status(), name, Instant::now() + READ_TIMEOUT)
                .is_err()
        );
    }
    let nested = repo.0.join("nested");
    fs::create_dir(&nested).unwrap();
    assert!(branch_delete::plan(
        &nested,
        &repo.status(),
        "disposable",
        Instant::now() + READ_TIMEOUT
    )
    .unwrap_err()
    .contains("repository root"));
}
#[test]
fn branch_delete_review_reports_complete_unmerged_count_and_explicitly_bounded_commit_list() {
    let repo = Repo::new();
    repo.initial();
    let branch = repo
        .run(&["symbolic-ref", "--short", "HEAD"])
        .trim()
        .to_owned();
    repo.run(&["checkout", "--quiet", "-b", "long-history"]);
    for n in 0..201 {
        repo.run(&[
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            &format!("Unmerged commit {n}"),
        ]);
    }
    repo.run(&["checkout", "--quiet", &branch]);
    let plan = deletion_plan(&repo, "long-history");
    assert_eq!(plan["commitsNotInHead"], 201);
    assert_eq!(plan["commits"].as_array().unwrap().len(), 200);
    assert_eq!(plan["commitsTruncated"], true);
}
#[test]
fn branch_deletion_checks_target_head_and_symbolic_head_identity_in_one_git_transaction() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "disposable"]);
    let before = repo.status();
    let old = before.head.clone().unwrap();
    repo.write("tracked.txt", "advanced\n");
    repo.run(&["add", "tracked.txt"]);
    repo.run(&["commit", "--quiet", "-m", "Advance HEAD"]);
    let new = repo.status().head.unwrap();
    assert!(branch_delete::delete_ref(
        &repo.0,
        &before,
        "disposable",
        &old,
        Instant::now() + WRITE_TIMEOUT
    )
    .is_err());
    assert!(repo
        .status()
        .local_branches
        .iter()
        .any(|b| b.name == "disposable"));
    let before = repo.status();
    repo.run(&["branch", "-f", "disposable", &new]);
    assert!(branch_delete::delete_ref(
        &repo.0,
        &before,
        "disposable",
        &old,
        Instant::now() + WRITE_TIMEOUT
    )
    .is_err());
    // A switch to a branch at the same object must fail the symbolic HEAD check.
    let before = repo.status();
    repo.run(&["checkout", "--quiet", "disposable"]);
    assert!(branch_delete::delete_ref(
        &repo.0,
        &before,
        "disposable",
        &new,
        Instant::now() + WRITE_TIMEOUT
    )
    .is_err());
    assert_eq!(
        repo.run(&["symbolic-ref", "--short", "HEAD"]).trim(),
        "disposable"
    );
    repo.run(&["symbolic-ref", "refs/heads/alias", "refs/heads/disposable"]);
    assert!(branch_delete::plan(
        &repo.0,
        &repo.status(),
        "alias",
        Instant::now() + READ_TIMEOUT
    )
    .unwrap_err()
    .contains("Symbolic local branches"));
}
#[test]
fn branch_delete_reports_configuration_failure_as_partial_after_reference_removal() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "disposable"]);
    repo.run(&[
        "config",
        "branch.disposable.description",
        "Retained when locked",
    ]);
    let plan = deletion_plan(&repo, "disposable");
    let head = repo.run(&["rev-parse", "HEAD"]);
    let index = repo.index();
    fs::write(repo.0.join(".git/config.lock"), "fixture owned lock\n").unwrap();
    let error = repo
        .mutate(
            plan["revision"].as_str().unwrap(),
            deletion_action(&plan, "disposable", false),
        )
        .unwrap_err();
    assert!(error.contains("reference was deleted"));
    assert!(error.contains("not rolled back"));
    assert!(!repo
        .status()
        .local_branches
        .iter()
        .any(|b| b.name == "disposable"));
    assert_eq!(repo.run(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.index(), index);
    assert_eq!(
        repo.run(&["config", "--get", "branch.disposable.description"])
            .trim(),
        "Retained when locked"
    );
}

#[test]
fn reviewed_branch_deletion_supports_detached_head_and_sha256_object_ids() {
    let repo = Repo::with_format("sha256");
    repo.initial();
    repo.run(&["branch", "feature.topic"]);
    repo.run(&[
        "config",
        "branch.feature.topic.description",
        "Remove exact subsection",
    ]);
    repo.run(&[
        "config",
        "branch.feature.topic.other.description",
        "Keep neighboring subsection",
    ]);
    repo.run(&["checkout", "--quiet", "--detach", "HEAD"]);
    let plan = deletion_plan(&repo, "feature.topic");
    assert_eq!(plan["branchHead"].as_str().unwrap().len(), 64);
    let after = repo
        .mutate(
            plan["revision"].as_str().unwrap(),
            deletion_action(&plan, "feature.topic", false),
        )
        .unwrap();
    assert!(after.branch.is_none());
    assert_eq!(after.head.as_deref(), plan["currentHead"].as_str());
    assert!(!after
        .local_branches
        .iter()
        .any(|branch| branch.name == "feature.topic"));
    assert_eq!(
        repo.run(&["config", "--get", "branch.feature.topic.other.description"])
            .trim(),
        "Keep neighboring subsection"
    );
    assert!(!fs::read_to_string(repo.0.join(".git/config"))
        .unwrap()
        .contains("Remove exact subsection"));
}

#[test]
fn branch_delete_reports_unknown_outcome_when_a_committed_hook_floods_the_transport() {
    let repo = Repo::new();
    repo.initial();
    repo.run(&["branch", "disposable"]);
    let plan = deletion_plan(&repo, "disposable");
    let head = repo.run(&["rev-parse", "HEAD"]);
    let index = repo.index();
    let hook = repo.0.join("empty-hooks/reference-transaction");
    fs::write(&hook,"#!/bin/sh\nif [ \"$1\" = committed ]; then\n  printf done > .git/deletion-committed\n  while :; do printf '%01024d' 0; done\nfi\n".replace("\\n","\n")).unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
    let error = repo
        .mutate(
            plan["revision"].as_str().unwrap(),
            deletion_action(&plan, "disposable", false),
        )
        .unwrap_err();
    assert!(error.contains("may already have been deleted"));
    assert!(error.contains("No rollback is confirmed"));
    assert!(repo.0.join(".git/deletion-committed").exists());
    assert!(!repo
        .status()
        .local_branches
        .iter()
        .any(|b| b.name == "disposable"));
    assert_eq!(repo.run(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.index(), index);
}
