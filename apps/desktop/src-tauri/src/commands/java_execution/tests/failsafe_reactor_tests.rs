use super::*;
use sha2::{Digest, Sha256};

fn failsafe_reactor_modules(root: &Path) -> (PathBuf, PathBuf) {
    let reactor = root.join("service");
    let core = reactor.join("core");
    let app = reactor.join("app");
    for module in [&core, &app] {
        fs::create_dir_all(module.join("src/test/java/example")).unwrap();
    }

    fs::write(
        reactor.join("pom.xml"),
        r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>failsafe-reactor</artifactId><version>1</version><packaging>pom</packaging><modules><module>core</module><module>app</module></modules><properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.4</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><executions><execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions></plugin></plugins></build></project>"#,
    )
    .unwrap();
    for (module, name) in [(&core, "core"), (&app, "app")] {
        fs::write(
            module.join("pom.xml"),
            format!(r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>fixture</groupId><artifactId>failsafe-reactor</artifactId><version>1</version><relativePath>../pom.xml</relativePath></parent><artifactId>{name}</artifactId></project>"#),
        )
        .unwrap();
    }
    (core, app)
}

#[test]
#[ignore = "requires Maven 3, a compatible JDK, and cached Maven/JUnit dependencies"]
fn real_maven_collects_failsafe_reports_and_reruns_failures_across_reactor_modules() {
    let (root, binding) = fixture();
    let (core, app) = failsafe_reactor_modules(&root);
    let reactor = root.join("service");
    fs::write(
        core.join("src/test/java/example/CoreTest.java"),
        "package example; import org.junit.Test; import static org.junit.Assert.*; public class CoreTest { @Test public void passes() { assertEquals(2, 1 + 1); } }",
    )
    .unwrap();
    fs::write(
        core.join("src/test/java/example/CoreIT.java"),
        "package example; import org.junit.Test; import static org.junit.Assert.*; public class CoreIT { @Test public void passes() { assertEquals(2, 1 + 1); } }",
    )
    .unwrap();
    let app_test = app.join("src/test/java/example/AppIT.java");
    let failing_source = "package example; import org.junit.Test; import static org.junit.Assert.*; public class AppIT { @Test public void selected() { assertEquals(\"initial\", \"repaired\"); } @Test public void notSelected() { assertEquals(2, 1 + 1); } }";
    fs::write(&app_test, failing_source).unwrap();

    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "integration-test");
    launch.configuration.build_tool = "maven".into();
    launch.configuration.project_path = "service".into();
    state.start(binding.clone(), launch).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let failed = wait_for(&job, |snapshot| snapshot.state == "failed");
    assert_ne!(failed.exit_code, Some(0), "{}", failed.output);
    let results = failed.test_results.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{results:?}\n{}", failed.output);
    assert_eq!(results.summary.total, 3, "{results:?}");
    assert_eq!(results.summary.passed, 2, "{results:?}");
    assert_eq!(results.summary.failed, 1, "{results:?}");
    let report_paths: Vec<_> = results
        .suites
        .iter()
        .map(|suite| suite.report_path.as_str())
        .collect();
    assert_eq!(report_paths.len(), 2, "{results:?}");
    assert!(report_paths.contains(&"service/core/target/failsafe-reports/TEST-example.CoreIT.xml"));
    assert!(report_paths.contains(&"service/app/target/failsafe-reports/TEST-example.AppIT.xml"));
    assert!(results
        .suites
        .iter()
        .any(|suite| suite.cases.iter().any(|case| case.name == "selected")));
    assert!(
        core.join("target/surefire-reports/TEST-example.CoreTest.xml")
            .is_file(),
        "Surefire ran in another reactor module but must not enter Failsafe results"
    );
    assert!(results.can_rerun_failed, "{results:?}");

    fs::write(
        &app_test,
        failing_source.replace(
            "assertEquals(\"initial\", \"repaired\");",
            "assertEquals(\"repaired\", \"repaired\");",
        ),
    )
    .unwrap();
    let rerun = state
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
    assert_eq!(rerun.operation, "integration-test");
    let job = state.job.lock().unwrap().clone().unwrap();
    let repaired = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(repaired.state, "succeeded", "{}", repaired.output);
    let results = repaired.test_results.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{results:?}");
    assert_eq!(results.summary.total, 1, "{results:?}");
    assert_eq!(results.summary.passed, 1, "{results:?}");
    assert_eq!(results.suites.len(), 1, "{results:?}");
    assert_eq!(
        results.suites[0].report_path,
        "service/app/target/failsafe-reports/TEST-example.AppIT.xml"
    );
    assert_eq!(results.suites[0].cases[0].name, "selected");
    let repeat_request = || RestartRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: repaired.session_id.clone(),
        trusted: true,
        source_breakpoints: vec![],
    };
    let relocated = root.join("relocated-service");
    fs::rename(&reactor, &relocated).unwrap();
    let failed_repeat = state.restart(binding.clone(), repeat_request());
    fs::rename(&relocated, &reactor).unwrap();
    assert!(failed_repeat.is_err());
    let retained = state
        .snapshot_at(
            &binding,
            &SessionRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: repaired.session_id.clone(),
            },
        )
        .unwrap();
    assert_eq!(retained.state, "succeeded");
    assert_eq!(retained.test_results.unwrap().summary.passed, 1);
    let rerun = state.restart(binding.clone(), repeat_request()).unwrap();
    assert_ne!(rerun.session_id, repaired.session_id);
    assert_eq!(rerun.operation, "integration-test");
    let job = state.job.lock().unwrap().clone().unwrap();
    let repeated = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(repeated.state, "succeeded", "{}", repeated.output);
    let repeated_results = repeated.test_results.unwrap();
    assert_eq!(repeated_results.status, "ready", "{repeated_results:?}");
    assert_eq!(repeated_results.summary.total, 1, "{repeated_results:?}");
    assert_eq!(repeated_results.suites[0].cases[0].name, "selected");
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires Maven 3.9, JDK 21/JDI, local sockets and cached Maven/JUnit dependencies"]
fn real_maven_failed_debug_distinguishes_identical_methods_in_reactor_modules() {
    let (root, binding) = fixture();
    let (core, app) = failsafe_reactor_modules(&root);
    let maven_settings = root.join("service/.mvn/maven.config");
    fs::create_dir_all(maven_settings.parent().unwrap()).unwrap();
    fs::write(&maven_settings, "--fail-at-end\n").unwrap();
    let failing = r#"package example;
import org.junit.Test;
import static org.junit.Assert.*;
public class AppIT {
    @Test public void selected() {
        assertEquals(1, 0);
    }
}
"#;
    let core_test = core.join("src/test/java/example/AppIT.java");
    let app_test = app.join("src/test/java/example/AppIT.java");
    for source in [&core_test, &app_test] {
        fs::write(source, failing).unwrap();
    }

    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "integration-test");
    launch.configuration.build_tool = "maven".into();
    launch.configuration.project_path = "service".into();
    let completed = || {
        let job = state.job.lock().unwrap().clone().unwrap();
        wait_for(&job, |snapshot| !["starting", "running"].contains(&snapshot.state.as_str()))
    };
    let debug_request = |session_id: String| RerunRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id,
        trusted: true,
        debug: true,
        source_breakpoints: vec![],
    };

    state.start(binding.clone(), launch.clone()).unwrap();
    let two_failures = completed();
    let results = two_failures.test_results.as_ref().unwrap();
    assert_eq!(results.summary.failed, 2, "{}", two_failures.output);
    assert_eq!(results.failed_selections().unwrap(), ["example.AppIT#selected"]);
    assert!(results.can_rerun_failed);
    assert!(!two_failures.can_debug_failed_tests);
    let refused = state.rerun_failed(binding.clone(), debug_request(two_failures.session_id.clone()));
    assert!(refused.err().expect("multiple modules must be refused").contains("one Maven module at a time"));
    assert_eq!(completed().session_id, two_failures.session_id);

    // Fail-fast observes only the first member of the reactor, even though the
    // second member also has a test of the same name.
    fs::remove_file(maven_settings).unwrap();
    state.start(binding.clone(), launch).unwrap();
    let one_failure = completed();
    assert_eq!(one_failure.test_results.as_ref().unwrap().summary.failed, 1);
    assert!(one_failure.can_debug_failed_tests, "{}", one_failure.output);
    let app_report = app.join("target/failsafe-reports/TEST-example.AppIT.xml");
    let original_app_report = fs::read(&app_report).unwrap();
    let repaired = failing.replace("assertEquals(1, 0)", "assertEquals(1, 1)");
    for source in [&core_test, &app_test] {
        fs::write(source, &repaired).unwrap();
    }

    let fingerprint = format!("{:x}", Sha256::digest(repaired.as_bytes()));
    let core_source = "service/core/src/test/java/example/AppIT.java";
    let mut debug = debug_request(one_failure.session_id);
    debug.source_breakpoints = [core_source, "service/app/src/test/java/example/AppIT.java"]
        .into_iter()
        .map(|source_path| debugger_sources::SavedBreakpoint {
            source_path: source_path.into(),
            line: 6,
            fingerprint: fingerprint.clone(),
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        })
        .collect();
    state.rerun_failed(binding.clone(), debug).unwrap();
    let debugger = state.job.lock().unwrap().clone().unwrap();
    let stopped = wait_for(&debugger, |snapshot| {
        snapshot.debugger_state.as_ref()
            .is_some_and(|value| value.reason.as_deref() == Some("entry"))
            || snapshot.state == "failed"
    });
    assert_ne!(stopped.state, "failed", "{}", stopped.output);
    structured_debugger::send(
        &debugger,
        &structured_debugger::Action::Continue {
            stop_id: stopped.debugger_state.unwrap().stop_id.unwrap(),
        },
    ).unwrap();
    let breakpoint = wait_for(&debugger, |snapshot| {
        snapshot.debugger_state.as_ref()
            .is_some_and(|value| value.reason.as_deref() == Some("breakpoint"))
            || !["starting", "running"].contains(&snapshot.state.as_str())
    });
    let paused = breakpoint.debugger_state.as_ref().expect("JDI stop");
    assert_eq!(paused.reason.as_deref(), Some("breakpoint"), "{}", breakpoint.output);
    assert_eq!(paused.frames[0].class_name, "example.AppIT");
    let mut source = debugger_sources::SourceRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: breakpoint.session_id.clone(),
        request_id: "reactor-breakpoint".into(),
        document: debugger_sources::Document {
            path: core_source.into(),
            text: repaired,
            version: 1,
        },
        stop_id: paused.stop_id.clone(),
        frame_id: paused.selected_frame_id.clone(),
    };
    let resolved = serde_json::to_value(debugger_sources::inspect(&debugger, &source).unwrap()).unwrap();
    assert_eq!(resolved["sourcePath"], core_source);
    assert_eq!(resolved["executionLine"], 6);
    source.document.path = "service/app/src/test/java/example/AppIT.java".into();
    assert!(debugger_sources::inspect(&debugger, &source).is_err());
    structured_debugger::send(
        &debugger,
        &structured_debugger::Action::Continue {
            stop_id: paused.stop_id.clone().unwrap(),
        },
    ).unwrap();
    let passed = completed();
    assert_eq!(passed.state, "succeeded", "{}", passed.output);
    let results = passed.test_results.unwrap();
    assert_eq!(results.summary.passed, 1);
    assert_eq!(results.suites.len(), 1);
    assert_eq!(results.suites[0].report_path, "service/core/target/failsafe-reports/TEST-example.AppIT.xml");
    assert_eq!(fs::read(app_report).unwrap(), original_app_report);
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
