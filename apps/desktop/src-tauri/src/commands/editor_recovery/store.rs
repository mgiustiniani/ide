use super::{Draft, Entry};
use crate::workspace::resolve_new_path_in_root;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_BYTES: usize = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;
const MAX_SERIALIZED_BYTES: u64 = 100 * 1024 * 1024;
const MAX_DRAFTS: usize = 64;
const MAX_HISTORY: usize = 100;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredEntry {
    id: String,
    owner: String,
    file_path: String,
    language: String,
    kind: String,
    content: String,
    captured_at: u64,
    sequence: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u8,
    workspace_key: String,
    sequence: u64,
    entries: Vec<StoredEntry>,
}

pub(super) fn random_id() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Cannot allocate recovery identity")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}
fn valid_relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.contains(['\\', '\0'])
        && !Path::new(path).is_absolute()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}
fn normalize(root: &Path, path: &str) -> Result<String, String> {
    let path = resolve_new_path_in_root(root, path)?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Recovery path escapes the workspace")?;
    let relative = relative
        .components()
        .map(|part| {
            part.as_os_str()
                .to_str()
                .ok_or("Recovery path is not UTF-8")
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    if !valid_relative(&relative) {
        return Err("Invalid recovery file path".into());
    }
    Ok(relative)
}
fn private_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
        Ok(_) => return Err("Unsafe recovery directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|_| "Cannot create recovery directory")?;
        }
        Err(_) => return Err("Cannot inspect recovery directory".into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect recovery directory")?;
    }
    Ok(())
}
fn safe_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err("Unsafe recovery file".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if meta.nlink() != 1 {
                    return Err("Unsafe recovery file link".into());
                }
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Cannot inspect recovery file".into()),
    }
}
fn validate(journal: &Journal, key: &str) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut drafts = HashSet::new();
    if journal.version != 1
        || journal.workspace_key != key
        || journal.entries.len() > MAX_DRAFTS + MAX_HISTORY
        || journal
            .entries
            .iter()
            .map(|e| e.content.len())
            .sum::<usize>()
            > MAX_TOTAL_BYTES
    {
        return Err("Invalid or oversized recovery journal".into());
    }
    for e in &journal.entries {
        if !valid_id(&e.id)
            || !ids.insert(&e.id)
            || !valid_id(&e.owner)
            || !valid_relative(&e.file_path)
            || e.content.len() > MAX_FILE_BYTES
            || e.language.is_empty()
            || e.language.len() > 64
            || !["draft", "history"].contains(&e.kind.as_str())
            || e.sequence > journal.sequence
            || (e.kind == "draft" && !drafts.insert((&e.owner, &e.file_path)))
        {
            return Err("Invalid recovery entry".into());
        }
    }
    if drafts.len() > MAX_DRAFTS {
        return Err("Too many pending recovery drafts; remove reviewed entries first".into());
    }
    Ok(())
}
fn with_journal<T>(
    home: &Path,
    root: &Path,
    mutate: bool,
    action: impl FnOnce(&mut Journal) -> Result<T, String>,
) -> Result<T, String> {
    fs::create_dir_all(home).map_err(|_| "Cannot prepare recovery home")?;
    let home = home
        .canonicalize()
        .map_err(|_| "Cannot resolve recovery home")?;
    let directory = home.join("editor-recovery");
    private_directory(&directory)?;
    let root = root
        .canonicalize()
        .map_err(|_| "Cannot resolve recovery workspace")?;
    let key = format!("{:x}", Sha256::digest(root.as_os_str().as_encoded_bytes()));
    let directory = directory.join(&key);
    private_directory(&directory)?;
    let lock_path = directory.join("journal.lock");
    safe_file(&lock_path)?;
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(lock_path)
        .map_err(|_| "Cannot lock recovery journal")?;
    // Another IDE process (or a short-lived fork inheriting the lock) may still
    // own this journal. Wait only on the worker thread and keep retries bounded.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            Err(_) => {
                return Err(
                    "Recovery journal is busy or cannot be locked; retry the checkpoint".into(),
                )
            }
        }
    }
    let path = directory.join("journal.json");
    safe_file(&path)?;
    let mut journal = match File::open(&path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(MAX_SERIALIZED_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot read recovery journal")?;
            if bytes.len() as u64 > MAX_SERIALIZED_BYTES {
                return Err("Recovery journal is too large".into());
            }
            serde_json::from_slice::<Journal>(&bytes)
                .map_err(|_| "Recovery journal is corrupt; it was not replaced")?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Journal {
            version: 1,
            workspace_key: key.clone(),
            sequence: 0,
            entries: vec![],
        },
        Err(_) => return Err("Cannot read recovery journal".into()),
    };
    validate(&journal, &key)?;
    let result = action(&mut journal)?;
    if mutate {
        validate(&journal, &key)?;
        let bytes = serde_json::to_vec(&journal).map_err(|_| "Cannot encode recovery journal")?;
        let temporary = directory.join(format!("checkpoint-{}.tmp", random_id()?));
        let published: Result<(), String> = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|_| "Cannot prepare recovery checkpoint")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Cannot flush recovery checkpoint")?;
            drop(file);
            safe_file(&path)?;
            fs::rename(&temporary, &path).map_err(|_| "Cannot publish recovery checkpoint")?;
            #[cfg(unix)]
            File::open(&directory)
                .and_then(|dir| dir.sync_all())
                .map_err(|_| "Recovery checkpoint durability could not be verified")?;
            Ok(())
        })();
        if published.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        published?;
    }
    Ok(result)
}
fn trim(journal: &mut Journal) -> Result<(), String> {
    loop {
        let bytes: usize = journal.entries.iter().map(|e| e.content.len()).sum();
        let histories = journal
            .entries
            .iter()
            .filter(|e| e.kind == "history")
            .count();
        if bytes <= MAX_TOTAL_BYTES && histories <= MAX_HISTORY {
            break;
        }
        if let Some(index) = journal
            .entries
            .iter()
            .enumerate()
            .filter(|(_, e)| e.kind == "history")
            .min_by_key(|(_, e)| e.sequence)
            .map(|(index, _)| index)
        {
            journal.entries.remove(index);
        } else {
            return Err(
                "Recovery draft capacity reached; the previous checkpoint was retained".into(),
            );
        }
    }
    Ok(())
}
pub(super) fn checkpoint(
    home: &Path,
    root: &Path,
    owner: &str,
    drafts: &[Draft],
) -> Result<(), String> {
    if !valid_id(owner) || drafts.len() > MAX_DRAFTS {
        return Err("Invalid recovery checkpoint".into());
    }
    let mut incoming = Vec::new();
    let mut paths = HashSet::new();
    for draft in drafts {
        let path = normalize(root, &draft.file_path)?;
        if draft.content.len() > MAX_FILE_BYTES
            || draft.language.is_empty()
            || draft.language.len() > 64
            || !paths.insert(path.clone())
        {
            return Err("Invalid or oversized recovery draft".into());
        }
        incoming.push((path, draft));
    }
    with_journal(home, root, true, |journal| {
        for entry in &mut journal.entries {
            if entry.owner == owner
                && entry.kind == "draft"
                && !incoming.iter().any(|(path, draft)| {
                    path == &entry.file_path
                        && draft.content == entry.content
                        && draft.language == entry.language
                })
            {
                entry.kind = "history".into();
            }
        }
        for (path, draft) in incoming {
            if journal
                .entries
                .iter()
                .any(|e| e.owner == owner && e.file_path == path && e.kind == "draft")
            {
                continue;
            }
            journal.sequence = journal
                .sequence
                .checked_add(1)
                .ok_or("Recovery sequence exhausted")?;
            journal.entries.push(StoredEntry {
                id: random_id()?,
                owner: owner.into(),
                file_path: path,
                language: draft.language.clone(),
                kind: "draft".into(),
                content: draft.content.clone(),
                captured_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                sequence: journal.sequence,
            });
        }
        trim(journal)
    })
}
fn present(entry: &StoredEntry, owner: &str, include_content: bool) -> Entry {
    Entry {
        id: entry.id.clone(),
        file_path: entry.file_path.clone(),
        language: entry.language.clone(),
        kind: entry.kind.clone(),
        captured_at: entry.captured_at,
        byte_length: entry.content.len(),
        current_session: entry.owner == owner,
        content: include_content.then(|| entry.content.clone()),
    }
}
pub(super) fn list(home: &Path, root: &Path, owner: &str) -> Result<Vec<Entry>, String> {
    with_journal(home, root, false, |journal| {
        journal
            .entries
            .sort_by_key(|e| std::cmp::Reverse(e.sequence));
        Ok(journal
            .entries
            .iter()
            .map(|e| present(e, owner, false))
            .collect())
    })
}
pub(super) fn read(home: &Path, root: &Path, owner: &str, id: &str) -> Result<Entry, String> {
    if !valid_id(id) {
        return Err("Invalid recovery entry identity".into());
    }
    with_journal(home, root, false, |journal| {
        journal
            .entries
            .iter()
            .find(|e| e.id == id)
            .map(|e| present(e, owner, true))
            .ok_or_else(|| "Recovery entry is unavailable".into())
    })
}
pub(super) fn remove(home: &Path, root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Invalid recovery entry identity".into());
    }
    with_journal(home, root, true, |journal| {
        if !journal.entries.iter().any(|e| e.id == id) {
            return Err("Recovery entry is unavailable".into());
        }
        journal.entries.retain(|e| e.id != id);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    const OWNER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn roots() -> (PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("ide-recovery-{}", random_id().unwrap()));
        fs::create_dir(&base).unwrap();
        let home = base.join("home");
        let root = base.join("workspace");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&home).unwrap();
        fs::write(root.join("Main.java"), "disk-original").unwrap();
        (base, home, root)
    }
    fn draft(content: &str) -> Draft {
        Draft {
            file_path: "Main.java".into(),
            content: content.into(),
            language: "java".into(),
        }
    }

    #[test]
    fn restart_retains_unsaved_content_without_changing_source() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("unsaved\nα")]).unwrap();
        fs::write(root.join("Main.java"), "external").unwrap();
        let entries = list(&home, &root, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].current_session);
        assert_eq!(
            read(&home, &root, OWNER, &entries[0].id)
                .unwrap()
                .content
                .as_deref(),
            Some("unsaved\nα")
        );
        assert_eq!(
            fs::read_to_string(root.join("Main.java")).unwrap(),
            "external"
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn versions_become_history_and_empty_checkpoint_only_clears_its_owner() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("one")]).unwrap();
        checkpoint(&home, &root, OWNER, &[draft("two")]).unwrap();
        checkpoint(
            &home,
            &root,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            &[draft("other editor")],
        )
        .unwrap();
        checkpoint(&home, &root, OWNER, &[]).unwrap();
        let entries = list(&home, &root, OWNER).unwrap();
        assert_eq!(entries.iter().filter(|e| e.kind == "history").count(), 2);
        assert_eq!(entries.iter().filter(|e| e.kind == "draft").count(), 1);
        assert_eq!(
            fs::read_to_string(root.join("Main.java")).unwrap(),
            "disk-original"
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn namespaces_are_isolated_and_traversal_never_changes_the_checkpoint() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("keep")]).unwrap();
        let other = base.join("other");
        fs::create_dir_all(&other).unwrap();
        assert!(list(&home, &other, OWNER).unwrap().is_empty());
        let mut invalid = draft("escape");
        invalid.file_path = "../outside.java".into();
        assert!(checkpoint(&home, &root, OWNER, &[invalid]).is_err());
        assert_eq!(list(&home, &root, OWNER).unwrap().len(), 1);
        assert!(read(
            &home,
            &other,
            OWNER,
            &list(&home, &root, OWNER).unwrap()[0].id
        )
        .is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn explicit_removal_and_duplicate_checkpoint_do_not_write_source() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("keep")]).unwrap();
        checkpoint(&home, &root, OWNER, &[draft("keep")]).unwrap();
        let entries = list(&home, &root, OWNER).unwrap();
        assert_eq!(entries.len(), 1);
        remove(&home, &root, &entries[0].id).unwrap();
        assert!(list(&home, &root, OWNER).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(root.join("Main.java")).unwrap(),
            "disk-original"
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn oversized_payload_preserves_the_previous_checkpoint() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("keep")]).unwrap();
        assert!(checkpoint(
            &home,
            &root,
            OWNER,
            &[draft(&"x".repeat(MAX_FILE_BYTES + 1))]
        )
        .is_err());
        assert_eq!(
            read(
                &home,
                &root,
                OWNER,
                &list(&home, &root, OWNER).unwrap()[0].id
            )
            .unwrap()
            .content
            .as_deref(),
            Some("keep")
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn history_is_bounded_without_evicting_pending_drafts() {
        let (base, home, root) = roots();
        for version in 0..110 {
            checkpoint(&home, &root, OWNER, &[draft(&version.to_string())]).unwrap();
        }
        let entries = list(&home, &root, OWNER).unwrap();
        assert_eq!(entries.len(), MAX_HISTORY + 1);
        assert_eq!(entries.iter().filter(|e| e.kind == "draft").count(), 1);
        fs::remove_dir_all(base).unwrap();
    }
    fn journal_path(home: &Path, root: &Path) -> PathBuf {
        home.join("editor-recovery")
            .join(format!(
                "{:x}",
                Sha256::digest(root.canonicalize().unwrap().as_os_str().as_encoded_bytes())
            ))
            .join("journal.json")
    }
    #[test]
    fn corruption_and_abandoned_temporary_writes_do_not_replace_valid_checkpoints() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("keep")]).unwrap();
        let path = journal_path(&home, &root);
        fs::write(
            path.parent().unwrap().join("checkpoint-abandoned.tmp"),
            b"partial",
        )
        .unwrap();
        assert_eq!(list(&home, &root, OWNER).unwrap().len(), 1);
        fs::write(&path, b"corrupt").unwrap();
        assert!(checkpoint(&home, &root, OWNER, &[draft("new")]).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"corrupt");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn utf8_buffer_capacity_accepts_the_exact_bound_and_refuses_one_more_byte() {
        let (base, home, root) = roots();
        let mut content = "é".repeat(MAX_FILE_BYTES / 2);
        assert_eq!(content.len(), MAX_FILE_BYTES);
        assert!(content.chars().count() < MAX_FILE_BYTES);
        checkpoint(&home, &root, OWNER, &[draft(&content)]).unwrap();
        let path = journal_path(&home, &root);
        let before = fs::read(&path).unwrap();
        let id = list(&home, &root, OWNER).unwrap()[0].id.clone();
        content.push('!');
        assert!(checkpoint(&home, &root, OWNER, &[draft(&content)]).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(
            read(&home, &root, OWNER, &id).unwrap().byte_length,
            MAX_FILE_BYTES
        );
        assert_eq!(fs::read(root.join("Main.java")).unwrap(), b"disk-original");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn pending_draft_count_capacity_preserves_every_owner_and_previous_journal_bytes() {
        let (base, home, root) = roots();
        for owner in 1..=MAX_DRAFTS {
            checkpoint(&home, &root, &format!("{owner:032x}"), &[draft("pending")]).unwrap();
        }
        let path = journal_path(&home, &root);
        let before = fs::read(&path).unwrap();
        let ids: Vec<_> = list(&home, &root, OWNER)
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids.len(), MAX_DRAFTS);
        assert!(checkpoint(&home, &root, OWNER, &[draft("one owner too many")]).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let entries = list(&home, &root, OWNER).unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
            ids
        );
        assert!(entries.iter().all(|entry| entry.kind == "draft"));
        assert_eq!(fs::read(root.join("Main.java")).unwrap(), b"disk-original");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn total_content_capacity_refuses_extra_drafts_without_eviction_and_trims_history_first() {
        let (base, home, root) = roots();
        let content = "x".repeat(MAX_FILE_BYTES);
        let mut drafts: Vec<_> = (0..MAX_TOTAL_BYTES / MAX_FILE_BYTES)
            .map(|index| Draft {
                file_path: format!("draft-{index}.txt"),
                content: content.clone(),
                language: "plaintext".into(),
            })
            .collect();
        checkpoint(&home, &root, OWNER, &drafts).unwrap();
        let path = journal_path(&home, &root);
        let before = fs::read(&path).unwrap();
        let ids: Vec<_> = list(&home, &root, OWNER)
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        let extra = Draft {
            file_path: "extra.txt".into(),
            content: "!".into(),
            language: "plaintext".into(),
        };
        assert!(checkpoint(&home, &root, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", &[extra]).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(
            list(&home, &root, OWNER)
                .unwrap()
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
            ids
        );
        drafts[0].content = "y".repeat(MAX_FILE_BYTES);
        checkpoint(&home, &root, OWNER, &drafts).unwrap();
        let entries = list(&home, &root, OWNER).unwrap();
        assert_eq!(entries.len(), MAX_TOTAL_BYTES / MAX_FILE_BYTES);
        assert!(entries.iter().all(|entry| entry.kind == "draft"));
        assert_eq!(
            entries.iter().map(|entry| entry.byte_length).sum::<usize>(),
            MAX_TOTAL_BYTES
        );
        assert_eq!(
            read(
                &home,
                &root,
                OWNER,
                &entries
                    .iter()
                    .find(|entry| entry.file_path == "draft-0.txt")
                    .unwrap()
                    .id
            )
            .unwrap()
            .content
            .as_deref(),
            Some(drafts[0].content.as_str())
        );
        assert_eq!(fs::read(root.join("Main.java")).unwrap(), b"disk-original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn malformed_and_semantically_invalid_journals_refuse_every_operation_without_replacement() {
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("retained checkpoint")]).unwrap();
        let path = journal_path(&home, &root);
        let original = fs::read(&path).unwrap();
        let issued: serde_json::Value = serde_json::from_slice(&original).unwrap();
        let id = issued["entries"][0]["id"].as_str().unwrap();
        let mut cases = vec![
            original[..original.len() / 2].to_vec(),
            b"not JSON".to_vec(),
        ];
        for field in [
            "version",
            "workspaceKey",
            "duplicate",
            "owner",
            "filePath",
            "sequence",
            "unknown",
        ] {
            let mut invalid = issued.clone();
            match field {
                "version" => invalid["version"] = serde_json::json!(2),
                "workspaceKey" => invalid["workspaceKey"] = serde_json::json!("f".repeat(64)),
                "duplicate" => {
                    let copy = invalid["entries"][0].clone();
                    invalid["entries"].as_array_mut().unwrap().push(copy);
                }
                "owner" => invalid["entries"][0]["owner"] = serde_json::json!("invalid"),
                "filePath" => {
                    invalid["entries"][0]["filePath"] = serde_json::json!("../outside.txt")
                }
                "sequence" => invalid["entries"][0]["sequence"] = serde_json::json!(u64::MAX),
                "unknown" => invalid["automaticRestore"] = serde_json::json!(true),
                _ => unreachable!(),
            }
            cases.push(serde_json::to_vec(&invalid).unwrap());
        }
        for invalid in cases {
            fs::write(&path, &invalid).unwrap();
            assert!(list(&home, &root, OWNER).is_err());
            assert!(read(&home, &root, OWNER, id).is_err());
            assert!(remove(&home, &root, id).is_err());
            assert!(checkpoint(&home, &root, OWNER, &[draft("new edits")]).is_err());
            assert_eq!(fs::read(&path).unwrap(), invalid);
            assert_eq!(fs::read(root.join("Main.java")).unwrap(), b"disk-original");
        }
        fs::write(&path, &original).unwrap();
        assert_eq!(
            read(&home, &root, OWNER, id).unwrap().content.as_deref(),
            Some("retained checkpoint")
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn private_permissions_and_symlink_journals_are_enforced() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("keep")]).unwrap();
        let path = journal_path(&home, &root);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        fs::remove_file(&path).unwrap();
        let outside = base.join("outside");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, &path).unwrap();
        assert!(list(&home, &root, OWNER).is_err());
        assert!(checkpoint(&home, &root, OWNER, &[draft("new")]).is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "secret");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn checkpoint_survives_forced_worker_termination() {
        use std::process::{Command, Stdio};
        let (base, home, root) = roots();
        let ack = base.join("ack");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "commands::editor_recovery::store::tests::crash_worker",
                "--ignored",
                "--nocapture",
            ])
            .env("IDE_RECOVERY_TEST_HOME", &home)
            .env("IDE_RECOVERY_TEST_ROOT", &root)
            .env("IDE_RECOVERY_TEST_ACK", &ack)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !ack.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let confirmed = ack.exists();
        let _ = child.kill();
        child.wait().unwrap();
        assert!(confirmed, "worker never acknowledged a durable checkpoint");
        let entries = list(&home, &root, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap();
        assert_eq!(
            read(&home, &root, OWNER, &entries[0].id)
                .unwrap()
                .content
                .as_deref(),
            Some("survives termination")
        );
        assert_eq!(
            fs::read_to_string(root.join("Main.java")).unwrap(),
            "disk-original"
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn independent_process_lock_is_waited_for_before_checkpoint_publication() {
        use std::process::{Command, Stdio};
        let (base, home, root) = roots();
        checkpoint(&home, &root, OWNER, &[draft("one")]).unwrap();
        let ack = base.join("ack");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "commands::editor_recovery::store::tests::crash_worker",
                "--ignored",
                "--nocapture",
            ])
            .env("IDE_RECOVERY_TEST_HOME", &home)
            .env("IDE_RECOVERY_TEST_ROOT", &root)
            .env("IDE_RECOVERY_TEST_ACK", &ack)
            .env("IDE_RECOVERY_TEST_HOLD_LOCK", "true")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !ack.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        if !ack.exists() {
            let _ = child.kill();
            let _ = child.wait();
            panic!("worker did not acquire the journal lock");
        }
        let written = checkpoint(&home, &root, OWNER, &[draft("two")]);
        assert!(child.wait().unwrap().success());
        written.unwrap();
        let entries = list(&home, &root, OWNER).unwrap();
        assert_eq!(entries.iter().filter(|e| e.kind == "history").count(), 1);
        assert_eq!(
            read(&home, &root, OWNER, &entries[0].id)
                .unwrap()
                .content
                .as_deref(),
            Some("two")
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[ignore = "isolated checkpoint worker invoked by forced-termination and lock tests"]
    fn crash_worker() {
        let home = PathBuf::from(std::env::var_os("IDE_RECOVERY_TEST_HOME").unwrap());
        let root = PathBuf::from(std::env::var_os("IDE_RECOVERY_TEST_ROOT").unwrap());
        if std::env::var_os("IDE_RECOVERY_TEST_HOLD_LOCK").is_some() {
            let lock = OpenOptions::new()
                .read(true)
                .write(true)
                .open(
                    journal_path(&home, &root)
                        .parent()
                        .unwrap()
                        .join("journal.lock"),
                )
                .unwrap();
            lock.lock().unwrap();
            fs::write(
                PathBuf::from(std::env::var_os("IDE_RECOVERY_TEST_ACK").unwrap()),
                "locked",
            )
            .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(150));
            return;
        }
        checkpoint(&home, &root, OWNER, &[draft("survives termination")]).unwrap();
        fs::write(
            PathBuf::from(std::env::var_os("IDE_RECOVERY_TEST_ACK").unwrap()),
            "acknowledged",
        )
        .unwrap();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }
}
