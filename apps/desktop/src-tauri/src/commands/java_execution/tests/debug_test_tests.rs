use super::super::{debug_test, structured_debugger};
use super::*;
use base64::Engine;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::sync::mpsc::{self, Receiver};
use std::time::Instant;

#[test]
fn debug_test_listener_refuses_invalid_or_unbounded_endpoints() {
    assert_eq!(
        debug_test::listener_port(b"{\"kind\":\"testListener\",\"port\":12345}\n").unwrap(),
        12345
    );
    for frame in [
        b"{\"kind\":\"testListener\",\"port\":0}\n".as_slice(),
        b"{\"kind\":\"testListener\",\"port\":65536}\n",
        b"{\"kind\":\"testListener\",\"port\":123,\"host\":\"remote\"}\n",
        b"{\"kind\":\"output\",\"port\":123}\n",
        b"{\"kind\":\"testListener\",\"port\":123}",
        &[b'x'; 1025],
    ] {
        assert!(debug_test::listener_port(frame).is_err());
    }
}

struct Helper {
    child: Child,
    input: Option<std::process::ChildStdin>,
    frames: Receiver<Vec<u8>>,
    _invocation: Invocation,
}
impl Helper {
    fn start(invocation: Invocation) -> Self {
        let mut child = Command::new(&invocation.executable);
        child
            .args(&invocation.arguments)
            .current_dir(&invocation.directory)
            .env("JAVA_HOME", &invocation.java_home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            child.process_group(0);
        }
        let mut child = child.spawn().unwrap();
        let input = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (sender, frames) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let count = reader
                    .by_ref()
                    .take(512 * 1024 + 1)
                    .read_until(b'\n', &mut line)
                    .unwrap();
                if count == 0 {
                    break;
                }
                assert!(count <= 512 * 1024 && line.last() == Some(&b'\n'));
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input,
            frames,
            _invocation: invocation,
        }
    }
    fn port(&self) -> u16 {
        debug_test::listener_port(
            &self
                .frames
                .recv_timeout(Duration::from_secs(30))
                .expect("JDI listener startup"),
        )
        .unwrap()
    }
    fn state(
        &self,
        predicate: impl Fn(&structured_debugger::DebugState) -> bool,
    ) -> structured_debugger::DebugState {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let bytes = self
                .frames
                .recv_timeout(remaining)
                .expect("JDI test runtime state");
            let event: Value = serde_json::from_slice(&bytes).unwrap();
            if event["kind"] != "state" {
                continue;
            }
            let state: structured_debugger::DebugState =
                serde_json::from_value(event["state"].clone()).unwrap();
            assert!(state.error.is_none(), "{:?}", state.error);
            if predicate(&state) {
                return state;
            }
        }
    }
    fn command(&mut self, fields: &[&str]) {
        let line = base64::engine::general_purpose::STANDARD.encode(fields.join("\0"));
        writeln!(self.input.as_mut().unwrap(), "{line}").unwrap();
    }
}
impl Drop for Helper {
    fn drop(&mut self) {
        self.input.take();
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        kill_owned_process(&mut self.child);
    }
}
struct Tool {
    child: Child,
    log: PathBuf,
    _invocation: Invocation,
}
impl Tool {
    fn start(invocation: Invocation) -> Self {
        let log = invocation.directory.join("owned-test-build.log");
        let stream = fs::File::create(&log).unwrap();
        let mut command = Command::new(&invocation.executable);
        command
            .args(&invocation.arguments)
            .current_dir(&invocation.directory)
            .env("JAVA_HOME", &invocation.java_home)
            .stdin(Stdio::null())
            .stdout(stream.try_clone().unwrap())
            .stderr(stream);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        Self {
            child: command.spawn().unwrap(),
            log,
            _invocation: invocation,
        }
    }
    fn wait(&mut self) -> std::process::ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "Test tool timed out: {}",
                fs::read_to_string(&self.log).unwrap()
            );
            thread::sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for Tool {
    fn drop(&mut self) {
        kill_owned_process(&mut self.child);
    }
}
const SOURCE: &str = r#"package fixture;
import org.junit.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public class DebugTest {
  @Test public void selected() throws Exception {
    int local = 41;
    String pid = java.lang.management.ManagementFactory.getRuntimeMXBean().getName().split("@", 2)[0];
    Files.write(Paths.get("owned-test.pid"), pid.getBytes(StandardCharsets.US_ASCII));
    Files.write(Paths.get("selected-test.txt"), Integer.toString(local + 1).getBytes(StandardCharsets.US_ASCII));
    Assert.assertEquals("retained", System.getProperty("fixture.project"));
  }
  @Test public void unselected() { Assert.fail("The debug filter was lost"); }
}
"#;

fn debug_test_fixture(tool: &str) -> (PathBuf, CurrentWorkspaceBinding, PathBuf, String) {
    let (root, binding) = fixture();
    let home = selected_jdk("").unwrap();
    fs::create_dir_all(root.join("src/test/java/fixture")).unwrap();
    let source = root.join("src/test/java/fixture/DebugTest.java");
    fs::write(&source, SOURCE).unwrap();
    let descriptor = if tool == "maven" {
        r#"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>owned-test-debug</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release><argLine>-Xmx128m -Dfixture.project=retained</argLine></properties><dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin><plugin><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>"#
    } else if tool == "jdk" {
        "Plain JDK debug-test fixture."
    } else {
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name='owned-test-debug'\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.workers.max=2\norg.gradle.daemon=false\n",
        )
        .unwrap();
        "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { testImplementation 'junit:junit:4.13.2' }\ntest { useJUnit(); systemProperty 'fixture.project', 'retained' }\n"
    };
    let descriptor_path = root.join(if tool == "maven" {
        "pom.xml"
    } else if tool == "jdk" {
        "project-note.txt"
    } else {
        "build.gradle"
    });
    let descriptor = if tool == "maven" && java8_launcher(&home) {
        descriptor.replace("<maven.compiler.release>17", "<maven.compiler.release>8")
    } else {
        descriptor.to_owned()
    };
    fs::write(&descriptor_path, &descriptor).unwrap();
    (root, binding, home, descriptor)
}

fn real_build_tool_test_debugger(tool: &str, terminate: &str) {
    let (root, binding, home, descriptor) = debug_test_fixture(tool);
    let source = root.join("src/test/java/fixture/DebugTest.java");
    let descriptor_path = root.join(if tool == "maven" {
        "pom.xml"
    } else if tool == "jdk" {
        "project-note.txt"
    } else {
        "build.gradle"
    });
    let mut launch = request(&binding, "test");
    launch.configuration.build_tool = tool.into();
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    launch.configuration.debugger_mode = "jdi".into();
    launch.configuration.test_filter = "fixture.DebugTest#selected".into();
    let mut helper =
        Helper::start(debug_test::listener_invocation(&root, &launch.configuration).unwrap());
    let port = helper.port();
    // The helper keeps the bound port while the build tool compiles its tests.
    assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_err());
    let mut plan = invocation(&root, &launch).unwrap();
    assert_eq!(plan.len(), 1);
    let mut step = plan.pop().unwrap();
    if tool == "gradle" {
        step.arguments.push("--offline".into());
    }
    debug_test::configure_test_invocation(&mut step, tool, false, port, None).unwrap();
    let tracker = Tracker::prepare(&root, &root, tool, &[]);
    let mut task = Tool::start(step);
    let entry = helper.state(|state| state.reason.as_deref() == Some("entry"));
    assert!(!root.join("selected-test.txt").exists());
    let point = SOURCE
        .lines()
        .position(|line| line.contains("selected-test.txt"))
        .unwrap()
        + 1;
    helper.command(&[
        "setBreakpoint",
        "",
        "fixture.DebugTest",
        &point.to_string(),
        "",
        "0",
        "",
    ]);
    helper.state(|state| !state.breakpoints.is_empty());
    helper.command(&["continue", entry.stop_id.as_ref().unwrap(), "", "0"]);
    let stopped = helper.state(|state| state.reason.as_deref() == Some("breakpoint"));
    assert!(stopped
        .frames
        .iter()
        .any(|frame| frame.class_name == "fixture.DebugTest" && frame.line == Some(point as u32)));
    assert!(stopped
        .variables
        .iter()
        .any(|value| value.name == "local" && value.value == "41"));
    assert!(!root.join("selected-test.txt").exists());
    let pid: i32 = fs::read_to_string(root.join("owned-test.pid"))
        .unwrap()
        .parse()
        .unwrap();
    match terminate {
        "continue" => helper.command(&["continue", stopped.stop_id.as_ref().unwrap(), "", "0"]),
        "eof" => {
            helper.input.take();
        }
        "invalid" => {
            writeln!(helper.input.as_mut().unwrap(), "invalid-base64").unwrap();
        }
        _ => unreachable!(),
    }
    helper.state(|state| state.status == structured_debugger::Status::Terminated);
    let status = task.wait();
    if terminate == "continue" {
        assert!(
            status.success(),
            "{}",
            fs::read_to_string(&task.log).unwrap()
        );
        assert_eq!(
            fs::read_to_string(root.join("selected-test.txt")).unwrap(),
            "42"
        );
        let reports = tracker.finish("");
        assert_eq!(reports.status, "ready");
        assert_eq!(reports.summary.total, 1);
        assert_eq!(reports.summary.passed, 1);
    } else {
        assert!(!status.success());
        assert!(!root.join("selected-test.txt").exists());
    }
    #[cfg(unix)]
    unsafe {
        assert_ne!(libc::kill(pid, 0), 0, "Owned test JVM survived");
    }
    assert_eq!(fs::read_to_string(source).unwrap(), SOURCE);
    assert_eq!(fs::read_to_string(descriptor_path).unwrap(), descriptor);
    drop(task);
    drop(helper);
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "Requires real JDK JDI, Maven, cached JUnit and local sockets; run with --test-threads=1"]
fn real_maven_debug_test_listener_breakpoint_result_and_eof_cleanup() {
    real_build_tool_test_debugger("maven", "continue");
    real_build_tool_test_debugger("maven", "eof");
}

#[test]
#[ignore = "Requires real JDK JDI, Gradle, cached JUnit and local sockets; run with --test-threads=1"]
fn real_gradle_debug_test_listener_breakpoint_result_and_malformed_input_cleanup() {
    real_build_tool_test_debugger("gradle", "continue");
    real_build_tool_test_debugger("gradle", "invalid");
}

#[test]
fn debug_test_admission_refuses_untrusted_unselected_or_wildcard_work() {
    let (root, binding) = fixture();
    let mut launch = request(&binding, "debug-test");
    launch.configuration.debugger_mode = "jdi".into();
    launch.configuration.test_filter = "fixture.Example#selected".into();
    launch.trusted = false;
    assert!(invocation(&root, &launch).unwrap_err().contains("trust"));
    launch.trusted = true;
    for filter in [
        "",
        "fixture.*",
        "fixture.Example#*",
        "fixture.Example#one,two",
    ] {
        launch.configuration.test_filter = filter.into();
        assert!(debug_test::validate(&launch, &[])
            .unwrap_err()
            .contains("Select one concrete test"));
    }
    fs::remove_dir_all(root).unwrap();
}

fn managed_debug_test(tool: &str, stop: bool, captured: bool, integration: bool) {
    use sha2::{Digest, Sha256};
    let (root, binding, home, mut descriptor) = debug_test_fixture(tool);
    if integration {
        descriptor = descriptor.replace("<artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version>", "<artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version><configuration><excludes><exclude>**/DebugTest.java</exclude></excludes></configuration>");
        descriptor = descriptor.replace("</plugins>", "<plugin><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><executions><execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions><configuration><includes><include>**/DebugTest.java</include></includes></configuration></plugin></plugins>");
        fs::write(root.join("pom.xml"), &descriptor).unwrap();
    }
    if tool == "gradle" {
        use std::os::unix::fs::PermissionsExt;
        let executable = on_path("gradle").unwrap();
        let wrapper = root.join("gradlew");
        fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexec '{}' --offline \"$@\"\n",
                executable.to_string_lossy().replace('\'', "'\\''")
            ),
        )
        .unwrap();
        fs::set_permissions(wrapper, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let mut launch = request(
        &binding,
        if integration {
            "debug-integration-test"
        } else {
            "debug-test"
        },
    );
    if tool == "jdk" {
        let jar = PathBuf::from(
            std::env::var_os("IDE_JUNIT_PLATFORM_CONSOLE_JAR")
                .expect("Set IDE_JUNIT_PLATFORM_CONSOLE_JAR"),
        );
        fs::create_dir(root.join("lib")).unwrap();
        fs::copy(jar, root.join("lib/junit-platform-console-standalone.jar")).unwrap();
        launch.configuration.class_path = vec!["lib/junit-platform-console-standalone.jar".into()];
        launch.configuration.test_jvm_options = vec!["-Dfixture.project=retained".into()];
    }
    launch.configuration.build_tool = tool.into();
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    launch.configuration.debugger_mode = "jdi".into();
    launch.configuration.test_filter = "fixture.DebugTest#selected".into();
    let point = (SOURCE
        .lines()
        .position(|line| line.contains("selected-test.txt"))
        .unwrap()
        + 1) as u32;
    launch
        .source_breakpoints
        .push(debugger_sources::SavedBreakpoint {
            source_path: "src/test/java/fixture/DebugTest.java".into(),
            line: point,
            fingerprint: format!("{:x}", Sha256::digest(SOURCE.as_bytes())),
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        });
    let executor = JavaExecutionState::default();
    if captured {
        let mut discovery = launch.clone();
        discovery.operation = "discover".into();
        discovery.configuration.debugger_mode = "jdb".into();
        discovery.source_breakpoints.clear();
        executor.start(binding.clone(), discovery).unwrap();
        let discovering = executor.job.lock().unwrap().clone().unwrap();
        let ready = wait_for(&discovering, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(ready.state, "succeeded", "{}", ready.output);
        let found = ready.test_discovery.unwrap();
        assert_eq!(found.status, "ready");
        let selected = found
            .tests
            .iter()
            .find(|test| {
                test.class_name == "fixture.DebugTest"
                    && test.method_name.as_deref() == Some("selected")
            })
            .unwrap();
        launch.test_selection = Some(TestSelection {
            discovery_session_id: ready.session_id,
            test_id: selected.id.clone(),
        });
        launch.configuration.jdk_home = "/missing-after-discovery".into();
        launch.configuration.project_path = "missing-after-discovery".into();
        launch.configuration.debugger_mode = "jdb".into();
        assert!(!root.join("owned-test.pid").exists());
    }
    executor.start(binding.clone(), launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = wait_for(&job, |value| {
        value
            .debugger_state
            .as_ref()
            .is_some_and(|state| state.reason.as_deref() == Some("entry"))
            || value.state == "failed"
    });
    assert_ne!(entry.state, "failed", "{}", entry.output);
    let entry = entry.debugger_state.unwrap();
    assert_eq!(entry.breakpoints.len(), 1);
    structured_debugger::send(
        &job,
        &structured_debugger::Action::Continue {
            stop_id: entry.stop_id.unwrap(),
        },
    )
    .unwrap();
    let stopped = wait_for(&job, |value| {
        value
            .debugger_state
            .as_ref()
            .is_some_and(|state| state.reason.as_deref() == Some("breakpoint"))
            || value.state == "failed"
    });
    assert_ne!(stopped.state, "failed", "{}", stopped.output);
    let state = stopped.debugger_state.unwrap();
    assert!(state
        .variables
        .iter()
        .any(|value| value.name == "local" && value.value == "41"));
    assert!(!state.can_reload_classes);
    assert!(!root.join("selected-test.txt").exists());
    let pid: i32 = fs::read_to_string(root.join("owned-test.pid"))
        .unwrap()
        .parse()
        .unwrap();
    let helper_pid = job.child.lock().unwrap().as_ref().unwrap().id();
    let tool_pid = job.test_tool_child.lock().unwrap().as_ref().unwrap().id();
    if stop {
        job.stop();
    } else {
        structured_debugger::send(
            &job,
            &structured_debugger::Action::Continue {
                stop_id: state.stop_id.unwrap(),
            },
        )
        .unwrap();
    }
    let completed = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    if stop {
        assert_eq!(completed.state, "stopped");
        assert!(!root.join("selected-test.txt").exists());
    } else {
        assert_eq!(completed.state, "succeeded", "{}", completed.output);
        let results = completed.test_results.unwrap();
        assert_eq!(results.status, "ready", "{}", completed.output);
        assert_eq!(results.summary.total, 1);
        assert_eq!(results.summary.passed, 1);
        assert_eq!(
            fs::read_to_string(root.join("selected-test.txt")).unwrap(),
            "42"
        );
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while job.child.lock().unwrap().is_some() || job.test_tool_child.lock().unwrap().is_some() {
        assert!(
            Instant::now() < deadline,
            "Debug test child slot did not retire"
        );
        thread::sleep(Duration::from_millis(20));
    }
    #[cfg(unix)]
    unsafe {
        for child in [pid, helper_pid as i32, tool_pid as i32] {
            assert_ne!(libc::kill(child, 0), 0, "Owned debug test process survived");
        }
    }
    assert_eq!(
        fs::read_to_string(root.join("src/test/java/fixture/DebugTest.java")).unwrap(),
        SOURCE
    );
    assert_eq!(
        fs::read_to_string(root.join(if tool == "maven" {
            "pom.xml"
        } else if tool == "jdk" {
            "project-note.txt"
        } else {
            "build.gradle"
        }))
        .unwrap(),
        descriptor
    );
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "Requires real Maven/JDK/JUnit and sockets; run with --test-threads=1"]
fn real_managed_maven_debug_test_session_reports_results_and_stops_both_children() {
    managed_debug_test("maven", false, false, false);
    managed_debug_test("maven", true, false, false);
    managed_debug_test("maven", false, true, false);
}
#[test]
#[ignore = "Requires real Gradle/JDK/JUnit and sockets; run with --test-threads=1"]
fn real_managed_gradle_debug_test_session_reports_results_and_stops_both_children() {
    managed_debug_test("gradle", false, false, false);
    managed_debug_test("gradle", true, false, false);
}

#[test]
#[ignore = "Requires real Maven/JDK/JUnit/Failsafe and sockets; run with --test-threads=1"]
fn real_managed_maven_debug_integration_test_session_keeps_unit_tests_separate() {
    managed_debug_test("maven", false, false, true);
}
#[test]
#[ignore = "Requires real JDK/JDI, IDE_JUNIT_PLATFORM_CONSOLE_JAR and sockets; run with --test-threads=1"]
fn real_managed_jdk_debug_test_session_reports_results_and_stops_both_children() {
    managed_debug_test("jdk", false, false, false);
    managed_debug_test("jdk", true, false, false);
}

#[test]
fn failed_debug_selection_rejects_other_classes_and_unbounded_selectors() {
    let (_root, binding) = fixture();
    let mut launch = request(&binding, "debug-test");
    launch.configuration.debugger_mode = "jdi".into();
    for selections in [
        vec!["fixture.First#one".into(), "fixture.Second#two".into()],
        vec!["fixture.First#one".into(); 257],
        vec!["fixture.First#*".into()],
    ] {
        assert!(debug_test::validate(&launch, &selections).is_err());
    }
    fs::remove_dir_all(_root).unwrap();
}

fn real_debug_failed_rerun(tool: &str, initial_operation: &str) {
    use sha2::{Digest, Sha256};
    const TEST: &str = r#"package fixture;
import org.junit.*;
import java.nio.file.*;
public class DebugTest {
  static boolean broken = true;
  @Test public void first() {
    int local = 41;
    Assert.assertFalse("first failure", broken);
    Assert.assertEquals("retained", System.getProperty("fixture.project"));
  }
  @Test public void second() {
    int local = 41;
    Assert.assertFalse("second failure", broken);
  }
  @Test public void passed() throws Exception {
    Files.writeString(Path.of("already-passed.txt"), "must not rerun");
  }
}
"#;
    let (root, binding, home, mut descriptor) = debug_test_fixture(tool);
    if initial_operation == "integration-test" {
        descriptor = descriptor.replace("<artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version>", "<artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version><configuration><excludes><exclude>**/DebugTest.java</exclude></excludes></configuration>");
        descriptor = descriptor.replace("</plugins>", "<plugin><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><executions><execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions><configuration><includes><include>**/DebugTest.java</include></includes></configuration></plugin></plugins>");
        fs::write(root.join("pom.xml"), &descriptor).unwrap();
    }
    let path = root.join("src/test/java/fixture/DebugTest.java");
    fs::write(&path, TEST).unwrap();
    let mut launch = request(&binding, initial_operation);
    launch.configuration.build_tool = tool.into();
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    launch.configuration.debugger_mode = if !debug_test::is_debug(initial_operation) {
        "jdb"
    } else {
        "jdi"
    }
    .into();
    launch.configuration.test_filter = "fixture.DebugTest".into();
    let executor = JavaExecutionState::default();
    executor.start(binding.clone(), launch).unwrap();
    let original = executor.job.lock().unwrap().clone().unwrap();
    let resume_entry = |job: &Arc<Job>| {
        let snapshot = wait_for(job, |value| {
            value
                .debugger_state
                .as_ref()
                .is_some_and(|state| state.reason.as_deref() == Some("entry"))
                || value.state == "failed"
        });
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        structured_debugger::send(
            job,
            &structured_debugger::Action::Continue {
                stop_id: snapshot.debugger_state.unwrap().stop_id.unwrap(),
            },
        )
        .unwrap();
    };
    if initial_operation == "debug-test" {
        resume_entry(&original);
    }
    let failed = wait_for(&original, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(failed.state, "failed", "{}", failed.output);
    assert_eq!(
        failed.can_debug_failed_tests,
        !debug_test::is_debug(initial_operation)
    );
    let results = failed.test_results.as_ref().unwrap();
    assert_eq!(results.status, "ready", "{}", failed.output);
    assert_eq!(results.summary.total, 3);
    assert_eq!(results.summary.failed + results.summary.error, 2);
    assert_eq!(results.summary.passed, 1);
    assert_eq!(
        results.failed_selections().unwrap(),
        ["fixture.DebugTest#first", "fixture.DebugTest#second"]
    );
    assert!(root.join("already-passed.txt").is_file());
    fs::remove_file(root.join("already-passed.txt")).unwrap();
    let repaired = format!("\n{}", TEST.replace("broken = true", "broken = false"));
    fs::write(&path, &repaired).unwrap();
    let fingerprint = format!("{:x}", Sha256::digest(repaired.as_bytes()));
    let points: Vec<_> = repaired
        .lines()
        .enumerate()
        .filter(|(_, line)| line.contains("Assert.assertFalse"))
        .map(|(line, _)| debugger_sources::SavedBreakpoint {
            source_path: "src/test/java/fixture/DebugTest.java".into(),
            line: line as u32 + 1,
            fingerprint: fingerprint.clone(),
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        })
        .collect();
    let rerun = executor
        .rerun_failed(
            binding.clone(),
            RerunRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: failed.session_id.clone(),
                trusted: true,
                debug: !debug_test::is_debug(initial_operation),
                source_breakpoints: points,
            },
        )
        .unwrap();
    assert_ne!(rerun.session_id, failed.session_id);
    let job = executor.job.lock().unwrap().clone().unwrap();
    assert_eq!(job.request.configuration.jdk_home, home.to_string_lossy());
    assert_eq!(
        job.request.operation,
        if initial_operation == "integration-test" {
            "debug-integration-test"
        } else {
            "debug-test"
        }
    );
    assert_eq!(job.request.configuration.debugger_mode, "jdi");
    assert_eq!(
        original.request.configuration.debugger_mode,
        if !debug_test::is_debug(initial_operation) {
            "jdb"
        } else {
            "jdi"
        }
    );
    resume_entry(&job);
    let mut previous_stop = None;
    for _ in 0..2 {
        let snapshot = wait_for(&job, |value| {
            value.debugger_state.as_ref().is_some_and(|state| {
                state.reason.as_deref() == Some("breakpoint") && state.stop_id != previous_stop
            }) || value.state == "failed"
        });
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        let state = snapshot.debugger_state.unwrap();
        assert!(state
            .variables
            .iter()
            .any(|variable| variable.name == "local" && variable.value == "41"));
        previous_stop = state.stop_id;
        structured_debugger::send(
            &job,
            &structured_debugger::Action::Continue {
                stop_id: previous_stop.clone().unwrap(),
            },
        )
        .unwrap();
    }
    let completed = wait_for(&job, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(completed.state, "succeeded", "{}", completed.output);
    let results = completed.test_results.unwrap();
    assert_eq!(results.status, "ready");
    assert_eq!(results.summary.total, 2);
    assert_eq!(results.summary.passed, 2);
    assert!(!results.can_rerun_failed);
    assert!(
        !root.join("already-passed.txt").exists(),
        "A previously passing method ran again"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), repaired);
    assert_eq!(
        fs::read_to_string(root.join(if tool == "maven" {
            "pom.xml"
        } else {
            "build.gradle"
        }))
        .unwrap(),
        descriptor
    );
    assert!(
        executor
            .rerun_failed(
                binding,
                RerunRequest {
                    workspace_id: completed.workspace_id,
                    generation: 1,
                    session_id: failed.session_id,
                    trusted: true,
                    debug: false,
                    source_breakpoints: vec![],
                }
            )
            .is_err(),
        "A retired session cannot rerun"
    );
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "Requires real Maven/JDK/JDI/JUnit and sockets; run with --test-threads=1"]
fn real_maven_debug_failed_methods_rerun_with_current_saved_breakpoints() {
    real_debug_failed_rerun("maven", "debug-test");
}
#[test]
#[ignore = "Requires real Gradle/JDK/JDI/JUnit and sockets; run with --test-threads=1"]
fn real_gradle_debug_failed_methods_rerun_with_current_saved_breakpoints() {
    real_debug_failed_rerun("gradle", "debug-test");
}

#[test]
#[ignore = "Requires real Maven/JDK/JDI/JUnit and sockets; run with --test-threads=1"]
fn real_maven_debug_failed_from_ordinary_test_uses_captured_configuration() {
    real_debug_failed_rerun("maven", "test");
}
#[test]
#[ignore = "Requires real Gradle/JDK/JDI/JUnit and sockets; run with --test-threads=1"]
fn real_gradle_debug_failed_from_ordinary_test_uses_captured_configuration() {
    real_debug_failed_rerun("gradle", "test");
}

#[test]
#[ignore = "Requires real Maven/Failsafe/JDK/JDI/JUnit and sockets; run with --test-threads=1"]
fn real_maven_debug_failed_integration_tests_use_captured_failsafe_configuration() {
    real_debug_failed_rerun("maven", "integration-test");
}

#[test]
#[ignore = "Requires real Maven/JDK/JUnit; run with --test-threads=1"]
fn real_maven_debug_failed_admission_refuses_failures_from_multiple_classes() {
    let (root, binding, home, _) = debug_test_fixture("maven");
    fs::write(root.join("src/test/java/fixture/OtherTest.java"), "package fixture; public class OtherTest { @org.junit.Test public void other() { org.junit.Assert.fail(\"another class\"); } }").unwrap();
    let mut launch = request(&binding, "test");
    launch.configuration.build_tool = "maven".into();
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    let executor = JavaExecutionState::default();
    executor.start(binding.clone(), launch).unwrap();
    let original = executor.job.lock().unwrap().clone().unwrap();
    let failed = wait_for(&original, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(failed.state, "failed", "{}", failed.output);
    assert_eq!(failed.test_results.as_ref().unwrap().status, "ready");
    assert_eq!(failed.test_results.as_ref().unwrap().summary.failed, 2);
    assert!(!failed.can_debug_failed_tests);
    let session_id = failed.session_id;
    let error = executor
        .rerun_failed(
            binding.clone(),
            RerunRequest {
                workspace_id: binding.workspace_id,
                generation: 1,
                session_id: session_id.clone(),
                trusted: true,
                debug: true,
                source_breakpoints: vec![],
            },
        )
        .err()
        .expect("Cross-class debug selections must be refused");
    assert!(error.contains("one test class"), "{error}");
    assert_eq!(
        executor
            .job
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .read()
            .unwrap()
            .session_id,
        session_id
    );
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

fn real_framework_test_debug(tool: &str, framework: &str, metadata_available: bool) {
    use sha2::{Digest, Sha256};
    let (root, binding, home, descriptor) = debug_test_fixture(tool);
    if !metadata_available {
        use std::os::unix::fs::PermissionsExt;
        let executable = on_path("gradle").unwrap();
        let wrapper = root.join("gradlew");
        fs::write(&wrapper, format!("#!/bin/sh\nmethod_output=''\nfor argument do\n  case \"$argument\" in */test-methods.init.gradle) method_output=\"${{argument%/*}}/test-methods.jsonl\" ;; esac\ndone\n'{}' --offline \"$@\"\nrun_status=$?\nif [ -n \"$method_output\" ]; then rm -f -- \"$method_output\"; fi\nexit \"$run_status\"\n", executable.to_string_lossy().replace('\'', "'\\''"))).unwrap();
        fs::set_permissions(wrapper, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let descriptor = if tool == "maven" {
        descriptor.replace("<groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version>", if framework == "jupiter" {
            "<groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.2</version>"
        } else { "<groupId>org.testng</groupId><artifactId>testng</artifactId><version>7.10.2</version>" })
    } else if framework == "jupiter" {
        descriptor.replace("testImplementation 'junit:junit:4.13.2'", "testImplementation 'org.junit.jupiter:junit-jupiter:5.11.2'; testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.11.2'").replace("useJUnit()", "useJUnitPlatform()")
    } else {
        descriptor
            .replace(
                "testImplementation 'junit:junit:4.13.2'",
                "testImplementation 'org.testng:testng:7.10.2'",
            )
            .replace("useJUnit()", "useTestNG()")
    };
    let descriptor_path = root.join(if tool == "maven" {
        "pom.xml"
    } else {
        "build.gradle"
    });
    fs::write(&descriptor_path, &descriptor).unwrap();
    let annotation = if framework == "jupiter" {
        "org.junit.jupiter.api.Test"
    } else {
        "org.testng.annotations.Test"
    };
    let source = format!(
        r#"package fixture;
import java.nio.file.*;
public class DebugTest {{
  @{annotation} public void selected() throws Exception {{
    int local = 41;
    Files.writeString(Path.of("framework-test.pid"), "" + ProcessHandle.current().pid());
    Files.writeString(Path.of("framework-test-result.txt"), "" + (local + 1));
    if (!"retained".equals(System.getProperty("fixture.project"))) throw new AssertionError("lost project settings");
  }}
  @{annotation} public void companion() {{ throw new AssertionError("unselected method ran"); }}
}}
"#
    );
    let source = if framework == "jupiter" {
        source.replace(&format!("@{annotation} public void companion()"), &format!("@org.junit.jupiter.api.DisplayName(\"selected()\") @{annotation} public void companion()"))
    } else {
        source
    };
    let path = root.join("src/test/java/fixture/DebugTest.java");
    fs::write(&path, &source).unwrap();
    let executor = JavaExecutionState::default();
    let mut discovery = request(&binding, "discover");
    discovery.configuration.build_tool = tool.into();
    discovery.configuration.jdk_home = home.to_string_lossy().into_owned();
    discovery.configuration.test_framework = if framework == "testng" {
        "testng"
    } else {
        "junit"
    }
    .into();
    executor.start(binding.clone(), discovery.clone()).unwrap();
    let discovering = executor.job.lock().unwrap().clone().unwrap();
    let found = wait_for(&discovering, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(found.state, "succeeded", "{}", found.output);
    let tests = found.test_discovery.unwrap();
    assert_eq!(tests.status, "ready");
    let selected = tests
        .tests
        .iter()
        .find(|test| {
            test.class_name == "fixture.DebugTest"
                && test.method_name.as_deref() == Some("selected")
        })
        .unwrap();
    assert!(!root.join("framework-test-result.txt").exists());
    let points = vec![debugger_sources::SavedBreakpoint {
        source_path: "src/test/java/fixture/DebugTest.java".into(),
        line: source
            .lines()
            .position(|line| line.contains("framework-test-result.txt"))
            .unwrap() as u32
            + 1,
        fingerprint: format!("{:x}", Sha256::digest(source.as_bytes())),
        condition: String::new(),
        hit_count: 0,
        log_message: String::new(),
    }];
    let mut launch = discovery;
    launch.operation = "debug-test".into();
    launch.test_selection = Some(TestSelection {
        discovery_session_id: found.session_id,
        test_id: selected.id.clone(),
    });
    launch.configuration.jdk_home = "/missing-current-jdk".into();
    launch.configuration.test_framework = "junit".into();
    launch.source_breakpoints = points.clone();
    executor.start(binding.clone(), launch).unwrap();
    let inspect = |job: &Arc<Job>| {
        let entry = wait_for(job, |value| {
            value
                .debugger_state
                .as_ref()
                .is_some_and(|s| s.reason.as_deref() == Some("entry"))
                || value.state == "failed"
        });
        assert_ne!(entry.state, "failed", "{}", entry.output);
        structured_debugger::send(
            job,
            &structured_debugger::Action::Continue {
                stop_id: entry.debugger_state.unwrap().stop_id.unwrap(),
            },
        )
        .unwrap();
        let stopped = wait_for(job, |value| {
            value
                .debugger_state
                .as_ref()
                .is_some_and(|s| s.reason.as_deref() == Some("breakpoint"))
                || value.state == "failed"
        });
        assert_ne!(stopped.state, "failed", "{}", stopped.output);
        let state = stopped.debugger_state.unwrap();
        assert!(state
            .variables
            .iter()
            .any(|v| v.name == "local" && v.value == "41"));
        assert!(!state.can_reload_classes);
        state.stop_id.unwrap()
    };
    let job = executor.job.lock().unwrap().clone().unwrap();
    let stop_id = inspect(&job);
    assert!(!root.join("framework-test-result.txt").exists());
    structured_debugger::send(&job, &structured_debugger::Action::Continue { stop_id }).unwrap();
    let complete = wait_for(&job, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(complete.state, "succeeded", "{}", complete.output);
    let results = complete.test_results.unwrap();
    assert_eq!(results.status, "ready");
    assert_eq!(results.summary.total, 1);
    assert_eq!(results.summary.passed, 1);
    assert_eq!(
        fs::read_to_string(root.join("framework-test-result.txt")).unwrap(),
        "42"
    );
    fs::remove_file(root.join("framework-test-result.txt")).unwrap();
    executor
        .restart(
            binding.clone(),
            RestartRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: complete.session_id,
                trusted: true,
                source_breakpoints: points,
            },
        )
        .unwrap();
    let repeated = executor.job.lock().unwrap().clone().unwrap();
    inspect(&repeated);
    let pid: i32 = fs::read_to_string(root.join("framework-test.pid"))
        .unwrap()
        .parse()
        .unwrap();
    repeated.stop();
    let stopped = wait_for(&repeated, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(stopped.state, "stopped");
    assert!(!root.join("framework-test-result.txt").exists());
    #[cfg(unix)]
    unsafe {
        assert_ne!(libc::kill(pid, 0), 0, "Stopped framework JVM survived");
    }
    let mut ordinary = job.request.clone();
    ordinary.operation = "test".into();
    ordinary.source_breakpoints.clear();
    ordinary.configuration.test_filter = "fixture.DebugTest".into();
    ordinary.test_selection = None;
    executor.start(binding.clone(), ordinary).unwrap();
    let ordinary_job = executor.job.lock().unwrap().clone().unwrap();
    let failed = wait_for(&ordinary_job, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(failed.state, "failed", "{}", failed.output);
    assert!(failed.can_debug_failed_tests);
    let result = failed.test_results.as_ref().unwrap();
    assert_eq!(result.status, "ready");
    assert_eq!(result.summary.total, 2);
    assert_eq!(result.summary.passed, 1);
    assert_eq!(result.summary.failed + result.summary.error, 1);
    for case in result.suites.iter().flat_map(|suite| &suite.cases) {
        if tool == "gradle" && metadata_available {
            let method = case
                .method_source
                .as_ref()
                .expect("Gradle runner method source missing");
            assert_eq!(method.class_name, "fixture.DebugTest");
            assert_eq!(
                method.method_name,
                if case.state == "passed" {
                    "selected"
                } else {
                    "companion"
                }
            );
        } else {
            assert!(case.method_source.is_none());
        }
    }
    let selectors = result.failed_selections().unwrap();
    let whole_class = tool == "gradle" && framework == "jupiter" && !metadata_available;
    assert_eq!(
        selectors,
        if whole_class {
            vec!["fixture.DebugTest"]
        } else {
            vec!["fixture.DebugTest#companion"]
        }
    );
    assert_eq!(result.rerun_selections.len(), 1);
    assert_eq!(result.rerun_selections[0].class_name, "fixture.DebugTest");
    assert_eq!(
        result.rerun_selections[0].method_name.as_deref(),
        if whole_class { None } else { Some("companion") }
    );
    fs::remove_file(root.join("framework-test-result.txt")).unwrap();
    let repaired = source.replace(
        "throw new AssertionError(\"unselected method ran\");",
        "System.out.println(\"repaired companion\");",
    );
    assert_ne!(repaired, source);
    fs::write(&path, repaired).unwrap();
    executor
        .rerun_failed(
            binding.clone(),
            RerunRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: failed.session_id,
                trusted: true,
                debug: true,
                source_breakpoints: vec![],
            },
        )
        .unwrap();
    let rerun = executor.job.lock().unwrap().clone().unwrap();
    let entry = wait_for(&rerun, |value| {
        value
            .debugger_state
            .as_ref()
            .is_some_and(|state| state.reason.as_deref() == Some("entry"))
            || value.state == "failed"
    });
    assert_ne!(entry.state, "failed", "{}", entry.output);
    structured_debugger::send(
        &rerun,
        &structured_debugger::Action::Continue {
            stop_id: entry.debugger_state.unwrap().stop_id.unwrap(),
        },
    )
    .unwrap();
    let passed = wait_for(&rerun, |value| {
        !["starting", "running"].contains(&value.state.as_str())
    });
    assert_eq!(passed.state, "succeeded", "{}", passed.output);
    let rerun_results = passed.test_results.unwrap();
    assert_eq!(rerun_results.status, "ready");
    assert_eq!(rerun_results.summary.total, if whole_class { 2 } else { 1 });
    assert_eq!(rerun_results.summary.passed, rerun_results.summary.total);
    assert_eq!(root.join("framework-test-result.txt").exists(), whole_class);
    eprintln!("{tool}/{framework}: captured selected-method debug and Stop passed; failed rerun selections={selectors:?}; whole-class fallback={whole_class}; fresh passing cases={}", rerun_results.summary.total);
    fs::write(&path, &source).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), source);
    assert_eq!(fs::read_to_string(&descriptor_path).unwrap(), descriptor);
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "Requires real Maven/JDK/JDI/Jupiter and sockets; run with --test-threads=1"]
fn real_maven_jupiter_selected_test_debug_and_stop() {
    real_framework_test_debug("maven", "jupiter", true);
}
#[test]
#[ignore = "Requires real Gradle/JDK/JDI/Jupiter and sockets; run with --test-threads=1"]
fn real_gradle_jupiter_selected_test_debug_and_stop() {
    real_framework_test_debug("gradle", "jupiter", true);
}
#[test]
#[ignore = "Requires real Maven/JDK/JDI/TestNG and sockets; run with --test-threads=1"]
fn real_maven_testng_selected_test_debug_and_stop() {
    real_framework_test_debug("maven", "testng", true);
}
#[test]
#[ignore = "Requires real Gradle/JDK/JDI/TestNG and sockets; run with --test-threads=1"]
fn real_gradle_testng_selected_test_debug_and_stop() {
    real_framework_test_debug("gradle", "testng", true);
}

#[test]
#[ignore = "Requires real Gradle/JDK/JDI/Jupiter and sockets; run with --test-threads=1"]
fn real_gradle_jupiter_selected_test_debug_and_stop_without_method_metadata() {
    real_framework_test_debug("gradle", "jupiter", false);
}
