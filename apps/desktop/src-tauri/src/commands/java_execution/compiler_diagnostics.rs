//! Bounded source locations reported by compiler-style tool output, not semantic analysis.
use regex::Regex;
use serde::Serialize;
use std::path::Path;
use std::sync::OnceLock;

const MAX_ITEMS: usize = 100;
const MAX_LINE: usize = 8192;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Diagnostic {
    pub path: String,
    pub line: u32,
    pub reported_column: Option<u32>,
    pub severity: String,
    pub message: String,
}

#[derive(Clone, Default, Serialize)]
pub(super) struct Report {
    pub items: Vec<Diagnostic>,
    pub truncated: bool,
}

impl Report {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty() && !self.truncated
    }
    pub fn record(&mut self, item: Option<Diagnostic>, omitted: bool) {
        self.truncated |= omitted;
        if let Some(item) = item {
            if self.items.contains(&item) {
                return;
            }
            if self.items.len() == MAX_ITEMS {
                self.truncated = true;
            } else {
                self.items.push(item);
            }
        }
    }
}

fn parse(root: &Path, directory: &Path, bytes: &[u8]) -> Option<Diagnostic> {
    let text = std::str::from_utf8(bytes).ok()?.trim_end_matches('\r');
    static ANSI: OnceLock<Regex> = OnceLock::new();
    let text = ANSI
        .get_or_init(|| Regex::new(r"\x1b\[[0-9;]*m").unwrap())
        .replace_all(text, "");
    if text.chars().any(char::is_control) {
        return None;
    }
    static MAVEN: OnceLock<Regex> = OnceLock::new();
    static JAVAC: OnceLock<Regex> = OnceLock::new();
    let maven = MAVEN.get_or_init(|| {
        Regex::new(r"^\[(ERROR|WARNING)\] (.+\.java):\[([0-9]+),([0-9]+)\] (.+)$").unwrap()
    });
    let javac =
        JAVAC.get_or_init(|| Regex::new(r"^(.+\.java):([0-9]+): (error|warning): (.+)$").unwrap());
    let (file, line, column, severity, message) = if let Some(c) = maven.captures(&text) {
        (
            c[2].to_owned(),
            c[3].parse::<u32>().ok()?,
            Some(c[4].parse::<u32>().ok()?),
            c[1].to_lowercase(),
            c[5].to_owned(),
        )
    } else if let Some(c) = javac.captures(&text) {
        (
            c[1].to_owned(),
            c[2].parse::<u32>().ok()?,
            None,
            c[3].to_owned(),
            c[4].to_owned(),
        )
    } else {
        return None;
    };
    if line == 0
        || line > i32::MAX as u32
        || column.is_some_and(|v| v == 0 || v > i32::MAX as u32)
        || file.len() > 4096
        || message.len() > 2048
    {
        return None;
    }
    let candidate = directory.join(file).canonicalize().ok()?;
    if !candidate.is_file() {
        return None;
    }
    let relative = candidate.strip_prefix(root).ok()?;
    let path = relative.to_str()?.replace(std::path::MAIN_SEPARATOR, "/");
    if path.is_empty()
        || path.len() > 4096
        || path.contains(['\\', ':', '\0'])
        || !path.ends_with(".java")
    {
        return None;
    }
    Some(Diagnostic {
        path,
        line,
        reported_column: column,
        severity,
        message,
    })
}

/// Each stdout/stderr pipe owns its byte buffer, so split UTF-8 and concurrent streams do not mix.
#[derive(Default)]
pub(super) struct Stream {
    pending: Vec<u8>,
    discarding: bool,
}
impl Stream {
    pub fn push(
        &mut self,
        bytes: &[u8],
        root: &Path,
        directory: &Path,
        mut emit: impl FnMut(Option<Diagnostic>, bool),
    ) {
        for byte in bytes {
            if *byte == b'\n' {
                if !self.discarding {
                    emit(parse(root, directory, &self.pending), false);
                }
                self.pending.clear();
                self.discarding = false;
            } else if !self.discarding {
                if self.pending.len() == MAX_LINE {
                    self.pending.clear();
                    self.discarding = true;
                    emit(None, true);
                } else {
                    self.pending.push(*byte);
                }
            }
        }
    }
    pub fn finish(
        &mut self,
        root: &Path,
        directory: &Path,
        emit: impl FnOnce(Option<Diagnostic>, bool),
    ) {
        if !self.discarding && !self.pending.is_empty() {
            emit(parse(root, directory, &self.pending), false);
        }
        self.pending.clear();
        self.discarding = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    struct TestDirectory(std::path::PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ide-compiler-locations-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn streamed_tool_locations_use_real_invocation_directory_and_workspace_containment() {
        let temp = TestDirectory::new();
        let root = temp.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("module/src")).unwrap();
        fs::write(root.join("module/src/Café.java"), "class Café {}\n").unwrap();
        let directory = root.join("module");
        let mut report = Report::default();
        let mut stream = Stream::default();
        let output = "\u{1b}[31m[ERROR] src/Café.java:[2,7] cannot find symbol\u{1b}[0m\r\nsrc/Café.java:3: warning: unchecked conversion";
        for byte in output.as_bytes() {
            stream.push(&[*byte], &root, &directory, |d, t| report.record(d, t));
        }
        stream.finish(&root, &directory, |d, t| report.record(d, t));
        assert_eq!(report.items.len(), 2);
        assert_eq!(report.items[0].path, "module/src/Café.java");
        assert_eq!(report.items[0].reported_column, Some(7));
        assert_eq!(report.items[0].severity, "error");
        assert_eq!(report.items[1].line, 3);
        assert_eq!(report.items[1].severity, "warning");
        assert!(!report.truncated);
        let outside = TestDirectory::new();
        fs::write(outside.path().join("Other.java"), "class Other {}\n").unwrap();
        assert!(parse(
            &root,
            &directory,
            format!(
                "{}:1: error: no",
                outside.path().join("Other.java").display()
            )
            .as_bytes()
        )
        .is_none());
        assert!(parse(&root, &directory, b"src/Missing.java:1: error: no").is_none());
        assert!(parse(&root, &directory, b"src/Caf.java:0: error: no").is_none());
    }
    #[test]
    fn oversized_lines_are_discarded_and_reports_are_bounded_and_deduplicated() {
        let temp = TestDirectory::new();
        let root = temp.path().canonicalize().unwrap();
        fs::write(root.join("Main.java"), "class Main {}\n").unwrap();
        let mut report = Report::default();
        let mut stream = Stream::default();
        let mut output = vec![b'x'; MAX_LINE + 1];
        output.extend_from_slice(b"Main.java:1: error: forged suffix\n");
        for line in 1..=101 {
            output.extend_from_slice(
                format!("Main.java:{line}: error: failed\nMain.java:{line}: error: failed\n")
                    .as_bytes(),
            );
        }
        stream.push(&output, &root, &root, |d, t| report.record(d, t));
        assert_eq!(report.items.len(), MAX_ITEMS);
        assert!(report.truncated);
        assert_eq!(report.items[0].message, "failed");
    }
}
