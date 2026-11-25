use super::*;

const LITERAL: &str = "literal = both'\"quotes\\slash\n😀 $(touch test-vm-injected.txt)";
fn test_project(
    kind: &str,
    maven_configuration: &str,
) -> (PathBuf, CurrentWorkspaceBinding, String) {
    let (root, binding) = fixture();
    fs::create_dir_all(root.join("src/test/java")).unwrap();
    let descriptor = if kind == "maven" {
        format!(
            r#"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>test-jvm</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding><argLine>-Xmx128m -Dfixture.project=retained</argLine></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version>{maven_configuration}</plugin></plugins></build></project>"#
        )
    } else {
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name='test-jvm'\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
        "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\ntest { useJUnit(); maxHeapSize = '128m'; systemProperty 'fixture.project', 'retained' }\n".into()
    };
    fs::write(
        root.join(if kind == "maven" {
            "pom.xml"
        } else {
            "build.gradle"
        }),
        &descriptor,
    )
    .unwrap();
    (root, binding, descriptor)
}
fn selected_test_home() -> PathBuf {
    let default = jdk_home().expect("installed JDK").canonicalize().unwrap();
    match std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
        Ok(value) => {
            let selected = selected_jdk(&value).unwrap();
            assert_ne!(
                selected, default,
                "alternate qualification needs two JDK installations"
            );
            selected
        }
        Err(_) => default,
    }
}

fn with_failsafe(descriptor: &str, configuration: &str) -> String {
    descriptor.replace(
        "</plugins>",
        &format!(r#"
            <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version>
                {configuration}<executions><execution><id>integration-tests</id><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions>
            </plugin></plugins>"#),
    )
}
fn source(configured: bool, broken: bool, kind: &str) -> String {
    let checks = if configured {
        format!(
            r#"
    Assert.assertEquals({}, System.getProperty("fixture.test.literal"));
    Assert.assertEquals("", System.getProperty("fixture.test.empty"));
    Assert.assertTrue(java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().contains("-Xmx96m"));
    Assert.assertTrue(Runtime.getRuntime().maxMemory() >= 80L*1024*1024 && Runtime.getRuntime().maxMemory() <= 128L*1024*1024);
    {};
"#,
            serde_json::to_string(LITERAL).unwrap(),
            if kind == "gradle" {
                "Assert.assertEquals(\"retained\", System.getProperty(\"fixture.project\"))"
            } else {
                "Assert.assertNull(System.getProperty(\"fixture.project\"))"
            }
        )
    } else {
        "Assert.assertNull(System.getProperty(\"fixture.test.literal\")); Assert.assertEquals(\"retained\", System.getProperty(\"fixture.project\"));".into()
    };
    format!(
        r#"import org.junit.*; import java.nio.file.*;
public class OptionsTest {{
  @Test public void configured() throws Exception {{
    {checks}
    Assert.assertNull(System.getProperty("fixture.application"));
    Assert.assertEquals("literal environment 😀", System.getenv("IDE_TEST_JVM_MODE"));
    Files.writeString(Path.of("test-jvm-proof.txt"), String.valueOf(System.getProperty("fixture.test.literal")) + "\nEMPTY=" + System.getProperty("fixture.test.empty") + "\nJDK=" + Path.of(System.getProperty("java.home")).toRealPath() + "\nJAVA_HOME=" + Path.of(System.getenv("JAVA_HOME")).toRealPath());
    Assert.assertFalse("repair this expectation", {broken});
  }}
  @Test public void companion() throws Exception {{ Files.writeString(Path.of("companion-proof.txt"), "once", StandardOpenOption.CREATE, StandardOpenOption.APPEND); }}
}}
"#
    )
}
fn test_request(binding: &CurrentWorkspaceBinding, kind: &str, home: &Path) -> Request {
    let mut launch = request(binding, "test");
    launch.configuration.build_tool = kind.into();
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    launch.configuration.jvm_options = vec!["-Dfixture.application=must-not-reach-test".into()];
    launch.configuration.test_jvm_options = vec![
        "-Xmx96m".into(),
        format!("-Dfixture.test.literal={LITERAL}"),
        "-Dfixture.test.empty=".into(),
        "--add-opens=java.base/java.lang=ALL-UNNAMED".into(),
    ];
    launch.configuration.environment = vec![EnvironmentVariable {
        name: "IDE_TEST_JVM_MODE".into(),
        value: "literal environment 😀".into(),
    }];
    launch
}
fn completed(state: &JavaExecutionState) -> Snapshot {
    let job = state.job.lock().unwrap().clone().unwrap();
    wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "failed" | "succeeded")
    })
}
fn real_test_jvm_options(kind: &str) {
    let (root, binding, descriptor) = test_project(kind, "");
    let home = selected_test_home();
    let test_source = root.join("src/test/java/OptionsTest.java");
    fs::write(&test_source, source(true, true, kind)).unwrap();
    let state = JavaExecutionState::default();
    let mut launch = test_request(&binding, kind, &home);
    let plan = invocation(&root, &launch).unwrap();
    let private_path = plan[0].launch_file.as_ref().unwrap().path.clone();
    assert!(private_path.exists());
    drop(plan);
    assert!(!private_path.exists());
    state.start(binding.clone(), launch.clone()).unwrap();
    let failed = completed(&state);
    assert_eq!(failed.state, "failed", "{}", failed.output);
    assert!(
        failed.exit_code.is_some_and(|code| code != 0),
        "{}",
        failed.output
    );
    assert!(
        failed.test_jvm_options_error.is_none(),
        "{:?}\n{}",
        failed.test_jvm_options_error,
        failed.output
    );
    let results = failed.test_results.as_ref().unwrap();
    assert_eq!(results.summary.total, 2, "{}", failed.output);
    assert_eq!(results.summary.failed, 1);
    assert_eq!(results.summary.passed, 1);
    assert!(results.can_rerun_failed);
    let expected = format!(
        "{LITERAL}\nEMPTY=\nJDK={}\nJAVA_HOME={}",
        home.display(),
        home.display()
    );
    assert_eq!(
        fs::read_to_string(root.join("test-jvm-proof.txt")).unwrap(),
        expected
    );
    assert_eq!(
        fs::read_to_string(root.join("companion-proof.txt")).unwrap(),
        "once"
    );
    fs::write(&test_source, source(true, false, kind)).unwrap();
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
    let repaired = completed(&state);
    assert_eq!(
        repaired.state, "succeeded",
        "{}\n{:?}",
        repaired.output, repaired.test_jvm_options_error
    );
    assert_eq!(repaired.test_results.as_ref().unwrap().summary.total, 1);
    assert_eq!(
        fs::read_to_string(root.join("test-jvm-proof.txt")).unwrap(),
        expected
    );
    assert_eq!(
        fs::read_to_string(root.join("companion-proof.txt")).unwrap(),
        "once",
        "rerun must omit the previous passing method"
    );
    fs::remove_file(root.join("test-jvm-proof.txt")).unwrap();
    state
        .restart(
            binding.clone(),
            RestartRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: repaired.session_id.clone(),
                trusted: true,
                source_breakpoints: vec![],
            },
        )
        .unwrap();
    let repeated = completed(&state);
    assert_ne!(repeated.session_id, repaired.session_id);
    assert_eq!(repeated.state, "succeeded", "{}", repeated.output);
    assert_eq!(repeated.test_results.as_ref().unwrap().summary.total, 1);
    assert_eq!(fs::read_to_string(root.join("test-jvm-proof.txt")).unwrap(), expected);
    assert_eq!(fs::read_to_string(root.join("companion-proof.txt")).unwrap(), "once");
    fs::write(&test_source, source(false, false, kind)).unwrap();
    launch.configuration.test_jvm_options.clear();
    state.start(binding, launch).unwrap();
    let default = completed(&state);
    assert_eq!(default.state, "succeeded", "{}", default.output);
    assert!(default.test_jvm_options_error.is_none());
    assert_eq!(
        fs::read_to_string(root.join(if kind == "maven" {
            "pom.xml"
        } else {
            "build.gradle"
        }))
        .unwrap(),
        descriptor
    );
    assert!(!root.join("test-vm-injected.txt").exists());
    fs::remove_dir_all(root).unwrap();
}
#[test]
#[ignore = "requires Maven, a compatible JDK and real JUnit dependencies"]
fn real_maven_test_jvm_options_and_frozen_rerun() {
    real_test_jvm_options("maven");
}
#[test]
#[ignore = "requires Gradle, a compatible JDK and real JUnit dependencies"]
fn real_gradle_test_jvm_options_and_frozen_rerun() {
    real_test_jvm_options("gradle");
}
#[test]
#[ignore = "requires Maven, a compatible JDK and real JUnit dependencies"]
fn real_maven_test_jvm_options_refuse_ignored_configuration() {
    for configuration in [
        "<configuration><argLine>-Dfixture.project=retained</argLine></configuration>",
        "<configuration><forkCount>0</forkCount></configuration>",
    ] {
        let (root, binding, descriptor) = test_project("maven", configuration);
        fs::write(root.join("src/test/java/OptionsTest.java"), "import org.junit.*; public class OptionsTest { @Test public void passes() { Assert.assertNull(System.getProperty(\"fixture.test.literal\")); } }").unwrap();
        let state = JavaExecutionState::default();
        state
            .start(
                binding.clone(),
                test_request(&binding, "maven", &selected_test_home()),
            )
            .unwrap();
        let failed = completed(&state);
        assert_eq!(failed.exit_code, Some(0), "{}", failed.output);
        assert_eq!(failed.state, "failed");
        assert!(failed
            .test_jvm_options_error
            .as_deref()
            .is_some_and(|error| error.contains("not confirmed")));
        assert_eq!(failed.test_results.as_ref().unwrap().summary.passed, 1);
        assert!(!failed.test_results.as_ref().unwrap().can_rerun_failed);
        assert_eq!(
            fs::read_to_string(root.join("pom.xml")).unwrap(),
            descriptor
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires Maven 3.9 and a full JDK"]
fn real_maven_test_jvm_options_report_missing_offline_plugin() {
    let (root, binding, descriptor) = test_project("maven", "");
    let descriptor = descriptor.replace(
        "</plugins>",
        r#"<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-toolchains-plugin</artifactId><version>3.3.0-fixture-missing</version><executions><execution><goals><goal>toolchain</goal></goals></execution></executions></plugin></plugins>"#,
    );
    fs::write(root.join("pom.xml"), &descriptor).unwrap();
    fs::create_dir_all(root.join(".mvn")).unwrap();
    fs::write(root.join(".mvn/maven.config"), "--offline\n").unwrap();
    let home = selected_test_home();
    let state = JavaExecutionState::default();
    let launch = test_request(&binding, "maven", &home);
    state.start(binding, launch).unwrap();
    let failed = completed(&state);
    assert_eq!(failed.state, "failed", "{}", failed.output);
    assert_ne!(failed.exit_code, Some(0));
    assert!(maven_test_forks::offline_plugin_resolution_reported(&failed.output), "{}", failed.output);
    assert!(
        failed.test_jvm_options_error.as_deref().is_some_and(|message|
            message.starts_with("Maven could not resolve a build plugin in offline mode.")),
        "{:?}\n{}", failed.test_jvm_options_error, failed.output
    );
    assert_eq!(failed.test_results.unwrap().summary.total, 0);
    assert_eq!(fs::read_to_string(root.join("pom.xml")).unwrap(), descriptor);
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires Maven, a build JDK, IDE_TEST_JAVA8_HOME and cached Maven test plugins"]
fn real_maven_test_jvm_options_explain_argument_file_rejected_by_fork() {
    let legacy = selected_jdk(&std::env::var("IDE_TEST_JAVA8_HOME").unwrap()).unwrap();
    assert!(java8_launcher(&legacy));
    let home = selected_test_home();
    assert!(!java8_launcher(&home));
    let java = legacy.join("bin").join(executable_name("java"));
    let java = java.to_str().unwrap().replace('&', "&amp;").replace('<', "&lt;");
    let fork = format!("<configuration><jvm>{java}</jvm></configuration>");

    for operation in ["test", "integration-test"] {
        let (root, binding, descriptor) = test_project("maven", if operation == "test" { &fork } else { "" });
        let mut descriptor = descriptor.replace("<maven.compiler.release>17", "<maven.compiler.release>8");
        if operation == "integration-test" {
            descriptor = with_failsafe(&descriptor, &fork);
        }
        fs::write(root.join("pom.xml"), &descriptor).unwrap();
        fs::write(root.join("src/test/java/LegacyTest.java"), "import org.junit.Test; public class LegacyTest { @Test public void runs() {} }").unwrap();
        fs::write(root.join("src/test/java/LegacyIT.java"), "import org.junit.Test; public class LegacyIT { @Test public void runs() {} }").unwrap();

        let state = JavaExecutionState::default();
        let mut launch = test_request(&binding, "maven", &home);
        launch.operation = operation.into();
        launch.configuration.test_jvm_options.clear();
        state.start(binding.clone(), launch.clone()).unwrap();
        let control = completed(&state);
        assert_eq!(control.state, "succeeded", "{}", control.output);
        assert_eq!(control.test_results.unwrap().summary.passed, 1);

        launch.configuration.test_jvm_options.push("-Dfixture.test.jvm=requested".into());
        state.start(binding.clone(), launch).unwrap();
        let failed = completed(&state);
        assert_eq!(failed.state, "failed", "{}", failed.output);
        assert_ne!(failed.exit_code, Some(0));
        assert!(failed.test_jvm_options_error.as_deref().is_some_and(|message| {
            message.starts_with("A Maven test JVM treated the IDE argument file as a class name")
        }), "{:?}\n{}", failed.test_jvm_options_error, failed.output);
        let results = failed.test_results.unwrap();
        assert_eq!(results.summary.total, 0);
        assert!(!results.can_rerun_failed);
        assert_eq!(fs::read_to_string(root.join("pom.xml")).unwrap(), descriptor);
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires Maven, JDK 17 or later and cached Surefire and Failsafe plugins"]
fn real_maven_test_jvm_options_verify_checks_surefire_during_integration_tests() {
    let (root, binding, descriptor) = test_project(
        "maven",
        "<configuration><argLine>-Dfixture.fixed=retained</argLine></configuration>",
    );
    let descriptor = with_failsafe(&descriptor, "");
    let pom = root.join("pom.xml");
    fs::write(&pom, &descriptor).unwrap();
    fs::create_dir_all(root.join("src/main/java")).unwrap();
    fs::write(root.join("src/main/java/Example.java"), "public class Example { static int value() { return 42; } }").unwrap();
    let unit = root.join("src/test/java/OptionsTest.java");
    fs::write(&unit, r#"import org.junit.*;
public class OptionsTest { @Test public void passes() { Assert.assertEquals("retained", System.getProperty("fixture.fixed")); } }"#).unwrap();
    fs::write(root.join("src/test/java/OptionsIT.java"), r#"import org.junit.*;
public class OptionsIT { @Test public void passes() {
    Assert.assertEquals("requested", System.getProperty("fixture.test.jvm"));
    Assert.assertEquals(42, Example.value());
} }"#).unwrap();

    let state = JavaExecutionState::default();
    let mut launch = test_request(&binding, "maven", &selected_test_home());
    launch.configuration.test_jvm_options = vec!["-Dfixture.test.jvm=requested".into()];
    for operation in ["integration-test", "integration-coverage"] {
        launch.operation = operation.into();
        state.start(binding.clone(), launch.clone()).unwrap();
        let unconfirmed = completed(&state);
        assert_eq!(unconfirmed.exit_code, Some(0), "{}", unconfirmed.output);
        assert_eq!(unconfirmed.state, "failed", "{}", unconfirmed.output);
        assert!(unconfirmed.test_jvm_options_error.as_deref().is_some_and(|error| error.contains("Surefire")));
        assert_eq!(unconfirmed.test_results.unwrap().summary.passed, 1);
        if operation == "integration-coverage" {
            assert_eq!(unconfirmed.coverage.unwrap().status, "ready");
        }
        assert_eq!(fs::read_to_string(&pom).unwrap(), descriptor);
    }
    launch.operation = "integration-test".into();

    // The previous unit report is stale when a new integration run skips unit tests.
    let descriptor = descriptor.replace(
        "<argLine>-Dfixture.fixed=retained</argLine>",
        "<skipTests>true</skipTests>",
    );
    fs::write(&pom, &descriptor).unwrap();
    state.start(binding, launch).unwrap();
    let confirmed = completed(&state);
    assert_eq!(confirmed.state, "succeeded", "{}", confirmed.output);
    assert!(confirmed.test_jvm_options_error.is_none());
    assert_eq!(confirmed.test_results.unwrap().summary.passed, 1);
    assert_eq!(fs::read_to_string(&pom).unwrap(), descriptor);
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
