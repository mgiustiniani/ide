use super::*;
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Repo(PathBuf);
impl Repo {
    fn new(format: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-history-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let repo = Self(root.canonicalize().unwrap());
        repo.git(&[
            "-c",
            "init.templateDir=",
            "init",
            "--quiet",
            &format!("--object-format={format}"),
            "--initial-branch=main",
        ]);
        fs::create_dir(repo.0.join("empty-hooks")).unwrap();
        for (key, value) in [
            ("user.name", "History Author"),
            ("user.email", "fixture@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.autocrlf", "false"),
            ("core.hooksPath", "empty-hooks"),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }
    fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.0)
            .env_remove("GIT_INDEX_FILE")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
    fn commit(&self, path: &str, text: &str, message: &str) {
        let target = self.0.join(path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, text).unwrap();
        self.git(&["add", "--", path]);
        self.git(&["commit", "--quiet", "-m", message]);
    }
    fn request(&self, path: Option<&str>) -> HistoryRequest {
        let state = snapshot(&self.0, 7, Instant::now() + READ_TIMEOUT).unwrap();
        HistoryRequest {
            workspace_path: self.0.to_string_lossy().into(),
            trusted: true,
            activation: 7,
            revision: state.revision,
            head: state.head.unwrap(),
            path: path.map(str::to_owned),
            offset: 0,
        }
    }
    fn history(&self, r: &HistoryRequest) -> Result<History, String> {
        read_in_root(&self.0, r, Instant::now() + READ_TIMEOUT)
    }
    fn review(&self, r: &HistoryRequest, commit: &str) -> Result<CommitReview, String> {
        review_in_root(
            &self.0,
            &CommitRequest {
                workspace_path: r.workspace_path.clone(),
                trusted: r.trusted,
                activation: r.activation,
                revision: r.revision.clone(),
                head: r.head.clone(),
                path: r.path.clone(),
                offset: r.offset,
                commit: commit.into(),
            },
            Instant::now() + READ_TIMEOUT,
        )
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn real_history_pages_past_fifty_and_reviews_root_without_changing_sources_index_or_configuration()
{
    let repo = Repo::new("sha1");
    for n in 0..103 {
        repo.commit(
            "src/Main.java",
            &format!("// version {n}\n"),
            &format!("Java change {n:03} caffè"),
        );
    }
    fs::write(
        repo.0.join("src/Main.java"),
        "// saved uncommitted change\n",
    )
    .unwrap();
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    let config = fs::read(repo.0.join(".git/config")).unwrap();
    let mut request = repo.request(None);
    let first = repo.history(&request).unwrap();
    assert_eq!(first.commits.len(), 50);
    assert_eq!(first.next_offset, Some(50));
    assert_eq!(first.commits[0].subject, "Java change 102 caffè");
    request.offset = 50;
    let second = repo.history(&request).unwrap();
    assert_eq!(second.commits.len(), 50);
    assert_eq!(second.next_offset, Some(100));
    assert_eq!(second.commits[0].subject, "Java change 052 caffè");
    assert!(repo.review(&request, &first.commits[0].id).is_err());
    request.offset = 100;
    let last = repo.history(&request).unwrap();
    assert_eq!(last.commits.len(), 3);
    assert!(last.next_offset.is_none());
    let review = repo.review(&request, &last.commits[2].id).unwrap();
    assert!(review.text.contains("+// version 0"));
    assert!(review.text.contains("new file mode"));
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
    assert_eq!(
        fs::read_to_string(repo.0.join("src/Main.java")).unwrap(),
        "// saved uncommitted change\n"
    );
    request.offset = 1;
    assert!(repo.history(&request).is_err());
    request.offset = 0;
    request.trusted = false;
    assert!(repo.history(&request).is_err());
    request.trusted = true;
    request.head = "a".repeat(40);
    assert!(repo.history(&request).is_err());
    request.head = first.head;
    repo.commit("src/Main.java", "// later\n", "Later commit");
    assert_eq!(repo.history(&request).unwrap_err(), STALE);
}
#[test]
fn literal_deleted_paths_sha256_and_nested_workspaces_keep_history_and_patches_in_scope() {
    let repo = Repo::new("sha256");
    let special = "module/:(glob)* caffè.java";
    repo.commit(
        special,
        "// historical Unicode source\n",
        "Create literal file",
    );
    repo.commit("outside.java", "// outside scope\n", "Outside change");
    repo.git(&["rm", "--", special]);
    repo.git(&["commit", "--quiet", "-m", "Delete literal file"]);
    let r = repo.request(Some(special));
    let page = repo.history(&r).unwrap();
    assert_eq!(page.commits.len(), 2);
    assert_eq!(page.head.len(), 64);
    assert!(!repo
        .review(&r, &page.commits[0].id)
        .unwrap()
        .text
        .contains("outside.java"));
    let nested = repo.0.join("module");
    fs::create_dir_all(&nested).unwrap();
    let mut r = repo.request(None);
    r.workspace_path = nested.to_string_lossy().into();
    r.revision = snapshot(&nested, 7, Instant::now() + READ_TIMEOUT)
        .unwrap()
        .revision;
    let page = read_in_root(&nested, &r, Instant::now() + READ_TIMEOUT).unwrap();
    assert_eq!(page.commits.len(), 2);
    let r = CommitRequest {
        workspace_path: r.workspace_path,
        trusted: true,
        activation: 7,
        revision: r.revision,
        head: r.head,
        path: None,
        offset: 0,
        commit: page.commits[1].id.clone(),
    };
    let patch = review_in_root(&nested, &r, Instant::now() + READ_TIMEOUT).unwrap();
    assert!(patch.text.contains("historical Unicode"));
    assert!(!patch.text.contains("outside scope"));
    let mut r = repo.request(Some("../outside.java"));
    assert!(repo.history(&r).is_err());
    r.path = Some("/etc/passwd".into());
    assert!(repo.history(&r).is_err());
}
#[test]
fn merge_review_uses_first_parent_and_never_executes_external_diff_or_text_conversion() {
    use std::os::unix::fs::PermissionsExt;
    let repo = Repo::new("sha1");
    repo.commit("Main.java", "// base\n", "Base");
    repo.git(&["checkout", "--quiet", "-b", "topic"]);
    repo.commit("Main.java", "// topic\n", "Topic change");
    repo.git(&["checkout", "--quiet", "main"]);
    repo.commit("Other.java", "// main\n", "Main change");
    repo.git(&["merge", "--quiet", "--no-ff", "topic", "-m", "Merge topic"]);
    let script = repo.0.join("hostile-diff");
    fs::write(&script, "#!/bin/sh\ntouch diff-was-run\nexit 1\n").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    repo.git(&["config", "diff.external", script.to_str().unwrap()]);
    repo.git(&["config", "diff.hostile.textconv", script.to_str().unwrap()]);
    fs::create_dir_all(repo.0.join(".git/info")).unwrap();
    fs::write(repo.0.join(".git/info/attributes"), "*.java diff=hostile\n").unwrap();
    let r = repo.request(None);
    let page = repo.history(&r).unwrap();
    let patch = repo.review(&r, &page.commits[0].id).unwrap();
    assert!(patch.text.contains("-// base"));
    assert!(patch.text.contains("+// topic"));
    assert!(!patch.text.contains("+// main"));
    assert!(!repo.0.join("diff-was-run").exists());
    assert!(repo.review(&r, &"a".repeat(40)).is_err());
    assert!(repo.review(&r, "--all").is_err());
}
