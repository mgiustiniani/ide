//! Saved-source attribution. Git owns history; the editor's current draft is never read.
use super::*;
use crate::workspace::resolve_existing_path_in_root;
const MAX_SOURCE: u64 = 512 * 1024;
const PAGE_LINES: usize = 200;
const SOURCE_CHANGED: &str = "The saved file changed. Refresh Git and request blame again.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlameRequest {
    workspace_path: String,
    trusted: bool,
    activation: u64,
    revision: String,
    path: String,
    start_line: usize,
    saved_fingerprint: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    line: usize,
    commit: Option<String>,
    author: Option<String>,
    author_time: Option<i64>,
    summary: String,
    text: String,
    boundary: bool,
    ignored: bool,
    unblamable: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    activation: u64,
    revision: String,
    path: String,
    start_line: usize,
    total_lines: usize,
    saved_fingerprint: String,
    lines: Vec<BlameLine>,
}
struct SavedSource {
    text: String,
    fingerprint: String,
}
fn saved_source(root: &Path, path: &str) -> Result<SavedSource, String> {
    relative(path)?;
    if path.len() > 32768 {
        return Err("The Git file path exceeds the supported limit.".into());
    }
    let requested = root.join(path);
    if fs::symlink_metadata(&requested)
        .map_err(|_| "The saved blame file is unavailable.")?
        .file_type()
        .is_symlink()
    {
        return Err("Git blame requires a regular file, not a symbolic link.".into());
    }
    let target = resolve_existing_path_in_root(root, path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(target)
        .map_err(|_| "The saved blame file cannot be opened.")?;
    let metadata = file
        .metadata()
        .map_err(|_| "The saved blame file cannot be inspected.")?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE {
        return Err("Git blame supports regular saved text files up to 512 KiB.".into());
    }
    let mut data = Vec::new();
    file.take(MAX_SOURCE + 1)
        .read_to_end(&mut data)
        .map_err(|_| "The saved blame file cannot be read.")?;
    if data.len() as u64 > MAX_SOURCE {
        return Err("Git blame files are limited to 512 KiB.".into());
    }
    if data.contains(&0) {
        return Err("Binary files need the Git CLI for blame.".into());
    }
    let fingerprint = format!("{:x}", Sha256::digest(&data));
    let text = String::from_utf8(data).map_err(|_| "Git blame requires saved UTF-8 text.")?;
    Ok(SavedSource { text, fingerprint })
}
fn parse(raw: &str, source: &[&str], start: usize, count: usize) -> Result<Vec<BlameLine>, String> {
    let bad = || "Git returned incomplete or unsupported blame output.".to_owned();
    let mut input = raw.split_terminator('\n');
    let mut result = Vec::new();
    while let Some(header) = input.next() {
        let fields: Vec<_> = header.split_ascii_whitespace().collect();
        if !(3..=4).contains(&fields.len()) || !oid(fields[0]) || result.len() >= count {
            return Err(bad());
        }
        let original = fields[1].parse::<usize>().map_err(|_| bad())?;
        let line = fields[2].parse::<usize>().map_err(|_| bad())?;
        if original == 0
            || line != start + result.len()
            || fields
                .get(3)
                .is_some_and(|v| v.parse::<usize>().ok().is_none_or(|n| n == 0))
        {
            return Err(bad());
        }
        let (mut author, mut time, mut summary) = (None, None, None);
        let (mut boundary, mut ignored, mut unblamable, mut filename) =
            (false, false, false, false);
        let mut text = None;
        for field in input.by_ref() {
            if let Some(value) = field.strip_prefix('\t') {
                text = Some(value.strip_suffix('\r').unwrap_or(value));
                break;
            }
            if let Some(value) = field.strip_prefix("author ") {
                if value.is_empty()
                    || value.len() > 256
                    || author.replace(value.to_owned()).is_some()
                {
                    return Err(bad());
                }
            } else if let Some(value) = field.strip_prefix("author-time ") {
                let seconds = value.parse::<i64>().map_err(|_| bad())?;
                if !(-8640000000000..=8640000000000).contains(&seconds)
                    || time.replace(seconds).is_some()
                {
                    return Err(bad());
                }
            } else if let Some(value) = field.strip_prefix("summary ") {
                if value.len() > 1024 || summary.replace(value.to_owned()).is_some() {
                    return Err(bad());
                }
            } else if let Some(value) = field.strip_prefix("filename ") {
                if value.is_empty() || filename {
                    return Err(bad());
                }
                filename = true;
            } else if field == "boundary" {
                boundary = true;
            } else if field == "ignored" {
                ignored = true;
            } else if field == "unblamable" {
                unblamable = true;
            }
        }
        let text = text.ok_or_else(bad)?;
        if !filename || author.is_none() || time.is_none() || summary.is_none() {
            return Err(bad());
        }
        if source.get(line - 1).copied() != Some(text) {
            return Err(
                "Git conversion changed the saved text. Use the Git CLI for this file.".into(),
            );
        }
        let uncommitted = fields[0].bytes().all(|value| value == b'0');
        result.push(BlameLine {
            line,
            commit: (!uncommitted).then(|| fields[0].to_owned()),
            author: if uncommitted { None } else { author },
            author_time: if uncommitted { None } else { time },
            summary: if uncommitted {
                "Uncommitted saved text".into()
            } else {
                summary.unwrap()
            },
            text: text.into(),
            boundary,
            ignored,
            unblamable,
        });
    }
    if result.len() != count {
        return Err(bad());
    }
    Ok(result)
}
fn read_in_root(root: &Path, request: &BlameRequest, deadline: Instant) -> Result<Blame, String> {
    if request.start_line == 0 {
        return Err("Git blame line numbers start at 1.".into());
    }
    let before = snapshot(root, request.activation, deadline)?;
    require_revision(&before, &request.revision)?;
    if before.head.is_none() {
        return Err("Create an initial commit before requesting blame.".into());
    }
    let source = saved_source(root, &request.path)?;
    if request
        .saved_fingerprint
        .as_ref()
        .is_some_and(|expected| *expected != source.fingerprint)
    {
        return Err(SOURCE_CHANGED.into());
    }
    git(
        root,
        &["ls-files", "--error-unmatch", "-z", "--", &request.path],
        deadline,
    )
    .map_err(|_| "Git blame requires a tracked file with committed history.")?;
    let source_lines: Vec<_> = if source.text.is_empty() {
        Vec::new()
    } else {
        source
            .text
            .split_terminator('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line))
            .collect()
    };
    if request.start_line > source_lines.len().max(1) {
        return Err("The requested blame line is outside the saved file.".into());
    }
    let count = PAGE_LINES.min(source_lines.len().saturating_sub(request.start_line - 1));
    let captured = private_input_file(&source.text)?;
    let captured_path = captured
        .0
        .to_str()
        .ok_or("The private Git input path is not UTF-8.")?;
    let mut args = vec![
        "blame",
        "--line-porcelain",
        "--no-textconv",
        "--encoding=UTF-8",
        "--contents",
        captured_path,
    ];
    let range = format!(
        "{},{}",
        request.start_line,
        request.start_line + count.saturating_sub(1)
    );
    if count > 0 {
        args.extend(["-L", &range]);
    }
    args.extend(["--", &request.path]);
    let raw=git(root,&args,deadline).map_err(|_|"Git could not annotate this saved file within the read bounds. Refresh or use the Git CLI.".to_owned())?;
    let lines = parse(&raw, &source_lines, request.start_line, count)?;
    if saved_source(root, &request.path)?.fingerprint != source.fingerprint {
        return Err(SOURCE_CHANGED.into());
    }
    require_revision(
        &snapshot(root, request.activation, deadline)?,
        &request.revision,
    )?;
    Ok(Blame {
        activation: request.activation,
        revision: request.revision.clone(),
        path: request.path.clone(),
        start_line: request.start_line,
        total_lines: source_lines.len(),
        saved_fingerprint: source.fingerprint,
        lines,
    })
}
#[tauri::command]
pub async fn git_workspace_blame(request: BlameRequest) -> Result<Blame, String> {
    trusted(request.trusted)?;
    super::super::blocking::run(move || {
        let root =
            with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        let result = read_in_root(&root, &request, Instant::now() + READ_TIMEOUT);
        with_root_activation(|| current_root(&request.workspace_path, request.activation))?;
        result
    })
    .await
}
#[cfg(all(test, unix))]
mod tests;
