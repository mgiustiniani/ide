use super::*;

fn testng_classpath(root: &Path) -> Vec<String> {
    let configured = std::env::var_os("IDE_TESTNG_CLASSPATH")
        .expect("set IDE_TESTNG_CLASSPATH to TestNG and its runtime dependency JARs");
    let library = root.join("lib");
    fs::create_dir_all(&library).unwrap();
    std::env::split_paths(&configured)
        .enumerate()
        .map(|(index, source)| {
            let source = source
                .canonicalize()
                .expect("every TestNG classpath entry must exist");
            assert!(source.is_file(), "TestNG classpath entries must be files");
            let destination = library.join(format!("testng-dependency-{index}.jar"));
            fs::copy(source, &destination).unwrap();
            destination
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned()
        })
        .collect()
}

#[test]
#[ignore = "requires IDE_JUNIT_PLATFORM_CONSOLE_JAR and a JDK 17 or newer"]
fn real_jdk_compiles_runs_and_collects_fresh_console_launcher_reports() {
    let console_jar = std::env::var_os("IDE_JUNIT_PLATFORM_CONSOLE_JAR")
        .map(PathBuf::from)
        .expect("set IDE_JUNIT_PLATFORM_CONSOLE_JAR to a JUnit ConsoleLauncher standalone JAR");
    let console_jar = console_jar
        .canonicalize()
        .expect("JUnit ConsoleLauncher JAR must exist");
    assert!(console_jar.is_file(), "ConsoleLauncher must be a file");

    let (root, binding) = fixture();
    let library = root.join("lib");
    fs::create_dir_all(&library).unwrap();
    let local_console_jar = library.join("junit-platform-console-standalone.jar");
    fs::copy(console_jar, &local_console_jar).unwrap();
    fs::create_dir_all(root.join("src/test/java/fixture")).unwrap();
    fs::write(
        root.join("src/test/java/fixture/JdkConsoleTest.java"),
        r#"package fixture;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.fail;

public class JdkConsoleTest {
  @Test public void works() throws Exception {
    Files.writeString(Path.of("works.txt"), "called");
  }

  @Test public void fails() throws Exception {
    Files.writeString(Path.of("fails.txt"), "called");
    fail("expected fixture failure");
  }
}
"#,
    )
    .unwrap();

    let home = selected_jdk("").expect("an installed JDK is required");
    let state = JavaExecutionState::default();
    let mut all_tests = request(&binding, "test");
    all_tests.configuration.jdk_home = home.to_string_lossy().into_owned();
    all_tests.configuration.class_path = vec!["lib/junit-platform-console-standalone.jar".into()];
    state.start(binding.clone(), all_tests).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let completed = wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "succeeded" | "failed" | "stopped")
    });
    assert_eq!(completed.state, "failed", "{}", completed.output);
    let results = completed.test_results.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{}", completed.output);
    assert_eq!(results.summary.total, 2);
    assert_eq!(results.summary.passed, 1);
    assert_eq!(results.summary.failed, 1);
    assert_eq!(
        fs::read_to_string(root.join("works.txt")).unwrap(),
        "called"
    );
    assert_eq!(
        fs::read_to_string(root.join("fails.txt")).unwrap(),
        "called"
    );
    let first_report = results.suites[0].report_path.clone();
    assert!(first_report.starts_with(".ide/java/test-results/run-"));

    fs::remove_file(root.join("fails.txt")).unwrap();
    let mut selected = request(&binding, "test");
    selected.configuration.jdk_home = home.to_string_lossy().into_owned();
    selected.configuration.class_path = vec!["lib/junit-platform-console-standalone.jar".into()];
    selected.configuration.test_filter = "fixture.JdkConsoleTest#works".into();
    state.start(binding.clone(), selected).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let completed = wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "succeeded" | "failed" | "stopped")
    });
    assert_eq!(completed.state, "succeeded", "{}", completed.output);
    let results = completed.test_results.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{}", completed.output);
    assert_eq!(results.summary.total, 1);
    assert_eq!(results.summary.passed, 1);
    assert_eq!(results.summary.failed, 0);
    assert!(!root.join("fails.txt").exists());
    assert_ne!(results.suites[0].report_path, first_report);

    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires IDE_TESTNG_CLASSPATH and a full JDK compatible with that TestNG version"]
fn real_jdk_testng_runs_suites_reruns_failures_and_uses_captured_discovery() {
    let (root, binding) = fixture();
    let class_path = testng_classpath(&root);
    let source_path = root.join("src/test/java/fixture/PlainJdkTestNgTest.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    let source = r#"package fixture;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import org.testng.Assert;
import org.testng.annotations.Test;
public class PlainJdkTestNgTest {
  @Test public void works() throws Exception {
    Assert.assertEquals(System.getProperty("fixture.testng.literal"), "café 'quoted'\nline");
    String home = Paths.get(System.getProperty("java.home")).toRealPath().toString();
    Files.write(Paths.get("works.txt"), home.getBytes(StandardCharsets.UTF_8));
  }
  @Test public void fails() throws Exception {
    Files.write(Paths.get("fails.txt"), "called".getBytes(StandardCharsets.UTF_8));
    Assert.fail("expected fixture failure");
  }
}
"#;
    fs::write(&source_path, source).unwrap();
    let home = selected_jdk("").expect("an installed JDK is required");
    let runtime_home = if java8_launcher(&home) && home.join("jre").is_dir() {
        home.join("jre")
    } else {
        home.clone()
    }.canonicalize().unwrap();
    let literal = "-Dfixture.testng.literal=café 'quoted'\nline".to_owned();
    let state = JavaExecutionState::default();
    let mut run_all = request(&binding, "test");
    run_all.configuration.jdk_home = home.to_string_lossy().into_owned();
    run_all.configuration.test_framework = "testng".into();
    run_all.configuration.class_path = class_path.clone();
    run_all.configuration.test_jvm_options = vec![literal.clone()];
    state.start(binding.clone(), run_all).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let failed = wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "succeeded" | "failed" | "stopped")
    });
    assert_eq!(failed.state, "failed", "{}", failed.output);
    let results = failed.test_results.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{}", failed.output);
    assert_eq!(results.summary.total, 2);
    assert_eq!(results.summary.passed, 1);
    assert_eq!(results.summary.failed, 1);
    assert_eq!(
        fs::read_to_string(root.join("works.txt")).unwrap(),
        runtime_home.to_str().unwrap()
    );
    assert_eq!(
        fs::read_to_string(root.join("fails.txt")).unwrap(),
        "called"
    );
    assert!(results.suites[0]
        .report_path
        .contains("/junitreports/TEST-fixture.PlainJdkTestNgTest.xml"));

    fs::write(
        &source_path,
        source.replace(
            "Assert.fail(\"expected fixture failure\");",
            "Assert.assertTrue(true);",
        ),
    )
    .unwrap();
    state
        .rerun_failed(
            binding.clone(),
            RerunRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: failed.session_id,
                trusted: true,
                debug: false,
                source_breakpoints: vec![],
            },
        )
        .unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let repaired = wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "succeeded" | "failed" | "stopped")
    });
    assert_eq!(repaired.state, "succeeded", "{}", repaired.output);
    assert_eq!(repaired.test_results.as_ref().unwrap().summary.total, 1);
    assert_eq!(repaired.test_results.as_ref().unwrap().summary.passed, 1);

    fs::remove_file(root.join("works.txt")).unwrap();
    fs::remove_file(root.join("fails.txt")).unwrap();
    let mut discover = request(&binding, "discover");
    discover.configuration.jdk_home = home.to_string_lossy().into_owned();
    discover.configuration.class_path = class_path;
    discover.configuration.test_jvm_options = vec![literal];
    state.start(binding.clone(), discover).unwrap();
    let discovered = {
        let job = state.job.lock().unwrap().clone().unwrap();
        wait_for(&job, |snapshot| {
            matches!(snapshot.state.as_str(), "succeeded" | "failed" | "stopped")
        })
    };
    assert_eq!(discovered.state, "succeeded", "{}", discovered.output);
    let results = discovered.test_discovery.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{}", discovered.output);
    let selected_test = results
        .tests
        .iter()
        .find(|test| {
            test.class_name == "fixture.PlainJdkTestNgTest"
                && test.method_name.as_deref() == Some("works")
        })
        .expect("JDK discovery returns the TestNG method identity");
    assert!(selected_test.label.contains("TestNG"));
    assert!(
        !root.join("works.txt").exists(),
        "discovery ran a test body"
    );
    assert!(!root.join("fails.txt").exists(), "discovery ran the companion");

    let mut selected = request(&binding, "test");
    selected.test_selection = Some(TestSelection {
        discovery_session_id: discovered.session_id,
        test_id: selected_test.id.clone(),
    });
    selected.configuration.project_path = "does-not-exist-after-discovery".into();
    selected.configuration.jdk_home = "/missing-jdk-after-discovery".into();
    state.start(binding.clone(), selected).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let completed = wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "succeeded" | "failed" | "stopped")
    });
    assert_eq!(completed.state, "succeeded", "{}", completed.output);
    assert_eq!(completed.test_results.as_ref().unwrap().summary.total, 1);
    assert!(!root.join("fails.txt").exists(), "selection ran the companion");
    assert_eq!(
        fs::read_to_string(root.join("works.txt")).unwrap(),
        runtime_home.to_str().unwrap()
    );
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
#[ignore = "requires IDE_GRADLE_TEST_EXECUTABLE, IDE_TESTNG_CLASSPATH and optional IDE_TEST_OTHER_JDK"]
fn real_gradle_unicode_method_sources_preserve_inherited_declarations_on_test_jvm() {
    use std::os::unix::fs::PermissionsExt;
    let (root, binding) = fixture();
    let classpath = testng_classpath(&root);
    let gradle = PathBuf::from(
        std::env::var_os("IDE_GRADLE_TEST_EXECUTABLE")
            .expect("set an absolute Gradle 9.4+ executable"),
    )
    .canonicalize()
    .unwrap();
    let quoted = gradle.to_string_lossy().replace('\'', "'\\''");
    fs::write(
        root.join("gradlew"),
        format!("#!/bin/sh\nexec '{quoted}' --offline --no-daemon \"$@\"\n"),
    )
    .unwrap();
    fs::set_permissions(root.join("gradlew"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(
        root.join("settings.gradle"),
        "rootProject.name = 'unicode-methods'\n",
    )
    .unwrap();
    let test_source = root.join("src/test/java/café/Próva𐐀.java");
    fs::create_dir_all(test_source.parent().unwrap()).unwrap();
    fs::write(&test_source, "package café;\nimport org.testng.annotations.Test;\ninterface Contrât𐐀 { @Test default void réussit𐐀() {} }\npublic class Próva𐐀 implements Contrât𐐀 { @Test public void échoue() { throw new AssertionError(\"UNICODE_EXPECTED_FAILURE\"); } }\n").unwrap();
    let mut homes = vec![selected_jdk("").unwrap()];
    if let Some(other) = std::env::var_os("IDE_TEST_OTHER_JDK") {
        homes.push(PathBuf::from(other).canonicalize().unwrap());
    }
    let dependencies = classpath
        .iter()
        .map(|entry| format!("'{entry}'"))
        .collect::<Vec<_>>()
        .join(",");
    let state = JavaExecutionState::default();
    for home in homes {
        let java = home
            .join("bin/java")
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('\'', "\\'");
        fs::write(root.join("build.gradle"), format!("plugins {{ id 'java' }}\ndependencies {{ testImplementation files({dependencies}) }}\ntasks.withType(JavaCompile).configureEach {{ options.release.set(8) }}\ntest {{ useTestNG(); executable = '{java}'; outputs.upToDateWhen {{ false }} }}\n")).unwrap();
        let mut run = request(&binding, "test");
        run.configuration.build_tool = "gradle".into();
        state.start(binding.clone(), run).unwrap();
        let job = state.job.lock().unwrap().clone().unwrap();
        let snapshot = wait_for(&job, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(snapshot.state, "failed", "{}", snapshot.output);
        let results = snapshot.test_results.as_ref().unwrap();
        assert_eq!(results.status, "ready", "{results:?}\n{}", snapshot.output);
        assert_eq!(results.summary.total, 2);
        assert_eq!(results.summary.failed, 1);
        let inherited = results
            .suites
            .iter()
            .flat_map(|suite| &suite.cases)
            .find(|case| case.state == "passed")
            .unwrap();
        let source = inherited
            .method_source
            .as_ref()
            .expect("the Unicode inherited method must retain compiled declaration metadata");
        assert_eq!(source.method_name, "réussit𐐀");
        assert_eq!(
            source.declaring_class_name.as_deref(),
            Some("café.Contrât𐐀")
        );
        assert!(source.declaring_origin.is_some());
        assert!(results.can_rerun_failed, "{results:?}");
        assert_eq!(results.rerun_selections.len(), 1);
        assert_eq!(results.rerun_selections[0].class_name, "café.Próva𐐀");
        assert_eq!(
            results.rerun_selections[0].method_name.as_deref(),
            Some("échoue")
        );
    }
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
