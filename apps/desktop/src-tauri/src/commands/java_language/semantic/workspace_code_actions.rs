//! Project text edits onto current drafts or a read-only closed-source proposal.
use super::*;
use std::io::Read;

const MAX_CAPTURED_SOURCE_BYTES: usize = 8 * 1024 * 1024;

struct SavedSource {
    hash: String,
    boundaries: Vec<Vec<u32>>,
}

pub(super) struct Sources<'a> {
    root: &'a Path,
    saved: HashMap<String, SavedSource>,
    bytes: usize,
}

impl<'a> Sources<'a> {
    pub(super) fn new(root: &'a Path) -> Self {
        Self {
            root,
            saved: HashMap::new(),
            bytes: 0,
        }
    }

    fn capture(&mut self, path: &str) -> Option<&SavedSource> {
        if !self.saved.contains_key(path) {
            if self.saved.len() >= MAX_RENAME_DOCUMENTS {
                return None;
            }
            let file = crate::commands::editor_disk::open_checked(self.root, path).ok()?;
            let before = file.metadata().ok()?;
            if !before.is_file() || before.len() > MAX_DOCUMENT_BYTES as u64 {
                return None;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if before.nlink() != 1 {
                    return None;
                }
            }
            let mut bytes = Vec::new();
            (&file)
                .take(MAX_DOCUMENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            let after = file.metadata().ok()?;
            if bytes.len() > MAX_DOCUMENT_BYTES
                || before.len() != after.len()
                || before.modified().ok() != after.modified().ok()
                || self.bytes.checked_add(bytes.len())? > MAX_CAPTURED_SOURCE_BYTES
            {
                return None;
            }
            let text = std::str::from_utf8(&bytes).ok()?;
            let source = SavedSource {
                hash: hash_text(text),
                boundaries: line_utf16_boundaries(text).ok()?,
            };
            self.bytes += bytes.len();
            self.saved.insert(path.to_string(), source);
        }
        self.saved.get(path)
    }
}

pub(super) fn project(
    edit: &Value,
    request: &JavaSemanticRequest,
    open: &HashMap<String, OpenDocument>,
    sources: &mut Sources<'_>,
    title: &str,
    kind: Option<&str>,
) -> Option<Value> {
    let edit = edit.as_object()?;
    if edit.contains_key("changes") == edit.contains_key("documentChanges") {
        return None;
    }
    let primary = open.get(&request.document.path)?;
    if primary.uri != request.document.uri || primary.version != request.document.version {
        return None;
    }
    let entries: Vec<(&str, Option<&Value>, &Value)> = if let Some(changes) = edit.get("changes") {
        let changes = changes.as_object()?;
        if changes.is_empty() || changes.len() > MAX_RENAME_DOCUMENTS {
            return None;
        }
        changes
            .iter()
            .map(|(uri, edits)| (uri.as_str(), None, edits))
            .collect()
    } else {
        let changes = edit.get("documentChanges")?.as_array()?;
        if changes.is_empty() || changes.len() > MAX_RENAME_DOCUMENTS {
            return None;
        }
        changes
            .iter()
            .map(|change| {
                let change = change.as_object()?;
                if change.contains_key("kind") {
                    return None;
                }
                let document = change.get("textDocument")?.as_object()?;
                Some((
                    document.get("uri")?.as_str()?,
                    document.get("version"),
                    change.get("edits")?,
                ))
            })
            .collect::<Option<Vec<_>>>()?
    };
    let mut changes = BTreeMap::new();
    let mut source_documents = BTreeMap::new();
    let mut closed = Vec::new();
    let mut total = 0usize;
    for (uri, version, raw) in entries {
        let document = open
            .values()
            .find(|document| document.uri == uri && document.language_id == "java");
        let path = if let Some(document) = document {
            if version.is_some_and(|version| {
                !version.is_null() && version.as_i64() != Some(document.version)
            }) {
                return None;
            }
            document.path.clone()
        } else {
            if version.is_some_and(|version| !version.is_null()) {
                return None;
            }
            let path = workspace_symbol_path(uri, sources.root)?;
            let (_, expected_uri) = authorize_java_path(sources.root, &path).ok()?;
            if uri != expected_uri {
                return None;
            }
            path
        };
        if changes.contains_key(&path) {
            return None;
        }
        let raw = raw.as_array()?;
        total = total.checked_add(raw.len())?;
        if raw.is_empty() || total > MAX_CODE_ACTION_EDITS {
            return None;
        }
        let (hash, boundaries) = if let Some(document) = document {
            (document.text_hash.clone(), &document.line_utf16_boundaries)
        } else {
            closed.push(path.clone());
            let source = sources.capture(&path)?;
            (source.hash.clone(), &source.boundaries)
        };
        let mut edits: Vec<Value> = Vec::new();
        for raw in raw {
            let edit = sanitize_text_edit(raw)?;
            if !response_edit_is_in_boundaries(&edit, boundaries)
                || edits
                    .iter()
                    .any(|previous| ranges_overlap(&previous["range"], &edit["range"]))
            {
                return None;
            }
            edits.push(edit);
        }
        edits.sort_by_key(|edit| range_tuple(&edit["range"]).unwrap());
        changes.insert(path.clone(), edits);
        source_documents.insert(path, hash);
    }
    let normalized = json!({"title":title,"kind":kind,"changes":changes});
    let plan_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&normalized).ok()?)
    );
    let source_documents: Vec<_> = source_documents
        .into_iter()
        .map(|(path, hash)| json!({"path":path,"contentSha256":hash}))
        .collect();
    let mut clean =
        json!({"edits":[],"editPlanSha256":plan_hash,"sourceDocuments":source_documents});
    if !closed.is_empty() {
        closed.sort();
        clean["documentsToOpen"] = json!(closed);
        return Some(clean);
    }
    let mut primary_edits = Vec::new();
    let mut additional = Vec::new();
    for (path, edits) in changes {
        if path == request.document.path {
            primary_edits = edits;
        } else {
            let document = open.get(&path)?;
            additional.extend(edits.into_iter().map(|edit| json!({"document":{"workspaceId":request.workspace_id,"path":path,"uri":document.uri,"version":document.version},"edit":edit})));
        }
    }
    clean["edits"] = json!(primary_edits);
    if !additional.is_empty() {
        clean["additionalEdits"] = json!(additional);
    }
    Some(clean)
}

#[cfg(test)]
mod tests {
    use super::super::super::path_policy::file_uri;
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Workspace(PathBuf);
    impl Workspace {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "ide-closed-action-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn request(&self) -> JavaSemanticRequest {
            serde_json::from_value(json!({
                "workspaceId":"test-workspace","generation":1,
                "document":{"path":"Use.java","uri":file_uri(&self.0.join("Use.java")),"version":1},
                "position":{"line":0,"character":0},"requestId":"test-request","cancellationId":"test-cancel"
            })).unwrap()
        }
        fn open(&self, path: &str, text: &str, version: i64) -> OpenDocument {
            OpenDocument {
                path: path.into(),
                uri: file_uri(&self.0.join(path)),
                language_id: "java".into(),
                version,
                text_hash: hash_text(text),
                line_utf16_boundaries: line_utf16_boundaries(text).unwrap(),
            }
        }
    }
    impl Drop for Workspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn edits() -> Value {
        json!([{"range":{"start":{"line":0,"character":12},"end":{"line":0,"character":12}},"newText":" void missing() {} "}])
    }

    #[test]
    fn closed_proposal_has_no_applicable_edits_and_matches_the_fresh_open_plan() {
        let w = Workspace::new();
        let text = "class Main {}";
        fs::write(w.0.join("Main.java"), text).unwrap();
        let request = w.request();
        let mut open = HashMap::from([("Use.java".into(), w.open("Use.java", "class Use {}", 1))]);
        let uri = file_uri(&w.0.join("Main.java"));
        let closed = json!({"documentChanges":[{"textDocument":{"uri":uri,"version":null},"edits":edits()}]});
        let original = project(
            &closed,
            &request,
            &open,
            &mut Sources::new(&w.0),
            "Create method",
            Some("quickfix"),
        )
        .unwrap();
        assert_eq!(original["edits"], json!([]));
        assert!(original.get("additionalEdits").is_none());
        assert_eq!(original["documentsToOpen"], json!(["Main.java"]));
        assert_eq!(
            original["sourceDocuments"][0]["contentSha256"],
            hash_text(text)
        );
        open.insert("Main.java".into(), w.open("Main.java", text, 4));
        let fresh_edit =
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":4},"edits":edits()}]});
        let fresh = project(
            &fresh_edit,
            &request,
            &open,
            &mut Sources::new(&w.0),
            "Create method",
            Some("quickfix"),
        )
        .unwrap();
        assert!(fresh.get("documentsToOpen").is_none());
        assert_eq!(fresh["editPlanSha256"], original["editPlanSha256"]);
        assert_eq!(fresh["sourceDocuments"], original["sourceDocuments"]);
        assert_eq!(fresh["additionalEdits"][0]["document"]["version"], 4);
        // The same insertion geometry in changed text is distinguishable by its source snapshot.
        open.insert(
            "Main.java".into(),
            w.open("Main.java", "class Main { int changed; }", 5),
        );
        let changed = project(
            &json!({"changes":{(uri):edits()}}),
            &request,
            &open,
            &mut Sources::new(&w.0),
            "Create method",
            Some("quickfix"),
        )
        .unwrap();
        assert_eq!(changed["editPlanSha256"], original["editPlanSha256"]);
        assert_ne!(changed["sourceDocuments"], original["sourceDocuments"]);
        assert_eq!(fs::read_to_string(w.0.join("Main.java")).unwrap(), text);
    }

    #[test]
    fn refuses_resource_operations_wrong_versions_ranges_and_external_files() {
        let w = Workspace::new();
        fs::write(w.0.join("Main.java"), "class Main {}").unwrap();
        fs::write(w.0.join("Unicode.java"), "a😀b").unwrap();
        let request = w.request();
        let open = HashMap::from([("Use.java".into(), w.open("Use.java", "class Use {}", 1))]);
        let uri = file_uri(&w.0.join("Main.java"));
        let foreign = Workspace::new();
        fs::write(foreign.0.join("Other.java"), "class Other {}").unwrap();
        let invalid = [
            json!({"documentChanges":[{"kind":"rename","oldUri":uri,"newUri":uri}]}),
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":2},"edits":edits()}]}),
            json!({"changes":{(uri.clone()):[]}}),
            json!({"changes":{(file_uri(&foreign.0.join("Other.java"))):edits()}}),
            json!({"changes":{(file_uri(&w.0.join("Missing.java"))):edits()}}),
            json!({"changes":{(uri.clone()):[{"range":{"start":{"line":0,"character":99},"end":{"line":0,"character":99}},"newText":"x"}]}}),
            json!({"changes":{(uri.clone()):[edits()[0].clone(),edits()[0].clone()]}}),
            json!({"changes":{(file_uri(&w.0.join("Unicode.java"))):[{"range":{"start":{"line":0,"character":2},"end":{"line":0,"character":2}},"newText":"x"}]}}),
        ];
        for invalid in invalid {
            assert!(project(
                &invalid,
                &request,
                &open,
                &mut Sources::new(&w.0),
                "Fix",
                None
            )
            .is_none());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(foreign.0.join("Other.java"), w.0.join("Escape.java"))
                .unwrap();
            let escaped = json!({"changes":{(file_uri(&w.0.join("Escape.java"))):edits()}});
            assert!(project(
                &escaped,
                &request,
                &open,
                &mut Sources::new(&w.0),
                "Fix",
                None
            )
            .is_none());
            fs::hard_link(w.0.join("Main.java"), w.0.join("Hard.java")).unwrap();
            let hard = json!({"changes":{(file_uri(&w.0.join("Hard.java"))):edits()}});
            assert!(
                project(&hard, &request, &open, &mut Sources::new(&w.0), "Fix", None).is_none()
            );
        }
    }

    #[test]
    fn bounded_source_capture_is_shared_within_one_query_but_never_between_queries() {
        let w = Workspace::new();
        fs::write(w.0.join("Main.java"), "class Main {}").unwrap();
        let mut cache = Sources::new(&w.0);
        let first = cache.capture("Main.java").unwrap().hash.clone();
        fs::write(w.0.join("Main.java"), "class Changed {}").unwrap();
        assert_eq!(cache.capture("Main.java").unwrap().hash, first);
        assert_ne!(Sources::new(&w.0).capture("Main.java").unwrap().hash, first);
        let large = vec![b' '; MAX_DOCUMENT_BYTES];
        let mut cache = Sources::new(&w.0);
        for n in 0..5 {
            let path = format!("Large{n}.java");
            fs::write(w.0.join(&path), &large).unwrap();
            assert_eq!(cache.capture(&path).is_some(), n < 4);
        }
        fs::write(
            w.0.join("TooLarge.java"),
            vec![b' '; MAX_DOCUMENT_BYTES + 1],
        )
        .unwrap();
        assert!(Sources::new(&w.0).capture("TooLarge.java").is_none());
    }
}
