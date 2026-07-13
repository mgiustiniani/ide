//! Workspace/path authorization and normalized file-URI policy.

use std::path::{Path, PathBuf};

use super::protocol::MAX_DIAGNOSTIC_URI_BYTES;

pub(super) fn authorize_java_path(root: &Path, relative: &str) -> Result<(String, String), String> {
    if relative.is_empty()
        || relative.len() > MAX_DIAGNOSTIC_URI_BYTES
        || relative.chars().any(char::is_control)
        || Path::new(relative).is_absolute()
        || relative
            .split(['/', '\\'])
            .any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(relative)
            .extension()
            .and_then(|value| value.to_str())
            != Some("java")
    {
        return Err("Invalid workspace-relative Java document path".to_string());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "Cannot authorize the workspace root".to_string())?;
    let lexical = root.join(relative);
    let resolved = if lexical.exists() {
        lexical
            .canonicalize()
            .map_err(|_| "Cannot authorize the Java document path".to_string())?
    } else {
        let mut parent = lexical
            .parent()
            .ok_or_else(|| "Invalid Java document path".to_string())?;
        let mut suffix = Vec::new();
        while !parent.exists() {
            let name = parent
                .file_name()
                .ok_or_else(|| "Invalid Java document path".to_string())?;
            suffix.push(name.to_os_string());
            parent = parent
                .parent()
                .ok_or_else(|| "Invalid Java document path".to_string())?;
        }
        let mut resolved = parent
            .canonicalize()
            .map_err(|_| "Cannot authorize the Java document parent".to_string())?;
        for component in suffix.iter().rev() {
            resolved.push(component);
        }
        resolved.push(
            lexical
                .file_name()
                .ok_or_else(|| "Invalid Java document path".to_string())?,
        );
        resolved
    };
    if !resolved.starts_with(&root) || resolved == root {
        return Err("Java document path escapes the current workspace".to_string());
    }
    let canonical_relative = resolved
        .strip_prefix(&root)
        .map_err(|_| "Java document path escapes the current workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((canonical_relative, file_uri(&resolved)))
}

pub(super) fn diagnostic_uri_in_workspace(uri: &str, workspace_root: &Path) -> bool {
    let Some(path) = path_from_file_uri(uri) else {
        return false;
    };
    let Ok(root) = workspace_root.canonicalize() else {
        return false;
    };
    if let Ok(path) = path.canonicalize() {
        return path != root && path.starts_with(root);
    }
    authorize_nonexistent_absolute(&root, &path)
}

pub(super) fn authorize_nonexistent_absolute(root: &Path, path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let mut parent = path;
    while !parent.exists() {
        let Some(next) = parent.parent() else {
            return false;
        };
        parent = next;
    }
    parent
        .canonicalize()
        .is_ok_and(|canonical| canonical == root || canonical.starts_with(root))
        && path.strip_prefix(root).is_ok()
}

pub(super) fn path_from_file_uri(uri: &str) -> Option<PathBuf> {
    let encoded = uri.strip_prefix("file://")?;
    if !encoded.starts_with('/') {
        return None;
    }
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(pair, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let text = String::from_utf8(decoded).ok()?;
    if text.chars().any(char::is_control) {
        return None;
    }
    #[cfg(windows)]
    let text = text.strip_prefix('/').unwrap_or(&text).to_string();
    Some(PathBuf::from(text))
}

pub(super) fn file_uri(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~' | b':') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    if encoded.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "ide-jdtls-{label}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn java_document_paths_authorize_existing_and_new_files_and_reject_escape() {
        let root = temp_dir("document-paths");
        fs::create_dir_all(root.join("src/existing")).unwrap();
        fs::write(root.join("src/existing/Main.java"), "class Main {}").unwrap();

        let (existing, existing_uri) =
            authorize_java_path(&root, "src/existing/Main.java").unwrap();
        assert_eq!(existing, "src/existing/Main.java");
        assert_eq!(existing_uri, file_uri(&root.join("src/existing/Main.java")));
        let (new_path, new_uri) = authorize_java_path(&root, "src/new/Created.java").unwrap();
        assert_eq!(new_path, "src/new/Created.java");
        assert_eq!(new_uri, file_uri(&root.join("src/new/Created.java")));

        for invalid in [
            "../Secret.java",
            "/tmp/Main.java",
            "src/./Main.java",
            "src/Main.kt",
            "src/Bad\0.java",
        ] {
            assert!(
                authorize_java_path(&root, invalid).is_err(),
                "accepted {invalid:?}"
            );
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outside = temp_dir("document-outside");
            symlink(&outside, root.join("linked")).unwrap();
            assert!(authorize_java_path(&root, "linked/Secret.java").is_err());
            let _ = fs::remove_dir_all(outside);
        }
        let _ = fs::remove_dir_all(root);
    }
}
