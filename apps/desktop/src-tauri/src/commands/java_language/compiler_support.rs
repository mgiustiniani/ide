//! Ask the selected JDT Core about its language support, independently of the server JVM.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::toolchain::{run_probe, JavaInstall, JdtlsInstall};

static PROBE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const PREFIX: &str = "IDE_JDT_LATEST_SOURCE=";
// JavaCore is the public API of the compiler selected with this language server.
// No project sources or build configuration are read by this helper.
const SOURCE: &str = r#"import org.eclipse.jdt.core.JavaCore;
class IdeJdtCompilerSupport {
    public static void main(String[] args) {
        System.out.println("IDE_JDT_LATEST_SOURCE=" + JavaCore.latestSupportedJavaVersion());
    }
}
"#;

struct ProbeDirectory(PathBuf);

impl Drop for ProbeDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn latest_source(jdtls: &JdtlsInstall, java: &JavaInstall) -> Result<u32, String> {
    let directory = std::env::temp_dir().join(format!(
        "ide-jdt-compiler-support-{}-{}",
        std::process::id(),
        PROBE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    // create_dir must fail on an existing entry; never follow or clean up an old path.
    fs::create_dir(&directory).map_err(|_| "Cannot create the private JDT compiler probe")?;
    let directory = ProbeDirectory(directory);
    let source = directory.0.join("IdeJdtCompilerSupport.java");
    fs::write(&source, SOURCE).map_err(|_| "Cannot prepare the private JDT compiler probe")?;
    let classpath = jdtls.home.join("plugins").join("*");
    let output = run_probe(
        &java.executable,
        &[
            "--class-path",
            classpath.to_str().ok_or("JDT LS classpath is not UTF-8")?,
            source
                .to_str()
                .ok_or("JDT compiler probe path is not UTF-8")?,
        ],
        Duration::from_secs(15),
    )
    .map_err(|_| "Cannot determine the selected JDT compiler's supported Java release")?;
    parse_latest_source(&output)
}

fn parse_latest_source(output: &str) -> Result<u32, String> {
    let mut releases = output.lines().filter_map(|line| line.strip_prefix(PREFIX));
    let release = releases
        .next()
        .and_then(|release| release.parse::<u32>().ok())
        .filter(|release| (8..=999).contains(release));
    match (release, releases.next()) {
        (Some(release), None) => Ok(release),
        _ => Err("The JDT compiler returned an invalid supported Java release".into()),
    }
}

pub(super) fn require_preview_release(latest: u32, requested: u64) -> Result<(), String> {
    if u64::from(latest) == requested {
        Ok(())
    } else {
        Err(format!(
            "Gradle enables Java {requested} preview features, but the selected JDT compiler supports preview features for Java {latest} only. Select a compatible JDT LS installation; changing the server JDK does not change its compiler."
        ))
    }
}

pub(super) fn diagnostic_refusal(
    settings: &serde_json::Value,
    latest: u32,
) -> Result<Option<String>, String> {
    let invalid = || {
        "JDT LS diagnostics are unavailable: JDT LS has not returned valid compiler settings for this file. Refresh the language service after project import.".to_string()
    };
    let source = settings
        .get("org.eclipse.jdt.core.compiler.source")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(invalid)?;
    let source = if source == "1.8" {
        8
    } else {
        source
            .parse::<u32>()
            .ok()
            .filter(|release| (8..=999).contains(release) && release.to_string() == source)
            .ok_or_else(invalid)?
    };
    let preview = settings
        .get("org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures")
        .and_then(serde_json::Value::as_str)
        .filter(|preview| matches!(*preview, "enabled" | "disabled"))
        .ok_or_else(invalid)?;
    if source > latest {
        Ok(Some(format!("JDT LS diagnostics are unavailable: the project uses Java {source}, but the selected JDT compiler supports Java through {latest}. Select a compatible JDT LS installation.")))
    } else if preview == "enabled" && source != latest {
        Ok(Some(format!("JDT LS diagnostics are unavailable: the project enables Java {source} preview features, but the selected JDT compiler supports preview features for Java {latest} only. Select a compatible JDT LS installation.")))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_options_distinguish_ordinary_source_from_exact_preview_support() {
        let options = |source: &str, preview: &str| {
            serde_json::json!({
                "org.eclipse.jdt.core.compiler.source":source,
                "org.eclipse.jdt.core.compiler.problem.enablePreviewFeatures":preview
            })
        };
        assert_eq!(
            diagnostic_refusal(&options("26", "disabled"), 27).unwrap(),
            None
        );
        assert_eq!(
            diagnostic_refusal(&options("1.8", "disabled"), 27).unwrap(),
            None
        );
        assert_eq!(
            diagnostic_refusal(&options("27", "enabled"), 27).unwrap(),
            None
        );
        assert!(diagnostic_refusal(&options("26", "enabled"), 27)
            .unwrap()
            .unwrap()
            .contains("Java 27 only"));
        assert!(diagnostic_refusal(&options("28", "disabled"), 27)
            .unwrap()
            .unwrap()
            .contains("through 27"));
        assert!(diagnostic_refusal(&options("27", "unknown"), 27).is_err());
        assert!(diagnostic_refusal(&options("1.27", "enabled"), 27).is_err());
        assert!(diagnostic_refusal(&serde_json::json!({}), 27).is_err());
    }

    #[test]
    fn compiler_output_requires_one_valid_release_without_guessing_from_warnings() {
        assert_eq!(
            parse_latest_source("IDE_JDT_LATEST_SOURCE=27\n").unwrap(),
            27
        );
        assert_eq!(
            parse_latest_source("WARNING: JVM 25\nIDE_JDT_LATEST_SOURCE=26\n").unwrap(),
            26
        );
        for output in [
            "27",
            "IDE_JDT_LATEST_SOURCE=unknown",
            "IDE_JDT_LATEST_SOURCE=7",
            "IDE_JDT_LATEST_SOURCE=27\nIDE_JDT_LATEST_SOURCE=26",
        ] {
            assert!(parse_latest_source(output).is_err(), "{output}");
        }
    }

    #[test]
    fn preview_support_comes_from_the_compiler_and_requires_the_exact_release() {
        assert!(require_preview_release(27, 27).is_ok());
        assert!(require_preview_release(26, 26).is_ok());
        assert!(require_preview_release(27, 26)
            .unwrap_err()
            .contains("Java 27 only"));
        assert!(require_preview_release(26, 27).is_err());
        assert!(require_preview_release(27, 21).is_err());
    }

    #[test]
    #[ignore = "requires an explicitly selected real JDT LS installation and server JDK"]
    fn selected_compiler_reports_its_release_independently_of_the_server_jdk() {
        let install = super::super::toolchain::discover_jdtls().unwrap();
        let java = super::super::toolchain::discover_jdtls_java_with_home(&install, None).unwrap();
        let expected: u32 = std::env::var("IDE_EXPECT_JDT_COMPILER_RELEASE")
            .unwrap()
            .parse()
            .unwrap();
        let actual = latest_source(&install, &java).unwrap();
        assert_eq!(actual, expected);
        println!("JDT compiler release {actual}; server {}", java.version);
    }
}
