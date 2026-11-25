//! Real exporter failures must remain failures while useful, bounded messages reach the IDE.
use super::*;

struct Environment(Vec<(&'static str, Option<std::ffi::OsString>)>);
impl Environment {
    fn set(values: &[(&'static str, std::ffi::OsString)]) -> Self {
        let previous = values
            .iter()
            .map(|(key, value)| {
                let old = std::env::var_os(key);
                std::env::set_var(key, value);
                (*key, old)
            })
            .collect();
        Self(previous)
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        for (key, value) in self.0.drain(..) {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}
struct TraceDirectory(PathBuf);
impl Drop for TraceDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
struct RestoreCachePermissions(PathBuf);
#[cfg(unix)]
impl Drop for RestoreCachePermissions {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o700));
    }
}

#[cfg(unix)]
fn protect_native_locks(directory: &Path) -> usize {
    use std::os::unix::fs::PermissionsExt;
    let mut count = 0;
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            count += protect_native_locks(&path);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "lock")
        {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
            assert!(fs::OpenOptions::new().write(true).open(path).is_err());
            count += 1;
        }
    }
    count
}

#[cfg(unix)]
fn qualify(case: &str) {
    use std::os::unix::fs::PermissionsExt;
    assert_ne!(
        unsafe { libc::geteuid() },
        0,
        "Real permission refusal needs an unprivileged user."
    );
    let fixture = Fixture::new();
    let trace_root = fixture.root.with_extension("trace");
    let trace = trace_root.join("artifacts/java-project-context-snapshot-trace.jsonl");
    fs::create_dir_all(trace.parent().unwrap()).unwrap();
    let _trace_directory = TraceDirectory(trace_root.clone());
    let sdk = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Set IDE_JAVA_CONTEXT_TEST_JDK");
    let executable =
        std::env::var("IDE_JAVA_CONTEXT_TEST_GRADLE").expect("Set IDE_JAVA_CONTEXT_TEST_GRADLE");
    let daemon =
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set IDE_REAL_REFACTORKIT_DAEMON");
    let _environment = Environment::set(&[
        ("IDE_REFACTORKIT_DAEMON", daemon),
        ("IDE_JAVA_CONTEXT_TRACE", "1".into()),
        ("IDE_JAVA_CONTEXT_TRACE_PATH", trace.as_os_str().to_owned()),
        (
            "IDE_STORY_NATIVE_GUI_SANDBOX_PATH",
            trace_root.as_os_str().to_owned(),
        ),
    ]);
    let files = [
        ("settings.gradle", "rootProject.name='diagnostic-project'\n"),
        ("gradle.properties", "org.gradle.daemon=false\norg.gradle.workers.max=2\n"),
        ("build.gradle", "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\ntasks.withType(JavaCompile).configureEach { options.release = 17 }\nprintln('IDE_DIAGNOSTIC_SECRET_42')\n"),
        ("src/main/java/sample/Example.java", "package sample; public final class Example { public static int answer() { return 42; } }\n"),
        ("src/test/java/sample/ExampleTest.java", "package sample; public class ExampleTest { @org.junit.Test public void answer() { org.junit.Assert.assertEquals(42, Example.answer()); } }\n"),
    ];
    for (relative, contents) in files {
        let path = fixture.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
    let cache = if case == "success" {
        PathBuf::from(
            std::env::var_os("IDE_JAVA_CONTEXT_TEST_GRADLE_HOME")
                .expect("Set a populated writable IDE_JAVA_CONTEXT_TEST_GRADLE_HOME"),
        )
    } else {
        fixture.root.join(".ide/gradle-cache")
    };
    fs::create_dir_all(&cache).unwrap();
    if case == "permission" {
        let initialized = std::process::Command::new(&executable)
            .env("JAVA_HOME", &sdk)
            .args(["--offline", "--no-daemon", "-g"])
            .arg(&cache)
            .arg("--version")
            .output()
            .unwrap();
        assert!(
            initialized.status.success(),
            "{}",
            String::from_utf8_lossy(&initialized.stderr)
        );
        assert!(protect_native_locks(&cache.join("native")) > 0);
    }
    let _permissions = ["permission", "opaque"].contains(&case).then(|| {
        fs::set_permissions(&cache, fs::Permissions::from_mode(0o500)).unwrap();
        assert!(fs::write(cache.join("permission-probe"), "refuse").is_err());
        RestoreCachePermissions(cache.clone())
    });
    let state = JavaProjectContextState::default();
    let mut request = fixture.request();
    request.sdk_home = sdk;
    request.gradle = Some(GradleSettings {
        executable,
        user_home: cache.to_string_lossy().into(),
        gradle_runtime_home: None,
        project_properties: BTreeMap::new(),
    });
    request.evaluate_gradle = Some(true);
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let observed = query_owned(fixture.binding.clone(), request, state.0.clone(), ticket).unwrap();
    if case == "success" {
        assert_eq!(observed["status"], "available", "{observed}");
        assert_eq!(observed["gradleSync"]["providerId"], "gradle-effective-v1");
    } else {
        assert_eq!(observed["status"], "refused", "{observed}");
        assert_eq!(observed["code"], "gradle.sync.exportFailed", "{observed}");
        assert!(observed.get("context").is_none(), "{observed}");
        let records = fs::read_to_string(&trace)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        let receipt = &records
            .iter()
            .find(|record| {
                record["event"] == "refactorkit.daemon.rpc.response"
                    && record["details"]["method"] == "project.sync"
            })
            .expect("actual daemon project.sync response")["details"]["response"]["result"];
        assert_eq!(
            receipt["error"]["cause"]["evidence"], "process-output",
            "{receipt}"
        );
        eprintln!(
            "GRADLE_DIAGNOSTIC_OBSERVATION case={case} native={observed} providerError={}",
            receipt["error"]
        );
        let expected = if case == "permission" {
            "gradle.sync.cause.cachePermissionDenied"
        } else if case == "opaque" {
            "gradle.sync.cause.unknown"
        } else {
            "gradle.sync.cause.offlineDependencyUnavailable"
        };
        assert_eq!(receipt["error"]["cause"]["code"], expected, "{receipt}");
        assert_eq!(observed["gradleFailureCause"], expected, "{observed}");
        assert_eq!(
            observed["message"], receipt["error"]["message"],
            "The IDE must preserve the real provider message"
        );
        let message = observed["message"].as_str().unwrap();
        assert!(message.len() <= 4096);
        for excluded in [
            fixture.root.to_str().unwrap(),
            cache.to_str().unwrap(),
            "IDE_DIAGNOSTIC_SECRET_42",
            "https://",
            "http://",
        ] {
            assert!(!message.contains(excluded), "Raw output leaked: {message}");
        }
        eprintln!(
            "GRADLE_DIAGNOSTIC case={case} cause={} nativeMessage={message}",
            receipt["error"]["cause"]["code"]
        );
    }
    for (relative, contents) in files {
        assert_eq!(
            fs::read_to_string(fixture.root.join(relative)).unwrap(),
            contents
        );
    }
    state.shutdown_all();
}

#[test]
#[cfg(unix)]
#[ignore = "requires a real diagnostic-capable RefactorKit, Gradle, JDK and unprivileged Unix user; run serially"]
fn real_gradle_permission_diagnostic_reaches_the_native_ide() {
    qualify("permission");
}
#[test]
#[cfg(unix)]
#[ignore = "requires a real diagnostic-capable RefactorKit, Gradle and JDK; run serially"]
fn real_gradle_offline_diagnostic_reaches_the_native_ide() {
    qualify("offline");
}
#[test]
#[cfg(unix)]
#[ignore = "requires a real RefactorKit, Gradle, JDK and populated writable dependency cache; run serially"]
fn real_gradle_success_remains_available_with_diagnostic_runtime() {
    qualify("success");
}

#[test]
#[cfg(unix)]
#[ignore = "requires real diagnostic RefactorKit, Gradle and JDK; qualifies opaque output from an empty nonwritable cache; run serially"]
fn real_gradle_opaque_permission_output_does_not_invent_a_cause() {
    qualify("opaque");
}
