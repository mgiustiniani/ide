use super::*;
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Repo(PathBuf);
impl Repo {
    fn new(format: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-blame-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        let repo = Self(root.canonicalize().unwrap());
        repo.git(&[
            "-c",
            "init.templateDir=",
            "init",
            "--quiet",
            &format!("--object-format={format}"),
        ]);
        fs::create_dir(repo.0.join("empty-hooks")).unwrap();
        for (key, value) in [
            ("user.name", "First Author"),
            ("user.email", "fixture@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "empty-hooks"),
            ("core.autocrlf", "false"),
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
    fn commit(&self, path: &str, message: &str) {
        self.git(&["add", "--", path]);
        self.git(&["commit", "--quiet", "-m", message]);
    }
    fn request(&self, path: &str) -> BlameRequest {
        BlameRequest {
            workspace_path: self.0.to_str().unwrap().into(),
            trusted: true,
            activation: 7,
            revision: snapshot(&self.0, 7, Instant::now() + READ_TIMEOUT)
                .unwrap()
                .revision,
            path: path.into(),
            start_line: 1,
            saved_fingerprint: None,
        }
    }
    fn blame(&self, request: &BlameRequest) -> Result<Blame, String> {
        read_in_root(&self.0, request, Instant::now() + READ_TIMEOUT)
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn real_saved_blame_keeps_index_sources_and_configuration_and_distinguishes_uncommitted_text() {
    let repo = Repo::new("sha1");
    repo.write("Main.java", "one\ntwo\nthree\n");
    repo.commit("Main.java", "Original source");
    let first = repo.git(&["rev-parse", "HEAD"]).trim().to_owned();
    repo.git(&["config", "user.name", "Second Author"]);
    repo.write("Main.java", "one\nsecond\nthree\n");
    repo.commit("Main.java", "Second source");
    let second = repo.git(&["rev-parse", "HEAD"]).trim().to_owned();
    repo.write("Main.java", "one\nsecond\nsaved change\n");
    let index = fs::read(repo.0.join(".git/index")).unwrap();
    let config = fs::read(repo.0.join(".git/config")).unwrap();
    let bytes = fs::read(repo.0.join("Main.java")).unwrap();
    let result = repo.blame(&repo.request("Main.java")).unwrap();
    assert_eq!(result.lines.len(), 3);
    assert_eq!(result.lines[0].commit.as_deref(), Some(first.as_str()));
    assert_eq!(result.lines[1].commit.as_deref(), Some(second.as_str()));
    assert_eq!(result.lines[0].author.as_deref(), Some("First Author"));
    assert_eq!(result.lines[1].author.as_deref(), Some("Second Author"));
    assert!(
        result.lines[2].commit.is_none()
            && result.lines[2].author.is_none()
            && result.lines[2].author_time.is_none()
    );
    assert_eq!(result.lines[2].summary, "Uncommitted saved text");
    assert_eq!(result.lines[2].text, "saved change");
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("ide-git-message"));
    assert_eq!(fs::read(repo.0.join(".git/index")).unwrap(), index);
    assert_eq!(fs::read(repo.0.join(".git/config")).unwrap(), config);
    assert_eq!(fs::read(repo.0.join("Main.java")).unwrap(), bytes);
}
#[test]
fn pagination_captures_the_whole_saved_version_and_rejects_drift_with_unchanged_git_status() {
    let repo = Repo::new("sha1");
    let text = (1..=450).map(|n| format!("line {n}\n")).collect::<String>();
    repo.write("Main.java", &text);
    repo.commit("Main.java", "Large source");
    repo.write("Main.java", &text.replace("line 201\n", "save 201\n"));
    let mut request = repo.request("Main.java");
    let first = repo.blame(&request).unwrap();
    assert_eq!(first.lines.len(), 200);
    assert_eq!(first.total_lines, 450);
    request.start_line = 201;
    request.saved_fingerprint = Some(first.saved_fingerprint.clone());
    let second = repo.blame(&request).unwrap();
    assert_eq!(second.lines[0].line, 201);
    assert!(second.lines[0].commit.is_none());
    repo.write(
        "Main.java",
        &text
            .replace("line 201\n", "save 201\n")
            .replace("line 202\n", "edit 202\n"),
    );
    assert_eq!(repo.request("Main.java").revision, request.revision);
    assert_eq!(repo.blame(&request).unwrap_err(), SOURCE_CHANGED);
    request = repo.request("Main.java");
    request.start_line = 401;
    assert_eq!(repo.blame(&request).unwrap().lines.len(), 50);
    request.start_line = 451;
    assert!(repo.blame(&request).is_err());
}
#[test]
fn supports_sha256_literal_unicode_newline_paths_and_empty_committed_files() {
    let repo = Repo::new("sha256");
    let path = "src/caffè\n-literal.java";
    repo.write(path, "UTF-8 café\n");
    repo.commit(path, "Literal source");
    let result = repo.blame(&repo.request(path)).unwrap();
    assert_eq!(result.lines[0].commit.as_ref().unwrap().len(), 64);
    assert_eq!(result.lines[0].text, "UTF-8 café");
    repo.write("empty.java", "");
    repo.commit("empty.java", "Empty source");
    let result = repo.blame(&repo.request("empty.java")).unwrap();
    assert!(result.lines.is_empty());
    assert_eq!(result.total_lines, 0);
}
#[test]
fn rejects_unborn_untracked_binary_oversized_and_symlinked_inputs_without_mutation() {
    use std::os::unix::fs::symlink;
    let repo = Repo::new("sha1");
    repo.write("Main.java", "text\n");
    assert!(repo.blame(&repo.request("Main.java")).is_err());
    repo.commit("Main.java", "Source");
    repo.write("new.java", "untracked\n");
    assert!(repo.blame(&repo.request("new.java")).is_err());
    for data in [vec![0, 1], vec![255], vec![b'x'; MAX_SOURCE as usize + 1]] {
        fs::write(repo.0.join("Main.java"), data.clone()).unwrap();
        assert!(repo.blame(&repo.request("Main.java")).is_err());
        assert_eq!(fs::read(repo.0.join("Main.java")).unwrap(), data);
    }
    symlink("Main.java", repo.0.join("link.java")).unwrap();
    assert!(repo.blame(&repo.request("link.java")).is_err());
    let outside = Repo::new("sha1");
    outside.write("secret.java", "outside\n");
    symlink(&outside.0, repo.0.join("escape")).unwrap();
    assert!(repo.blame(&repo.request("escape/secret.java")).is_err());
    let mut request = repo.request("Main.java");
    request.path = "../outside.java".into();
    assert!(repo.blame(&request).is_err());
}
#[test]
fn refuses_stale_git_revisions_and_preserves_crlf_display_line_identity() {
    let repo = Repo::new("sha1");
    repo.write("Main.java", "first\r\nsecond\r\n");
    repo.commit("Main.java", "CRLF source");
    let request = repo.request("Main.java");
    let result = repo.blame(&request).unwrap();
    assert_eq!(result.lines[1].text, "second");
    repo.git(&["branch", "new-reference"]);
    assert_eq!(repo.blame(&request).unwrap_err(), STALE);
}
#[test]
#[cfg(target_os = "linux")]
fn refuses_saved_text_changed_by_a_real_git_clean_filter_during_attribution() {
    use std::os::unix::fs::PermissionsExt;
    let repo = Repo::new("sha1");
    repo.write("Main.java", "original\n");
    repo.commit("Main.java", "Source");
    repo.write("Main.java", "saved old\n");
    let script = repo.0.join("change-filter.sh");
    fs::write(&script,b"#!/bin/sh\ncase \"$(tr '\\000' ' ' < /proc/$PPID/cmdline)\" in\n  *' blame '*) printf 'external change\\n' > Main.java ;;\nesac\ncat\n").unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    repo.write(".gitattributes", "Main.java filter=change-during-blame\n");
    repo.git(&[
        "config",
        "filter.change-during-blame.clean",
        script.to_str().unwrap(),
    ]);
    let request = repo.request("Main.java");
    assert_eq!(repo.blame(&request).unwrap_err(), SOURCE_CHANGED);
    assert_eq!(
        fs::read_to_string(repo.0.join("Main.java")).unwrap(),
        "external change\n"
    );
}
#[test]
fn porcelain_parser_refuses_wrong_lines_text_missing_metadata_and_truncation() {
    for raw in [
        "",
        "not porcelain\n",
        "0000000000000000000000000000000000000000 1 1 1\n\ttext\n",
    ] {
        assert!(parse(raw, &["text"], 1, 1).is_err());
    }
    let record="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1\nauthor Author\nauthor-time 0\nsummary Summary\nfilename file\n\ttext\n";
    assert!(parse(record, &["different"], 1, 1).is_err());
    assert!(parse(record, &["text"], 2, 1).is_err());
    assert!(parse(record.trim_end_matches("\ttext\n"), &["text"], 1, 1).is_err());
    assert_eq!(parse(record, &["text"], 1, 1).unwrap()[0].text, "text");
}
