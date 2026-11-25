use super::*;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-git-review-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let repo = Self(root);
        repo.git(&["init", "--quiet"]);
        repo.git(&["config", "user.name", "IDE Fixture"]);
        repo.git(&["config", "user.email", "fixture@example.invalid"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo.git(&["config", "core.hooksPath", "/dev/null"]);
        repo
    }
    fn git(&self, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.0)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn file(&self, name: &str, content: &str) {
        let path = self.0.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
    fn commit(&self, names: &[&str]) {
        let mut args = vec!["--literal-pathspecs", "add", "--"];
        args.extend_from_slice(names);
        self.git(&args);
        self.git(&["commit", "--quiet", "-m", "Fixture baseline"]);
    }
    fn program(&self, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = self.0.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn exact_unicode_whitespace_arrow_and_newline_paths_reach_diff() {
    let repo = Repo::new();
    let names = [
        "caffè name.java",
        " leading.java ",
        "arrow -> name.java",
        "line\nbreak.java",
    ];
    for name in names {
        repo.file(name, "class Before {}\n");
    }
    repo.commit(&names);
    for name in names {
        repo.file(name, "class After {}\n");
    }
    let listed = list_modified_in_root(&repo.0).unwrap();
    for name in names {
        assert!(
            listed.as_array().unwrap().contains(&json!(name)),
            "missing exact path {name:?}: {listed}"
        );
        assert_eq!(diff_in_root(&repo.0, name).unwrap()["kind"], "ok");
    }
}

#[test]
fn a_literal_pathspec_never_includes_a_sibling_diff() {
    let repo = Repo::new();
    let name = ":(glob)*.java";
    for path in [name, "Sibling.java"] {
        repo.file(path, "class Before {}\n");
    }
    repo.commit(&[name, "Sibling.java"]);
    repo.file(name, "class Selected {}\n");
    repo.file("Sibling.java", "class Unrelated {}\n");
    let diff = diff_in_root(&repo.0, name).unwrap();
    assert_eq!(diff["kind"], "ok");
    assert!(!diff.to_string().contains("Unrelated"));
}

#[test]
fn a_nested_workspace_returns_only_its_relative_paths() {
    let repo = Repo::new();
    for path in ["Top.java", "module/Main.java"] {
        repo.file(path, "class Before {}\n");
    }
    repo.commit(&["Top.java", "module/Main.java"]);
    for path in ["Top.java", "module/Main.java"] {
        repo.file(path, "class After {}\n");
    }
    let root = repo.0.join("module");
    assert_eq!(list_modified_in_root(&root).unwrap(), json!(["Main.java"]));
    assert_eq!(diff_in_root(&root, "Main.java").unwrap()["kind"], "ok");
    assert_eq!(
        diff_in_root(&root, "../Top.java").unwrap()["kind"],
        "unavailable"
    );
}

#[test]
fn missing_repository_is_an_error_instead_of_a_clean_list() {
    let root = std::env::temp_dir().join(format!("ide-not-git-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    assert!(list_modified_in_root(&root).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn status_does_not_refresh_index_or_invoke_fsmonitor() {
    let repo = Repo::new();
    repo.file("Main.java", "class Before {}\n");
    repo.commit(&["Main.java"]);
    let before = fs::read(repo.0.join(".git/index")).unwrap();
    fs::File::open(repo.0.join("Main.java"))
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(10))
        .unwrap();
    let program = repo.program("monitor.sh", "printf ran > monitor-ran");
    repo.git(&["config", "core.fsmonitor", program.to_str().unwrap()]);
    list_modified_in_root(&repo.0).unwrap();
    assert!(!repo.0.join("monitor-ran").exists());
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), before);
}

#[test]
fn diff_does_not_invoke_text_conversion_or_external_diff() {
    let repo = Repo::new();
    repo.file("Main.java", "class Before {}\n");
    repo.file(".gitattributes", "*.java diff=fixture\n");
    repo.commit(&["Main.java", ".gitattributes"]);
    let converter = repo.program("converter.sh", "printf ran > converter-ran\ncat \"$1\"");
    let external = repo.program("external.sh", "printf ran > external-ran");
    repo.git(&[
        "config",
        "diff.fixture.textconv",
        converter.to_str().unwrap(),
    ]);
    repo.git(&["config", "diff.external", external.to_str().unwrap()]);
    repo.file("Main.java", "class After {}\n");
    assert_eq!(diff_in_root(&repo.0, "Main.java").unwrap()["kind"], "ok");
    assert!(!repo.0.join("converter-ran").exists());
    assert!(!repo.0.join("external-ran").exists());
}

#[test]
fn a_hunk_marker_inside_source_text_is_not_another_hunk() {
    let text = "@@ -1 +1 @@\n-before\n+String value = \"@@ -99 +99 @@\";\n";
    assert_eq!(parse_hunks(text).len(), 1);
}
