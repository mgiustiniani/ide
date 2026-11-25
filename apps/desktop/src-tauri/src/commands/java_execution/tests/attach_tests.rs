use super::super::structured_debugger::{self, Action, Status};
use super::*;
use std::io::{BufRead, BufReader};
use std::sync::mpsc::{self, Receiver};
use std::time::Instant;

const SOURCE: &str = r#"package example;
public class External {
  static class Holder {
    int number = 7;
    public String toString() { throw new AssertionError("Debugger invoked application code"); }
  }
  public static void main(String[] args) throws Exception {
    Holder holder = new Holder();
    int counter = 0;
    while (true) {
      counter += 1;
      java.nio.file.Files.writeString(java.nio.file.Path.of("tick.txt"), "" + counter);
      Thread.sleep(75);
    }
  }
}
"#;

struct ExternalTarget {
    root: PathBuf,
    child: Child,
    output: Receiver<String>,
}
impl ExternalTarget {
    fn start(home: &Path, suspend: bool) -> Self {
        let (root, _) = fixture();
        fs::write(root.join("External.java"), SOURCE).unwrap();
        let classes = root.join("classes");
        fs::create_dir(&classes).unwrap();
        let result = Command::new(home.join("bin/javac"))
            .args(["-g", "-d"])
            .arg(&classes)
            .arg(root.join("External.java"))
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let mut child = Command::new(home.join("bin/java"))
            .arg(format!(
                "-agentlib:jdwp=transport=dt_socket,server=y,address=127.0.0.1:0,suspend={}",
                if suspend { "y" } else { "n" }
            ))
            .args(["-cp"])
            .arg(classes)
            .arg("example.External")
            .current_dir(&root)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, output) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Self {
            root,
            child,
            output,
        }
    }
    fn port(&self) -> String {
        let line = self.output.recv_timeout(Duration::from_secs(10)).unwrap();
        let port = line
            .strip_prefix("Listening for transport dt_socket at address: ")
            .unwrap();
        assert!(port.parse::<u16>().unwrap() > 0);
        port.into()
    }
    fn tick(&self) -> u64 {
        fs::read_to_string(self.root.join("tick.txt"))
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0)
    }
    fn advances_after(&mut self, previous: u64) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            assert!(
                self.child.try_wait().unwrap().is_none(),
                "IDE terminated the external JVM"
            );
            if self.tick() > previous {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "External JVM remained suspended after Detach"
            );
            thread::sleep(Duration::from_millis(30));
        }
    }
}
impl Drop for ExternalTarget {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn attached(
    job: &Arc<Job>,
    predicate: impl Fn(&structured_debugger::DebugState) -> bool,
) -> structured_debugger::DebugState {
    wait_for(job, |snapshot| {
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        snapshot.debugger_state.as_ref().is_some_and(&predicate)
    })
    .debugger_state
    .unwrap()
}
fn attach_request(binding: &CurrentWorkspaceBinding, home: &Path, port: String) -> Request {
    let mut launch = request(binding, "attach");
    launch.configuration.debugger_mode = "jdi".into();
    launch.configuration.debugger_attach = Some(attach::Target {
        host: "127.0.0.1".into(),
        port,
    });
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    // These launch-only settings must not compile or launch workspace code.
    launch.configuration.main_class = String::new();
    launch.configuration.class_path = vec!["absent-library.jar".into()];
    launch.configuration.project_path = ".".into();
    launch.configuration.build_tool = "maven".into();
    launch
}

#[test]
fn attach_validates_endpoint_mode_and_admission_without_project_execution() {
    let (_, binding) = fixture();
    let mut request = request(&binding, "attach");
    request.configuration.debugger_mode = "jdi".into();
    for (host, port) in [
        ("", "5005"),
        ("host/path", "5005"),
        ("*", "5005"),
        ("host name", "5005"),
        ("127.0.0.1", "0"),
        ("127.0.0.1", "65536"),
        ("127.0.0.1", "-1"),
    ] {
        request.configuration.debugger_attach = Some(attach::Target {
            host: host.into(),
            port: port.into(),
        });
        assert!(validate_settings(&request.configuration, "attach").is_err());
    }
    for host in ["127.0.0.1", "localhost", "::1", "[::1]"] {
        assert!(attach::validate(&attach::Target {
            host: host.into(),
            port: "65535".into()
        })
        .is_ok());
    }
    request.trusted = false;
    assert!(invocation(Path::new("/absent"), &request)
        .unwrap_err()
        .contains("trust"));
    request.trusted = true;
    request.configuration.debugger_attach = None;
    request.configuration.debugger_mode = "jdb".into();
    assert!(invocation(&binding.canonical_root, &request)
        .unwrap_err()
        .contains("JDI"));
    fs::remove_dir_all(binding.canonical_root).unwrap();
}

#[test]
#[ignore = "Requires real JDK JDI, a local JDWP socket and owned external fixture JVMs; run with --test-threads=1"]
fn real_jdi_attach_inspects_breakpoints_detaches_and_preserves_external_jvm_on_eof_and_bad_input() {
    let home = std::env::var_os("IDE_TEST_ALTERNATE_JDK_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| selected_jdk("").unwrap());
    for suspend in [false, true] {
        let (root, binding) = fixture();
        let original = "This unsaved project's disk source is intentionally not compilable.\n";
        fs::write(root.join("Main.java"), original).unwrap();
        fs::write(root.join("External.java"), SOURCE).unwrap();
        let mut target = ExternalTarget::start(&home, suspend);
        let state = JavaExecutionState::default();
        state
            .start(
                binding.clone(),
                attach_request(&binding, &home, target.port()),
            )
            .unwrap();
        let job = state.job.lock().unwrap().as_ref().unwrap().clone();
        assert_ne!(
            job.child.lock().unwrap().as_ref().map(Child::id),
            Some(target.child.id())
        );
        let initial = attached(&job, |value| {
            if suspend {
                value.reason.as_deref() == Some("entry")
            } else {
                value.status == Status::Running
            }
        });
        let sources = job.sources.lock().unwrap();
        assert!(
            sources.as_ref().is_some_and(Result::is_ok),
            "attached source capture failed: {}",
            sources
                .as_ref()
                .and_then(|result| result.as_ref().err())
                .map(String::as_str)
                .unwrap_or("not ready")
        );
        drop(sources);
        let line = (SOURCE
            .lines()
            .position(|line| line.contains("counter += 1"))
            .unwrap()
            + 1) as u32;
        structured_debugger::send(
            &job,
            &Action::SetBreakpoint {
                class_name: "example.External".into(),
                line,
                condition: String::new(),
                hit_count: 0,
                log_message: String::new(),
            },
        )
        .unwrap();
        if suspend {
            structured_debugger::send(
                &job,
                &Action::Continue {
                    stop_id: initial.stop_id.unwrap(),
                },
            )
            .unwrap();
        }
        let stopped = attached(&job, |value| value.reason.as_deref() == Some("breakpoint"));
        assert!(stopped.breakpoints.iter().any(|point| point.verified));
        assert_eq!(stopped.frames[0].class_name, "example.External");
        assert!(stopped
            .variables
            .iter()
            .any(|value| value.name == "counter"));
        let source_path = root.join("External.java").to_string_lossy().into_owned();
        let request = || debugger_sources::SourceRequest {
            workspace_id: job.request.workspace_id.clone(),
            generation: job.request.generation,
            session_id: job.read().unwrap().session_id,
            request_id: "attached-source-inspection".into(),
            document: debugger_sources::Document {
                path: source_path.clone(),
                text: SOURCE.into(),
                version: 1,
            },
            stop_id: stopped.stop_id.clone(),
            frame_id: stopped.selected_frame_id.clone(),
        };
        let source_view = debugger_sources::inspect(&job, &request()).unwrap();
        let source_view = serde_json::to_value(source_view).unwrap();
        assert_eq!(source_view["sourcePath"], "External.java");
        assert_eq!(source_view["executionLine"], line);
        let source_line = (SOURCE
            .lines()
            .position(|line| line.contains("Thread.sleep(75)"))
            .unwrap()
            + 1) as u32;
        debugger_sources::toggle(
            &job,
            &debugger_sources::BreakpointRequest {
                source: request(),
                line: source_line,
                condition: String::new(),
                hit_count: 0,
                log_message: String::new(),
            },
        )
        .unwrap();
        let configured = wait_for(&job, |snapshot| {
            snapshot.debugger_state.as_ref().is_some_and(|state| {
                state
                    .breakpoints
                    .iter()
                    .any(|point| point.class_name.is_none() && point.line == source_line)
            })
        });
        let configured_point = configured
            .debugger_state
            .as_ref()
            .unwrap()
            .breakpoints
            .iter()
            .find(|point| point.class_name.is_none() && point.line == source_line)
            .unwrap();
        assert!(
            configured_point.verified,
            "attached source breakpoint was not verified: {configured_point:?}"
        );
        structured_debugger::send(
            &job,
            &Action::Continue {
                stop_id: stopped.stop_id.clone().unwrap(),
            },
        )
        .unwrap();
        let source_stopped = attached(&job, |value| {
            value.reason.as_deref() == Some("breakpoint")
                && value.frames.first().is_some_and(|frame| {
                    frame.class_name == "example.External" && frame.line == Some(source_line)
                })
        });
        let source_view = debugger_sources::inspect(
            &job,
            &debugger_sources::SourceRequest {
                workspace_id: job.request.workspace_id.clone(),
                generation: job.request.generation,
                session_id: job.read().unwrap().session_id,
                request_id: "attached-source-breakpoint".into(),
                document: debugger_sources::Document {
                    path: source_path,
                    text: SOURCE.into(),
                    version: 1,
                },
                stop_id: source_stopped.stop_id.clone(),
                frame_id: source_stopped.selected_frame_id.clone(),
            },
        )
        .unwrap();
        let source_view = serde_json::to_value(source_view).unwrap();
        assert_eq!(source_view["executionLine"], source_line);
        assert!(source_view["breakpoints"]
            .as_array()
            .unwrap()
            .iter()
            .any(|point| point["line"] == source_line && point["verified"] == true));
        structured_debugger::send(
            &job,
            &Action::Watch {
                stop_id: source_stopped.stop_id.clone().unwrap(),
                expression: "holder.number".into(),
            },
        )
        .unwrap();
        let watched = attached(&job, |value| !value.watches.is_empty());
        assert_eq!(watched.watches[0].variable.as_ref().unwrap().value, "7");
        let before = target.tick();
        job.stop();
        assert_eq!(job.read().unwrap().state, "stopped");
        target.advances_after(before);
        assert_eq!(
            fs::read_to_string(root.join("Main.java")).unwrap(),
            original
        );
        // Reconnect to the same external JVM, using its actual new listening port.
        state
            .start(
                binding.clone(),
                attach_request(&binding, &home, target.port()),
            )
            .unwrap();
        let job = state.job.lock().unwrap().as_ref().unwrap().clone();
        attached(&job, |value| value.status == Status::Running);
        if suspend {
            // Malformed transport must dispose, never call VirtualMachine.exit.
            let mut child = job.child.lock().unwrap();
            debugger_input::send(child.as_mut().unwrap().stdin.as_ref().unwrap(), "!").unwrap();
        } else {
            drop(job.child.lock().unwrap().as_mut().unwrap().stdin.take());
        }
        let closed = wait_for(&job, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(
            closed.state,
            if suspend { "failed" } else { "succeeded" },
            "{}",
            closed.output
        );
        assert_eq!(
            closed.exit_code,
            Some(if suspend { 1 } else { 0 }),
            "{}",
            closed.output
        );
        assert_eq!(closed.debugger_state.unwrap().status, Status::Terminated);
        assert!(!closed.output.contains("without a complete runtime session"));
        target.advances_after(target.tick());
        assert_eq!(
            fs::read_to_string(root.join("Main.java")).unwrap(),
            original
        );
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "Requires a real full JDK and local sockets; run with --test-threads=1"]
fn real_jdi_attach_reports_connection_refusal_without_success_or_source_writes() {
    let (root, binding) = fixture();
    let before = fs::read(root.join("Main.java")).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port().to_string();
    drop(listener);
    let home = selected_jdk("").unwrap();
    let state = JavaExecutionState::default();
    state
        .start(binding.clone(), attach_request(&binding, &home, port))
        .unwrap();
    let job = state.job.lock().unwrap().as_ref().unwrap().clone();
    let result = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(result.state, "failed", "{}", result.output);
    assert!(result.debugger_state.is_none());
    assert!(result.exit_code.is_some_and(|code| code != 0));
    assert_eq!(fs::read(root.join("Main.java")).unwrap(), before);
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
