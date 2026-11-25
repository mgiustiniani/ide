//! Read the mandatory JDT Core bundle's declared Java execution environment.

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

const MAX_JAR_BYTES: u64 = 32 * 1024 * 1024;
// Signed Eclipse bundles carry per-entry digests after their main manifest section.
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

pub(super) fn required_java(home: &Path) -> Result<Option<u32>, String> {
    let mut bundles = Vec::new();
    for entry in fs::read_dir(home.join("plugins"))
        .map_err(|e| format!("Cannot inspect JDT bundles: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Cannot inspect JDT bundle: {e}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("org.eclipse.jdt.core_") && name.ends_with(".jar") {
            bundles.push(entry.path());
        }
    }
    if bundles.is_empty() {
        return Ok(None);
    }
    if bundles.len() != 1 {
        return Err("JDT LS contains ambiguous JDT Core bundles".into());
    }
    let metadata =
        fs::metadata(&bundles[0]).map_err(|e| format!("Cannot inspect JDT Core bundle: {e}"))?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_JAR_BYTES {
        return Err("JDT Core bundle must be a regular JAR no larger than 32 MiB".into());
    }
    let file = File::open(&bundles[0]).map_err(|e| format!("Cannot read JDT Core bundle: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Cannot read JDT Core JAR: {e}"))?;
    if archive.len() > 16_384 {
        return Err("JDT Core JAR has too many entries".into());
    }
    let manifest = archive
        .by_name("META-INF/MANIFEST.MF")
        .map_err(|e| format!("Cannot read JDT Core manifest: {e}"))?;
    if manifest.size() > MAX_MANIFEST_BYTES {
        return Err("JDT Core manifest exceeds 1 MiB".into());
    }
    let mut text = String::new();
    manifest
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| format!("Cannot read JDT Core manifest: {e}"))?;
    if text.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("JDT Core manifest exceeds 1 MiB".into());
    }
    manifest_java(&text)
}

fn manifest_java(text: &str) -> Result<Option<u32>, String> {
    let mut headers = Vec::<String>::new();
    for line in text.lines() {
        if line.is_empty() {
            break;
        } // Only the main manifest section declares requirements.
        if let Some(continued) = line.strip_prefix(' ') {
            let previous = headers
                .last_mut()
                .ok_or("Invalid JDT Core manifest continuation")?;
            previous.push_str(continued);
        } else {
            headers.push(line.to_string());
        }
    }
    let mut requirement = None;
    for header in headers {
        let Some((name, value)) = header.split_once(':') else {
            continue;
        };
        if !name.eq_ignore_ascii_case("Bundle-RequiredExecutionEnvironment") {
            continue;
        }
        if requirement.is_some() {
            return Err("Duplicate JDT Core execution-environment header".into());
        }
        requirement = Some(value.trim().to_string());
    }
    let Some(value) = requirement else {
        return Ok(None);
    };
    let mut minimum = None;
    for alternative in value.split(',').map(str::trim) {
        let Some(version) = alternative.strip_prefix("JavaSE-") else {
            return Ok(None);
        };
        let version = version.strip_prefix("1.").unwrap_or(version);
        let major = version
            .parse::<u32>()
            .ok()
            .filter(|major| (8..=99).contains(major))
            .ok_or("Invalid JDT Core Java execution environment")?;
        minimum = Some(minimum.map_or(major, |previous: u32| previous.min(major)));
    }
    Ok(minimum)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_main_manifest_requirements_and_continuations() {
        assert_eq!(
            manifest_java(
                "Manifest-Version: 1.0\r\nBundle-RequiredExecutionEnvironment: JavaSE-25\r\n\r\n"
            )
            .unwrap(),
            Some(25)
        );
        assert_eq!(
            manifest_java("Bundle-RequiredExecutionEnvironment: JavaSE-25,\n JavaSE-21\n\n")
                .unwrap(),
            Some(21)
        );
        assert_eq!(
            manifest_java("Bundle-RequiredExecutionEnvironment: JavaSE-1.8\n").unwrap(),
            Some(8)
        );
        assert_eq!(manifest_java("Manifest-Version: 1.0\n\nName: entry\nBundle-RequiredExecutionEnvironment: JavaSE-99\n").unwrap(), None);
        assert!(manifest_java("Bundle-RequiredExecutionEnvironment: JavaSE-bad\n").is_err());
        assert!(manifest_java("Bundle-RequiredExecutionEnvironment: JavaSE-21\nBundle-RequiredExecutionEnvironment: JavaSE-25\n").is_err());
        assert_eq!(
            manifest_java("Bundle-RequiredExecutionEnvironment: CDC-1.1,JavaSE-21\n").unwrap(),
            None
        );
    }

    #[test]
    fn reads_real_jar_manifest_and_rejects_oversized_or_ambiguous_bundles() {
        let root = std::env::temp_dir().join(format!(
            "ide-jdt-bundle-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("plugins")).unwrap();
        let bundle = root.join("plugins/org.eclipse.jdt.core_1.jar");
        let write_jar = |manifest: &str| {
            let mut jar = zip::ZipWriter::new(File::create(&bundle).unwrap());
            jar.start_file(
                "META-INF/MANIFEST.MF",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            jar.write_all(manifest.as_bytes()).unwrap();
            jar.finish().unwrap();
        };
        write_jar("Bundle-RequiredExecutionEnvironment: JavaSE-25\n");
        assert_eq!(required_java(&root).unwrap(), Some(25));
        write_jar(&"x".repeat(MAX_MANIFEST_BYTES as usize + 1));
        assert!(required_java(&root).unwrap_err().contains("1 MiB"));
        write_jar("Bundle-RequiredExecutionEnvironment: JavaSE-21\n");
        fs::copy(&bundle, root.join("plugins/org.eclipse.jdt.core_2.jar")).unwrap();
        assert!(required_java(&root).unwrap_err().contains("ambiguous"));
        fs::remove_file(root.join("plugins/org.eclipse.jdt.core_2.jar")).unwrap();
        File::create(&bundle)
            .unwrap()
            .set_len(MAX_JAR_BYTES + 1)
            .unwrap();
        assert!(required_java(&root).unwrap_err().contains("32 MiB"));
        fs::write(&bundle, b"not a ZIP archive").unwrap();
        assert!(required_java(&root)
            .unwrap_err()
            .contains("Cannot read JDT Core JAR"));
        fs::remove_dir_all(root).unwrap();
    }
}
