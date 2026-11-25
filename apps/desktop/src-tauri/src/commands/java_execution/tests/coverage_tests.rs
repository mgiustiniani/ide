use super::*;

#[test]
#[ignore = "requires Maven, a full JDK and JaCoCo/JUnit dependencies"]
fn real_maven_coverage_counts_failed_reruns_and_literal_test_vm_options() {
    real_coverage("maven");
}

#[test]
#[ignore = "requires Gradle, a full JDK and JaCoCo/JUnit dependencies"]
fn real_gradle_coverage_counts_failed_reruns_and_literal_test_vm_options() {
    real_coverage("gradle");
}

fn real_coverage(tool: &str) {
    let (root, binding) = fixture();
    fs::create_dir_all(root.join("src/main/java")).unwrap();
    fs::create_dir_all(root.join("src/test/java")).unwrap();
    fs::write(root.join("src/main/java/Choice.java"), "public class Choice {\n public static int choose(int n) {\n  if (n > 0) return 7;\n  return 3;\n }\n}\n").unwrap();
    let test = root.join("src/test/java/ChoiceTest.java");
    fs::write(&test, "import org.junit.Test; import static org.junit.Assert.*; public class ChoiceTest { @Test public void positive() { assertEquals(7, Choice.choose(1)); } }").unwrap();
    let descriptor = root.join(if tool == "maven" {
        "pom.xml"
    } else {
        "build.gradle"
    });
    let build = if tool == "maven" {
        r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>coverage</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>"#
    } else {
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name = 'coverage'\n",
        )
        .unwrap();
        "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\ntest { jvmArgs '-Dproject.default=kept' }\n"
    };
    fs::write(&descriptor, build).unwrap();
    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "coverage");
    launch.configuration.build_tool = tool.into();
    if let Ok(jdk) = std::env::var("IDE_COVERAGE_TEST_JDK") {
        launch.configuration.jdk_home = jdk;
    }
    let run = |launch: Request| {
        let started = state.start(binding.clone(), launch).unwrap();
        assert_eq!(started.coverage.as_ref().unwrap().status, "collecting");
        let job = state.job.lock().unwrap().clone().unwrap();
        wait_for(&job, |s| {
            !["starting", "running"].contains(&s.state.as_str())
        })
    };
    let first = run(launch.clone());
    assert_eq!(
        first.state,
        "succeeded",
        "{}\n{}",
        first.output,
        serde_json::to_string(&first).unwrap()
    );
    let measured = serde_json::to_value(first.coverage.as_ref().unwrap()).unwrap();
    assert_eq!(measured["status"], "ready");
    assert_eq!(measured["counters"]["branches"]["covered"], 1);
    assert_eq!(measured["counters"]["branches"]["missed"], 1);
    assert_eq!(measured["files"][0]["name"], "Choice.java");
    assert!(!measured["files"][0]["lines"].as_array().unwrap().is_empty());
    assert_eq!(first.test_results.as_ref().unwrap().summary.passed, 1);
    let kept = if tool == "gradle" {
        "assertEquals(\"kept\", System.getProperty(\"project.default\"));"
    } else {
        ""
    };
    let failed_source = format!("import org.junit.Test; import static org.junit.Assert.*; public class ChoiceTest {{ @Test public void positive() {{ assertEquals(\"space $literal; & unicode ☕\", System.getProperty(\"coverage.literal\")); {kept} assertEquals(7, Choice.choose(1)); }} @Test public void negative() {{ assertEquals(99, Choice.choose(-1)); }} }}");
    fs::write(&test, &failed_source).unwrap();
    launch.configuration.test_jvm_options =
        vec!["-Dcoverage.literal=space $literal; & unicode ☕".into()];
    let failed = run(launch.clone());
    assert_eq!(failed.state, "failed", "{}", failed.output);
    assert!(failed.test_jvm_options_error.is_none(), "{}", failed.output);
    assert_eq!(
        failed.test_results.as_ref().unwrap().summary.failed,
        1,
        "{}",
        failed.output
    );
    let measured = serde_json::to_value(failed.coverage.as_ref().unwrap()).unwrap();
    assert_eq!(measured["status"], "ready", "{measured}\n{}", failed.output);
    assert_eq!(measured["counters"]["branches"]["covered"], 2);
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
    let rerun = wait_for(&job, |s| {
        !["starting", "running"].contains(&s.state.as_str())
    });
    assert_eq!(rerun.operation, "coverage");
    assert_eq!(
        rerun.test_results.as_ref().unwrap().summary.total,
        1,
        "{}",
        rerun.output
    );
    let measured = serde_json::to_value(rerun.coverage.as_ref().unwrap()).unwrap();
    assert_eq!(measured["status"], "ready", "{measured}\n{}", rerun.output);
    assert_eq!(measured["counters"]["branches"]["covered"], 1);
    assert_eq!(measured["counters"]["branches"]["missed"], 1);
    fs::write(&test, failed_source.replace("assertEquals(99,", "assertEquals(3,")).unwrap();
    let repeat = state
        .restart(binding.clone(), RestartRequest {
            workspace_id: binding.workspace_id.clone(),
            generation: 1,
            session_id: rerun.session_id.clone(),
            trusted: true,
            source_breakpoints: vec![],
        })
        .unwrap();
    assert_ne!(repeat.session_id, rerun.session_id);
    let job = state.job.lock().unwrap().clone().unwrap();
    let repeat = wait_for(&job, |s| !["starting", "running"].contains(&s.state.as_str()));
    assert_eq!(repeat.state, "succeeded", "{}", repeat.output);
    let results = repeat.test_results.as_ref().unwrap();
    assert_eq!(results.summary.total, 1);
    assert_eq!(results.summary.passed, 1);
    assert_eq!(results.suites[0].cases[0].name, "negative");
    let measured = serde_json::to_value(repeat.coverage.as_ref().unwrap()).unwrap();
    assert_eq!(measured["status"], "ready");
    assert_eq!(measured["counters"]["branches"]["covered"], 1);
    assert_eq!(measured["counters"]["branches"]["missed"], 1);
    assert_eq!(fs::read_to_string(&descriptor).unwrap(), build);
    if tool == "maven" {
        fs::write(&test, &failed_source).unwrap();
        fs::write(&descriptor, build.replace("<version>3.5.3</version>", "<version>3.5.3</version><configuration><argLine>-Dfixed=kept</argLine></configuration>")).unwrap();
        launch.configuration.test_jvm_options.clear();
        launch.configuration.test_filter = "ChoiceTest#negative".into();
        let unavailable = run(launch);
        assert_eq!(unavailable.state, "failed");
        assert_eq!(
            unavailable.coverage.unwrap().status,
            "unavailable",
            "{}",
            unavailable.output
        );
    }
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
