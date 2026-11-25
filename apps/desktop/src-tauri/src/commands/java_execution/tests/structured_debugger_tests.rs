use super::super::structured_debugger::{self, Action, ExceptionMode, Status, StepKind};
use super::*;

const MAIN: &str = r#"public class Main {
  static int[] staticValues = {10, 20, 30};
  static Holder[] staticHolders = {new Holder()};
  static Object[] staticObjects = {};
  static CharSequence[] staticSequences = {"ready"};
  static int[][] staticMatrix = {staticValues};
  static class Holder {
    static int staticNumber = 11;
    int number = 7;
    String text = "ready";
    char marker = '!';
    int[] values = java.util.stream.IntStream.range(0, 44).toArray();
    public String toString() { throw new AssertionError("Debugger invoked application code"); }
  }
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("debug-pid.txt"), "" + ProcessHandle.current().pid());
    java.nio.file.Files.writeString(java.nio.file.Path.of("debug-settings.txt"), String.join("\n", args) + "\nVM=" + System.getProperty("ide.jdi") + "\nENV=" + System.getenv("IDE_JDI_VALUE") + "\nJDK=" + System.getProperty("java.home"));
    int base = 7;
    String literal = "π🧪\0line\n";
    String malformed = "" + (char) 0xd800;
    Thread named = new Thread(() -> { try { Thread.sleep(300000); } catch (InterruptedException ignored) { } }, "control\0🧪");
    named.setDaemon(true); named.start();
    long widened = 0L;
    Integer boxed = 6;
    byte narrow = 2;
    short small = 0;
    char letter = '\uffff';
    float rounded = 0.0f;
    double widenedFloat = 0.0;
    boolean flag = false;
    Boolean boxedFlag = true;
    Holder holder = new Holder();
    int result = calculate(base, holder);
    java.nio.file.Files.writeString(java.nio.file.Path.of("debug-result.txt"), "" + result);
    System.out.println("x".repeat(2047) + "🧪");
  }
  static int calculate(int base, Holder holder) {
    int value = base * 6;
    return value;
  }
}
"#;
fn line(text: &str) -> u32 {
    (MAIN.lines().position(|line| line.contains(text)).unwrap() + 1) as u32
}
fn debug_state(
    job: &Arc<Job>,
    predicate: impl Fn(&structured_debugger::DebugState) -> bool,
) -> structured_debugger::DebugState {
    let snapshot = wait_for(job, |snapshot| {
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        snapshot.debugger_state.as_ref().is_some_and(&predicate)
    });
    snapshot.debugger_state.unwrap()
}
fn at_line(job: &Arc<Job>, expected: u32) -> structured_debugger::DebugState {
    debug_state(job, |state| {
        state.status == Status::Suspended
            && state
                .frames
                .first()
                .is_some_and(|frame| frame.line == Some(expected))
    })
}
fn stop_id(state: &structured_debugger::DebugState) -> String {
    state.stop_id.clone().unwrap()
}

#[test]
fn saved_source_breakpoints_validate_mode_paths_fingerprints_duplicates_and_bounds() {
    use super::super::debugger_sources::{validate_initial, SavedBreakpoint};
    let (_, binding) = fixture();
    let mut launch = request(&binding, "debug");
    launch.configuration.debugger_mode = "jdi".into();
    let point = SavedBreakpoint {
        source_path: "pkg/Main.java".into(),
        line: 2,
        fingerprint: "a".repeat(64),
        condition: String::new(),
        hit_count: 0,
        log_message: String::new(),
    };
    launch.source_breakpoints = vec![point.clone()];
    assert!(validate_initial(&launch).is_ok());
    for path in [
        "../Main.java",
        "/Main.java",
        "pkg\\Main.java",
        "x:Main.java",
        "pkg//Main.java",
        "a\nMain.java",
    ] {
        launch.source_breakpoints = vec![SavedBreakpoint {
            source_path: path.into(),
            ..point.clone()
        }];
        assert!(validate_initial(&launch).is_err(), "{path}");
    }
    for fingerprint in ["a".repeat(63), "A".repeat(64), "z".repeat(64)] {
        launch.source_breakpoints = vec![SavedBreakpoint {
            fingerprint,
            ..point.clone()
        }];
        assert!(validate_initial(&launch).is_err());
    }
    launch.source_breakpoints = vec![point.clone(), point.clone()];
    assert!(validate_initial(&launch).is_err());
    launch.source_breakpoints = (1..=129)
        .map(|line| SavedBreakpoint {
            line,
            ..point.clone()
        })
        .collect();
    assert!(validate_initial(&launch).is_err());
    launch.source_breakpoints = vec![point.clone()];
    launch.configuration.debugger_mode = "jdb".into();
    assert!(validate_initial(&launch).unwrap_err().contains("JDI"));
    launch.configuration.debugger_mode = "jdi".into();
    launch.operation = "run".into();
    assert!(validate_initial(&launch).is_err());
    launch.operation = "debug".into();
    for line in [0, u32::MAX] {
        launch.source_breakpoints = vec![SavedBreakpoint {
            line,
            ..point.clone()
        }];
        assert!(validate_initial(&launch).is_err());
    }
}

#[test]
#[ignore = "Requires a real full JDK, compiler, debugger transport and process ownership"]
fn real_jdi_saved_source_breakpoints_load_before_application_code_restart_and_refuse_stale_text() {
    use super::super::debugger_sources::{
        inspect, toggle, BreakpointRequest, SavedBreakpoint, SourceRequest,
    };
    use sha2::{Digest, Sha256};
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), MAIN).unwrap();
    let mut launch = request(&binding, "debug");
    launch.configuration.debugger_mode = "jdi".into();
    if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
        launch.configuration.jdk_home = home;
    }
    let fingerprint = format!("{:x}", Sha256::digest(MAIN.as_bytes()));
    launch.source_breakpoints = [line("int base"), line("int result")]
        .into_iter()
        .map(|line| SavedBreakpoint {
            source_path: "Main.java".into(),
            line,
            fingerprint: fingerprint.clone(),
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        })
        .collect();
    let executor = JavaExecutionState::default();
    executor.start(binding.clone(), launch.clone()).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
    assert_eq!(entry.breakpoints.len(), 2);
    assert!(entry
        .breakpoints
        .iter()
        .all(|point| point.source_path.as_deref() == Some("Main.java") && !point.verified));
    assert!(!root.join("debug-pid.txt").exists());
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&entry),
        },
    )
    .unwrap();
    let first = at_line(&job, line("int base"));
    assert_eq!(first.reason.as_deref(), Some("breakpoint"));
    assert!(first.breakpoints.iter().all(|point| point.verified));
    assert!(!root.join("debug-result.txt").exists());
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&first),
        },
    )
    .unwrap();
    let second = at_line(&job, line("int result"));
    let session = job.read().unwrap();
    let source = SourceRequest {
        workspace_id: session.workspace_id.clone(),
        generation: session.generation,
        session_id: session.session_id.clone(),
        request_id: "saved-source".into(),
        document: super::super::debugger_sources::Document {
            path: root.join("Main.java").to_string_lossy().into_owned(),
            text: MAIN.into(),
            version: 1,
        },
        stop_id: second.stop_id.clone(),
        frame_id: second.selected_frame_id.clone(),
    };
    assert_eq!(
        serde_json::to_value(inspect(&job, &source).unwrap()).unwrap()["executionLine"],
        line("int result")
    );
    for target in [line("int base"), line("int result")] {
        toggle(
            &job,
            &BreakpointRequest {
                source: SourceRequest {
                    workspace_id: source.workspace_id.clone(),
                    generation: source.generation,
                    session_id: source.session_id.clone(),
                    request_id: "clear-saved".into(),
                    document: super::super::debugger_sources::Document {
                        path: source.document.path.clone(),
                        text: MAIN.into(),
                        version: 1,
                    },
                    stop_id: source.stop_id.clone(),
                    frame_id: source.frame_id.clone(),
                },
                line: target,
                condition: String::new(),
                hit_count: 0,
                log_message: String::new(),
            },
        )
        .unwrap();
    }
    debug_state(&job, |state| state.breakpoints.is_empty());
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&second),
        },
    )
    .unwrap();
    assert_eq!(
        wait_for(&job, |snapshot| snapshot.state == "succeeded"
            || snapshot.state == "failed")
        .state,
        "succeeded"
    );
    assert_eq!(
        fs::read_to_string(root.join("debug-result.txt")).unwrap(),
        "42"
    );
    fs::remove_file(root.join("debug-pid.txt")).unwrap();
    fs::remove_file(root.join("debug-result.txt")).unwrap();
    executor.start(binding.clone(), launch.clone()).unwrap();
    let restarted = executor.job.lock().unwrap().clone().unwrap();
    let repeated = debug_state(&restarted, |state| state.reason.as_deref() == Some("entry"));
    assert_eq!(repeated.breakpoints.len(), 2);
    assert_ne!(
        job.read().unwrap().session_id,
        restarted.read().unwrap().session_id
    );
    assert!(!root.join("debug-pid.txt").exists());
    restarted.stop();
    wait_for(&restarted, |snapshot| snapshot.state == "stopped");
    let classes = root.join(".ide/java/classes/Main.class");
    let compiled = fs::read(&classes).unwrap();
    let changed = MAIN.replace("int base = 7", "int base = 8");
    fs::write(root.join("Main.java"), &changed).unwrap();
    executor.start(binding.clone(), launch.clone()).unwrap();
    let stale = executor.job.lock().unwrap().clone().unwrap();
    let refused = wait_for(&stale, |snapshot| snapshot.state == "failed");
    assert!(
        refused.output.contains("changed source"),
        "{}",
        refused.output
    );
    assert!(refused.debugger_state.is_none());
    assert_eq!(fs::read(&classes).unwrap(), compiled);
    assert_eq!(fs::read_to_string(root.join("Main.java")).unwrap(), changed);
    assert!(!root.join("debug-pid.txt").exists());
    fs::write(root.join("Main.java"), MAIN).unwrap();
    launch.source_breakpoints = vec![SavedBreakpoint {
        source_path: "other/Absent.java".into(),
        line: 2,
        fingerprint,
        condition: String::new(),
        hit_count: 0,
        log_message: String::new(),
    }];
    executor.start(binding, launch).unwrap();
    let other = executor.job.lock().unwrap().clone().unwrap();
    let entry = debug_state(&other, |state| state.reason.as_deref() == Some("entry"));
    assert!(entry.breakpoints.is_empty());
    assert!(other
        .read()
        .unwrap()
        .output
        .contains("outside captured sources"));
    other.stop();
    wait_for(&other, |snapshot| snapshot.state == "stopped");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn jdi_capability_requires_a_supported_full_jdk_and_bounded_release_metadata() {
    let (root, _) = fixture();
    let home = root.join("selected-jdk");
    fs::create_dir_all(home.join("jmods")).unwrap();
    fs::write(home.join("jmods/jdk.jdi.jmod"), "module marker").unwrap();
    for release in [
        "JAVA_VERSION=\"11.0.25\"\n",
        "JAVA_VERSION=\"16\"\n",
        "JAVA_VERSION=unknown\n",
        "OTHER_PROPERTY=\"21\"\n",
    ] {
        fs::write(home.join("release"), release).unwrap();
        assert!(!structured_debugger::available(&home));
    }
    for release in [
        "JAVA_VERSION=\"17.0.12\"\n",
        "JAVA_VERSION=\"21-ea\"\n",
        "JAVA_VERSION=\"25.0.3\"\n",
    ] {
        fs::write(home.join("release"), release).unwrap();
        assert_eq!(structured_debugger::available(&home), cfg!(unix));
    }
    fs::write(
        home.join("release"),
        format!("JAVA_VERSION=\"21\"\n{}", "x".repeat(16384)),
    )
    .unwrap();
    assert!(!structured_debugger::available(&home));
    fs::remove_file(home.join("release")).unwrap();
    assert!(!structured_debugger::available(&home));
    fs::write(home.join("release"), "JAVA_VERSION=\"21\"\n").unwrap();
    fs::remove_file(home.join("jmods/jdk.jdi.jmod")).unwrap();
    assert!(!structured_debugger::available(&home));
    fs::create_dir_all(home.join("lib")).unwrap();
    fs::write(home.join("lib/modules"), "runtime image marker").unwrap();
    for (release, has_jdi) in [
        ("JAVA_VERSION=\"27+1\"\nMODULES=\"java.base jdk.jdi jdk.jdwp.agent\"\n", true),
        ("JAVA_VERSION=\"27\"\nMODULES=\"java.base jdk.jdwp.agent\"\n", false),
        ("JAVA_VERSION=\"27\"\nMODULES=\"java.base jdk.jdi.example\"\n", false),
        ("JAVA_VERSION=\"16\"\nMODULES=\"java.base jdk.jdi\"\n", false),
    ] {
        fs::write(home.join("release"), release).unwrap();
        assert_eq!(structured_debugger::available(&home), has_jdi && cfg!(unix));
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn jdi_empty_or_malformed_transport_cannot_admit_runtime_success() {
    let (root, binding) = fixture();
    let make_job = |operation: &str| {
        Arc::new(Job {
            binding: binding.clone(),
            request: request(&binding, operation),
            test_selections: Vec::new(),
            maven_test_projects: None,
            project_context: None,
            cancelled: AtomicBool::new(false),
            sources: Mutex::new(None),
            debugger_source_roots: Mutex::new(None),
            debugger_class_output_roots: Mutex::new(None),
            class_reload: Mutex::new(None),
            application_input: None,
            child: Mutex::new(None),
            test_tool_child: Mutex::new(None),
            test_listener_port: Mutex::new(None),
            snapshot: Mutex::new(Snapshot {
                workspace_id: "one".into(),
                generation: 1,
                session_id: "java-one".into(),
                operation: operation.into(),
                state: "running".into(),
                output: String::new(),
                output_truncated: false,
                exit_code: None,
                profile_path: None,
                test_results: None,
                coverage: None,
                test_jvm_options_error: None,
                test_discovery: None,
                debugger_state: None,
                class_reload: None,
                application_input: None,
                can_debug_failed_tests: false,
                compiler_diagnostics: compiler_diagnostics::Report::default(),
            }),
        })
    };
    let job = make_job("debug");
    for input in [
        b"".as_slice(),
        b"{}\n",
        b"{\"kind\":\"output\",\"text\":\"tool exited zero\"}\n",
        b"{\"kind\":\"state\",\"state\":{}}\n",
    ] {
        assert!(structured_debugger::drain(input, job.clone()).is_err());
        assert!(job.read().unwrap().debugger_state.is_none());
    }
    let frame =
        |status: &str, reason: Option<&str>, stop_id: Option<&str>| {
            serde_json::json!({"kind": "state", "state": {
            "status": status, "reason": reason, "stopId": stop_id,
            "exceptionMode": "none", "selectedThreadId": null, "selectedFrameId": null,
            "threads": [], "frames": [], "variables": [], "variablePage": null,
            "breakpoints": [], "watches": [], "evaluation": null, "threadsTruncated": false,
            "framesTruncated": false, "variablesTruncated": false, "message": null, "error": null
        }}).to_string() + "\n"
        };
    let running = frame("running", None, None);
    let entry = frame("suspended", Some("entry"), Some("stop-1"));
    let terminated = frame("terminated", None, None);
    for operation in ["debug", "attach"] {
        for (transport, valid) in [
            (running.clone() + &terminated, operation == "attach"),
            (entry.clone() + &terminated, true),
            (terminated.clone(), false),
            (running.clone(), false),
            (entry.clone(), false),
        ] {
            assert_eq!(
                structured_debugger::drain(transport.as_bytes(), make_job(operation)).is_ok(),
                valid,
                "{operation}: {transport}"
            );
        }
    }
    let log_job = make_job("debug");
    let logpoint =
        serde_json::json!({"kind": "logpoint", "text": "Main.java:8: value=42"}).to_string() + "\n";
    let transport = entry.clone() + &logpoint + &terminated;
    structured_debugger::drain(transport.as_bytes(), log_job.clone()).unwrap();
    assert!(log_job
        .read()
        .unwrap()
        .output
        .contains("[Logpoint] Main.java:8: value=42\n"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_source_breakpoints_bind_loaded_types_and_refuse_changed_or_ambiguous_sources() {
    use super::super::debugger_sources::{self, BreakpointRequest, Document, SourceRequest};
    const SOURCE: &str = "package pkg;\npublic class Runner {\n public static void main(String[] args) throws Exception {\n  int result = Peer.calculate(7);\n  java.nio.file.Files.writeString(java.nio.file.Path.of(\"source-result.txt\"), \"\" + result);\n }\n}\nclass Peer {\n static int calculate(int base) {\n  int value = base * 6;\n  return value;\n }\n}\n";
    for ambiguous in [false, true] {
        let (root, binding) = fixture();
        let source_path = "src/main/java/pkg/Runner.java";
        fs::create_dir_all(root.join("src/main/java/pkg")).unwrap();
        fs::write(root.join(source_path), SOURCE).unwrap();
        if ambiguous {
            fs::create_dir_all(root.join("src/test/java/pkg")).unwrap();
            fs::write(
                root.join("src/test/java/pkg/Runner.java"),
                "package pkg; class Unrelated {}\n",
            )
            .unwrap();
        }
        let executor = JavaExecutionState::default();
        let mut launch = request(&binding, "debug");
        launch.configuration.debugger_mode = "jdi".into();
        launch.configuration.main_class = "pkg.Runner".into();
        if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
            launch.configuration.jdk_home = home;
        }
        executor.start(binding, launch).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
        let source_request = |state: &structured_debugger::DebugState| SourceRequest {
            workspace_id: job.request.workspace_id.clone(),
            generation: job.request.generation,
            session_id: job.read().unwrap().session_id,
            request_id: "source-proof".into(),
            document: Document {
                path: source_path.into(),
                text: SOURCE.into(),
                version: 1,
            },
            stop_id: state.stop_id.clone(),
            frame_id: state.selected_frame_id.clone(),
        };
        assert!(debugger_sources::inspect(&job, &source_request(&entry)).is_ok());
        debugger_sources::toggle(
            &job,
            &BreakpointRequest {
                source: source_request(&entry),
                line: 10,
                condition: String::new(),
                hit_count: 0,
                log_message: String::new(),
            },
        )
        .unwrap();
        debug_state(&job, |state| state.breakpoints.len() == 1);
        if ambiguous {
            structured_debugger::send(
                &job,
                &Action::SetBreakpoint {
                    class_name: "pkg.Peer".into(),
                    line: 10,
                    condition: String::new(),
                    hit_count: 0,
                    log_message: String::new(),
                },
            )
            .unwrap();
            debug_state(&job, |state| state.breakpoints.len() == 2);
        }
        structured_debugger::send(
            &job,
            &Action::Continue {
                stop_id: stop_id(&entry),
            },
        )
        .unwrap();
        let stopped = at_line(&job, 10);
        assert_eq!(stopped.frames[0].class_name, "pkg.Peer");
        assert!(debugger_sources::inspect(&job, &source_request(&entry)).is_err());
        if ambiguous {
            assert!(!stopped.breakpoints[0].verified);
            assert!(stopped.breakpoints[0]
                .message
                .as_deref()
                .unwrap()
                .contains("ambiguous"));
            assert!(debugger_sources::inspect(&job, &source_request(&stopped))
                .err()
                .unwrap()
                .contains("ambiguous"));
            structured_debugger::send(
                &job,
                &Action::ClearBreakpoint {
                    class_name: "pkg.Peer".into(),
                    line: 10,
                },
            )
            .unwrap();
            debug_state(&job, |state| state.breakpoints.len() == 1);
        } else {
            let view = serde_json::to_value(
                debugger_sources::inspect(&job, &source_request(&stopped)).unwrap(),
            )
            .unwrap();
            assert_eq!(view["executionLine"], 10);
            assert_eq!(view["sourcePath"], source_path);
            assert_eq!(view["breakpoints"][0]["verified"], true);
            let mut dirty = source_request(&stopped);
            dirty.document.text.push_str("// unsaved draft\n");
            assert!(debugger_sources::inspect(&job, &dirty)
                .err()
                .unwrap()
                .contains("Source changed"));
            assert!(debugger_sources::toggle(
                &job,
                &BreakpointRequest {
                    source: dirty,
                    line: 10,
                    condition: String::new(),
                    hit_count: 0,
                    log_message: String::new(),
                }
            )
            .is_err());
            let changed = format!("{SOURCE}// external saved change\n");
            fs::write(root.join(source_path), &changed).unwrap();
            assert!(debugger_sources::inspect(&job, &source_request(&stopped)).is_err());
            assert_eq!(fs::read_to_string(root.join(source_path)).unwrap(), changed);
            fs::write(root.join(source_path), SOURCE).unwrap();
            debugger_sources::toggle(
                &job,
                &BreakpointRequest {
                    source: source_request(&stopped),
                    line: 10,
                    condition: String::new(),
                    hit_count: 0,
                    log_message: String::new(),
                },
            )
            .unwrap();
            debug_state(&job, |state| state.breakpoints.is_empty());
        }
        structured_debugger::send(
            &job,
            &Action::Continue {
                stop_id: stop_id(&stopped),
            },
        )
        .unwrap();
        wait_for(&job, |snapshot| snapshot.state == "succeeded");
        assert_eq!(
            fs::read_to_string(root.join("source-result.txt")).unwrap(),
            "42"
        );
        assert_eq!(fs::read_to_string(root.join(source_path)).unwrap(), SOURCE);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_run_to_cursor_uses_and_removes_a_temporary_source_breakpoint() {
    use super::super::debugger_sources::{
        self, BreakpointRequest, Document, RunToCursorRequest, SourceRequest,
    };
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), MAIN).unwrap();
    let executor = JavaExecutionState::default();
    let mut launch = request(&binding, "debug");
    launch.configuration.debugger_mode = "jdi".into();
    if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
        launch.configuration.jdk_home = home;
    }
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
    let request_for = |state: &structured_debugger::DebugState| SourceRequest {
        workspace_id: job.request.workspace_id.clone(),
        generation: job.request.generation,
        session_id: job.read().unwrap().session_id,
        request_id: "run-to-cursor-proof".into(),
        document: Document {
            path: "Main.java".into(),
            text: MAIN.into(),
            version: 1,
        },
        stop_id: state.stop_id.clone(),
        frame_id: state.selected_frame_id.clone(),
    };
    let target_line = line("int value = base * 6;");
    debugger_sources::toggle(
        &job,
        &BreakpointRequest {
            source: request_for(&entry),
            line: target_line,
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    debug_state(&job, |state| state.breakpoints.len() == 1);
    let duplicate = debugger_sources::run_to_cursor(
        &job,
        &RunToCursorRequest {
            source: request_for(&entry),
            line: target_line,
        },
    )
    .unwrap_err();
    assert!(duplicate.contains("breakpoint already exists"));
    assert_eq!(
        job.read().unwrap().debugger_state.unwrap().status,
        Status::Suspended
    );
    debugger_sources::toggle(
        &job,
        &BreakpointRequest {
            source: request_for(&entry),
            line: target_line,
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    debug_state(&job, |state| state.breakpoints.is_empty());
    structured_debugger::send(&job, &Action::MuteBreakpoints { muted: true }).unwrap();
    debug_state(&job, |state| state.breakpoints_muted == Some(true));
    debugger_sources::run_to_cursor(
        &job,
        &RunToCursorRequest {
            source: request_for(&entry),
            line: target_line,
        },
    )
    .unwrap();
    let stopped = at_line(&job, target_line);
    assert_eq!(stopped.reason.as_deref(), Some("breakpoint"));
    assert!(
        stopped.breakpoints.is_empty(),
        "temporary breakpoint remained active"
    );
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&stopped),
        },
    )
    .unwrap();
    let completed = wait_for(&job, |snapshot| snapshot.state == "succeeded");
    assert_eq!(completed.exit_code, Some(0), "{}", completed.output);
    assert_eq!(
        fs::read_to_string(root.join("debug-result.txt")).unwrap(),
        "42"
    );
    assert_eq!(fs::read_to_string(root.join("Main.java")).unwrap(), MAIN);
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_frames_variables_array_pages_watches_steps_and_literal_launch_settings() {
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), MAIN).unwrap();
    let executor = JavaExecutionState::default();
    let mut launch = request(&binding, "debug");
    launch.configuration.debugger_mode = "jdi".into();
    let home = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME")
        .map(|home| selected_jdk(&home).unwrap())
        .unwrap_or_else(|_| jdk_home().unwrap().canonicalize().unwrap());
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    launch.configuration.program_arguments =
        vec!["".into(), "literal 🧪 'quote\" and\nline".into()];
    launch.configuration.jvm_options = vec!["-Dide.jdi=literal π property".into()];
    launch.configuration.environment = vec![EnvironmentVariable {
        name: "IDE_JDI_VALUE".into(),
        value: "literal environment".into(),
    }];
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
    assert!(!root.join("debug-pid.txt").exists());
    structured_debugger::send(
        &job,
        &Action::SetBreakpoint {
            class_name: "Main".into(),
            line: line("int result"),
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    debug_state(&job, |state| state.breakpoints.len() == 1);
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&entry),
        },
    )
    .unwrap();
    let stopped = at_line(&job, line("int result"));
    assert_eq!(stopped.reason.as_deref(), Some("breakpoint"));
    assert!(stopped.breakpoints[0].verified);
    let suspended_stop = stop_id(&stopped);
    structured_debugger::send(&job, &Action::ListLoadedClasses).unwrap();
    let with_loaded_classes = debug_state(&job, |state| {
        state
            .loaded_classes
            .iter()
            .any(|item| item.class_name == "Main")
    });
    let main_class = with_loaded_classes
        .loaded_classes
        .iter()
        .find(|item| item.class_name == "Main")
        .unwrap();
    assert_eq!(main_class.class_loader_count, 1);
    assert_eq!(
        with_loaded_classes.stop_id.as_deref(),
        Some(suspended_stop.as_str())
    );
    assert_eq!(with_loaded_classes.status, Status::Suspended);
    assert!(stopped
        .variables
        .iter()
        .any(|variable| variable.name == "base" && variable.value == "7"));
    assert_eq!(
        stopped
            .variables
            .iter()
            .find(|variable| variable.name == "literal")
            .unwrap()
            .value,
        "\"π🧪\\u0000line\\u000a\""
    );
    // These installed JDKs replace the isolated surrogate in the JDI UTF-8 string value.
    assert_eq!(
        stopped
            .variables
            .iter()
            .find(|variable| variable.name == "malformed")
            .unwrap()
            .value,
        "\"�\""
    );
    assert!(stopped
        .threads
        .iter()
        .any(|thread| thread.name == "control\\u0000🧪"));
    assert!(stopped
        .threads
        .iter()
        .any(|thread| thread.name == "main" && thread.suspended));
    assert!(!root.join("debug-result.txt").exists());
    assert_eq!(fs::read_to_string(root.join("debug-settings.txt")).unwrap(),format!("\nliteral 🧪 'quote\" and\nline\nVM=literal π property\nENV=literal environment\nJDK={}",home.display()));
    structured_debugger::send(
        &job,
        &Action::SetLocalValue {
            stop_id: stop_id(&stopped),
            frame_id: stopped.selected_frame_id.clone().unwrap(),
            assignment: "literal = \"updated\"".into(),
        },
    )
    .unwrap();
    let stopped = debug_state(&job, |state| {
        state
            .message
            .as_deref()
            .is_some_and(|message| message.starts_with("Set local variable"))
            && state.variables.iter().any(|variable| {
                variable.name == "literal"
                    && variable.r#type == "java.lang.String"
                    && variable.value == "\"updated\""
            })
    });
    for (assignment, name, kind, expected) in [
        ("widened = base", "widened", "long", "7"),
        ("widened = boxed", "widened", "long", "6"),
        ("widened = letter", "widened", "long", "65535"),
        ("small = narrow", "small", "short", "2"),
        ("narrow = narrow", "narrow", "byte", "2"),
        ("small = small", "small", "short", "2"),
        ("rounded = 16777217L", "rounded", "float", "1.6777216E7"),
        ("widenedFloat = rounded", "widenedFloat", "double", "1.6777216E7"),
        ("flag = boxedFlag", "flag", "boolean", "true"),
    ] {
        structured_debugger::send(
            &job,
            &Action::SetLocalValue {
                stop_id: stop_id(&stopped),
                frame_id: stopped.selected_frame_id.clone().unwrap(),
                assignment: assignment.into(),
            },
        )
        .unwrap();
        let message = format!("Set local variable `{name}` in the selected frame.");
        let updated = debug_state(&job, |state| {
            state.error.is_some()
                || (state.message.as_deref() == Some(message.as_str())
                    && state.variables.iter().any(|variable| {
                        variable.name == name && variable.r#type == kind && variable.value == expected
                    }))
        });
        assert!(updated.error.is_none(), "{assignment}: {:?}", updated.error);
    }
    for (assignment, error, name, expected) in [
        ("narrow = base", "type `byte`", "narrow", "2"),
        ("small = letter", "type `short`", "small", "2"),
        ("flag = base", "type `boolean`", "flag", "true"),
        ("widened = null", "cannot receive null", "widened", "65535"),
    ] {
        structured_debugger::send(
            &job,
            &Action::SetLocalValue {
                stop_id: stop_id(&stopped),
                frame_id: stopped.selected_frame_id.clone().unwrap(),
                assignment: assignment.into(),
            },
        )
        .unwrap();
        let refused = debug_state(&job, |state| {
            state.error.as_deref().is_some_and(|message| message.contains(error))
        });
        assert!(
            refused
                .variables
                .iter()
                .any(|variable| variable.name == name && variable.value == expected),
            "{assignment}"
        );
    }
    let holder = stopped
        .variables
        .iter()
        .find(|variable| variable.name == "holder")
        .unwrap();
    structured_debugger::send(
        &job,
        &Action::Variables {
            stop_id: stop_id(&stopped),
            reference: holder.reference.clone().unwrap(),
            start: 0,
        },
    )
    .unwrap();
    debug_state(&job, |state| {
        state.variable_page.as_ref().is_some_and(|page| {
            page.variables
                .iter()
                .any(|value| value.name == "Main$Holder.number" && value.value == "7")
        })
    });
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&stopped),
            expression: "holder.values".into(),
        },
    )
    .unwrap();
    let watched = debug_state(&job, |state| {
        state
            .watches
            .iter()
            .any(|watch| watch.expression == "holder.values")
    });
    let array = watched
        .watches
        .iter()
        .find(|watch| watch.expression == "holder.values")
        .unwrap()
        .variable
        .as_ref()
        .unwrap();
    assert_eq!(array.child_count, 44);
    let array_reference = array.reference.clone().unwrap();
    structured_debugger::send(
        &job,
        &Action::Variables {
            stop_id: stop_id(&stopped),
            reference: array_reference.clone(),
            start: 0,
        },
    )
    .unwrap();
    let page = debug_state(&job, |state| {
        state
            .variable_page
            .as_ref()
            .is_some_and(|page| page.reference == array_reference && page.start == 0)
    });
    assert_eq!(page.variable_page.unwrap().variables.len(), 32);
    structured_debugger::send(
        &job,
        &Action::Variables {
            stop_id: stop_id(&stopped),
            reference: array_reference,
            start: 32,
        },
    )
    .unwrap();
    let page = debug_state(&job, |state| {
        state
            .variable_page
            .as_ref()
            .is_some_and(|page| page.start == 32)
    });
    assert_eq!(page.variable_page.as_ref().unwrap().variables.len(), 12);
    assert_eq!(page.variable_page.unwrap().variables[1].value, "33");
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&stopped),
            expression: "holder.number + holder.values[33] * 2".into(),
        },
    )
    .unwrap();
    let calculated = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "holder.number + holder.values[33] * 2"
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "73")
        })
    });
    assert!(calculated.error.is_none(), "{:?}", calculated.error);
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&calculated),
            expression: "holder.number + holder.values[base + 26] * 2".into(),
        },
    )
    .unwrap();
    let computed_index = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "holder.number + holder.values[base + 26] * 2"
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "73")
        })
    });
    assert!(computed_index.error.is_none(), "{:?}", computed_index.error);
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&computed_index),
            expression: "holder.number & 5".into(),
        },
    )
    .unwrap();
    let bitwise = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "holder.number & 5"
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "5")
        })
    });
    assert!(bitwise.error.is_none(), "{:?}", bitwise.error);
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&bitwise),
            expression: "holder.number << 2".into(),
        },
    )
    .unwrap();
    let shifted = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "holder.number << 2"
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "28")
        })
    });
    assert!(shifted.error.is_none(), "{:?}", shifted.error);
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&shifted),
            expression: "Main.Holder.staticNumber".into(),
        },
    )
    .unwrap();
    let static_field = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "Main.Holder.staticNumber"
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "11")
        })
    });
    assert!(static_field.error.is_none(), "{:?}", static_field.error);
    let mut static_array_state = static_field;
    for (expression, expected) in [
        ("Main.staticValues[1]", "20"),
        ("Main.staticValues[base - 6]", "20"),
        ("Main.staticValues.length", "3"),
        ("Main.staticHolders[0].number", "7"),
        ("Main.staticHolders[base - 7].number", "7"),
    ] {
        structured_debugger::send(
            &job,
            &Action::Watch {
                stop_id: stop_id(&static_array_state),
                expression: expression.into(),
            },
        )
        .unwrap();
        static_array_state = debug_state(&job, |state| {
            state.watches.iter().any(|watch| {
                watch.expression == expression
                    && watch
                        .variable
                        .as_ref()
                        .is_some_and(|value| value.value == expected)
            })
        });
        assert!(
            static_array_state.error.is_none(),
            "{:?}",
            static_array_state.error
        );
    }
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&static_array_state),
            expression: "!(null instanceof java.lang.String) && holder instanceof Main.Holder && holder instanceof java.lang.Object && !(holder instanceof java.lang.String) && holder.text instanceof java.lang.CharSequence".into(),
        },
    )
    .unwrap();
    let runtime_types = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression.contains("holder instanceof")
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "true")
        })
    });
    assert!(runtime_types.error.is_none(), "{:?}", runtime_types.error);
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&runtime_types),
            expression: "holder.text + \":\" + holder.marker + holder.number".into(),
        },
    )
    .unwrap();
    let string_watch = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "holder.text + \":\" + holder.marker + holder.number"
                && watch.variable.as_ref().is_some_and(|value| {
                    value.r#type == "java.lang.String" && value.value == "\"ready:!7\""
                })
        })
    });
    assert!(string_watch.error.is_none(), "{:?}", string_watch.error);
    let persistent_watch_expressions: Vec<_> = string_watch
        .watches
        .iter()
        .map(|watch| watch.expression.clone())
        .collect();
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&calculated),
            expression: "holder.number * 6".into(),
        },
    )
    .unwrap();
    let evaluated = debug_state(&job, |state| {
        state.evaluation.as_ref().is_some_and(|value| {
            value.expression == "holder.number * 6"
                && value
                    .variable
                    .as_ref()
                    .is_some_and(|variable| variable.value == "42")
        })
    });
    assert_eq!(
        evaluated.evaluation.as_ref().unwrap().frame_id,
        evaluated.selected_frame_id.as_ref().unwrap().as_str()
    );
    assert_eq!(
        evaluated.stop_id.as_ref().unwrap(),
        &evaluated.evaluation.as_ref().unwrap().stop_id
    );
    assert_eq!(
        evaluated
            .watches
            .iter()
            .map(|watch| watch.expression.clone())
            .collect::<Vec<_>>(),
        persistent_watch_expressions
    );
    assert!(evaluated.error.is_none(), "{:?}", evaluated.error);
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&evaluated),
            expression: "(byte) holder.number".into(),
        },
    )
    .unwrap();
    let casted = debug_state(&job, |state| {
        state.evaluation.as_ref().is_some_and(|value| {
            value.expression == "(byte) holder.number"
                && value
                    .variable
                    .as_ref()
                    .is_some_and(|variable| variable.r#type == "byte" && variable.value == "7")
        })
    });
    assert!(casted.error.is_none(), "{:?}", casted.error);
    assert_eq!(
        casted
            .watches
            .iter()
            .map(|watch| watch.expression.clone())
            .collect::<Vec<_>>(),
        persistent_watch_expressions
    );
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&casted),
            expression: "holder.text + \":\" + holder.marker + holder.number".into(),
        },
    )
    .unwrap();
    let evaluated_string = debug_state(&job, |state| {
        state.evaluation.as_ref().is_some_and(|value| {
            value.expression == "holder.text + \":\" + holder.marker + holder.number"
                && value.variable.as_ref().is_some_and(|variable| {
                    variable.r#type == "java.lang.String"
                        && variable.value == "\"ready:!7\""
                        && variable.reference.is_none()
                })
        })
    });
    assert!(
        evaluated_string.error.is_none(),
        "{:?}",
        evaluated_string.error
    );
    let mut string_method_state = evaluated_string;
    for (expression, expected_type, expected_value) in [
        ("Main.staticValues instanceof int[]", "boolean", "true"),
        ("Main.staticValues instanceof java.lang.Object[]", "boolean", "false"),
        ("Main.staticHolders instanceof Main.Holder[]", "boolean", "true"),
        ("Main.staticHolders instanceof java.lang.Object[]", "boolean", "true"),
        ("Main.staticSequences instanceof java.lang.Object[]", "boolean", "true"),
        ("Main.staticMatrix instanceof int[][]", "boolean", "true"),
        ("Main.staticMatrix instanceof java.lang.Object[]", "boolean", "true"),
        ("Main.staticObjects instanceof Main.Holder[]", "boolean", "false"),
        ("null instanceof int[]", "boolean", "false"),
        ("Main.staticHolders[base - 7].number", "int", "7"),
        ("Main.staticHolders[base - 7].values.length", "int", "44"),
        ("Main.staticHolders[base - 7].text.length()", "int", "5"),
        ("(holder).values[base - 7]", "int", "0"),
        ("holder.text.length()", "int", "5"),
        ("holder.text.isEmpty()", "boolean", "false"),
        ("holder.text.charAt(1) == 'e'", "boolean", "true"),
        ("holder.text.substring(1, 4)", "java.lang.String", "\"ead\""),
        ("holder.text.substring(1)", "java.lang.String", "\"eady\""),
        ("holder.text.equals(\"ready\")", "boolean", "true"),
        ("holder.text.equalsIgnoreCase(\"READY\")", "boolean", "true"),
        ("holder.text.startsWith(\"rea\")", "boolean", "true"),
        ("holder.text.startsWith(\"ady\", 2)", "boolean", "true"),
        ("holder.text.endsWith(\"dy\")", "boolean", "true"),
        ("holder.text.contains(\"ead\")", "boolean", "true"),
        ("holder.text.indexOf(\"a\")", "int", "2"),
        ("holder.text.indexOf(97)", "int", "2"),
        ("holder.text.indexOf('e')", "int", "1"),
        ("holder.text.indexOf('d', 2)", "int", "3"),
        ("holder.text.indexOf(\"ready\", 1)", "int", "-1"),
        ("holder.text.lastIndexOf(\"e\")", "int", "1"),
        ("holder.text.lastIndexOf(97, 1)", "int", "-1"),
        ("holder.text.lastIndexOf('e', 2)", "int", "1"),
        ("holder.text.lastIndexOf(\"ad\", 1)", "int", "-1"),
        ("holder.marker == '!' ? \"(\" : \")\"", "java.lang.String", "\"(\""),
        ("holder.text.indexOf(\")\")", "int", "-1"),
        ("\"!\".length()", "int", "1"),
        ("(holder.text + \"!\").charAt(5) == '!'", "boolean", "true"),
        ("holder.text.substring(1).substring(0, 2)", "java.lang.String", "\"ea\""),
    ] {
        structured_debugger::send(
            &job,
            &Action::Evaluate {
                stop_id: stop_id(&string_method_state),
                expression: expression.into(),
            },
        )
        .unwrap();
        string_method_state = debug_state(&job, |state| {
            state
                .evaluation
                .as_ref()
                .is_some_and(|value| value.expression == expression)
        });
        let evaluation = string_method_state.evaluation.as_ref().unwrap();
        assert!(
            evaluation.error.is_none(),
            "{expression}: {:?}",
            evaluation.error
        );
        let variable = evaluation.variable.as_ref().unwrap();
        assert_eq!(variable.r#type, expected_type, "{expression}");
        assert_eq!(variable.value, expected_value, "{expression}");
        assert_eq!(evaluation.stop_id, stop_id(&string_method_state));
        assert_eq!(
            evaluation.frame_id,
            string_method_state.selected_frame_id.clone().unwrap()
        );
        assert_eq!(
            string_method_state
                .watches
                .iter()
                .map(|watch| watch.expression.clone())
                .collect::<Vec<_>>(),
            persistent_watch_expressions
        );
    }
    let mut conditional_expression_state = string_method_state;
    for (expression, expected) in [
        (
            "holder.number > 5 ? holder.text.length() : holder.values[44]",
            "5",
        ),
        (
            "holder.number < 5 ? holder.values[44] : holder.text.length()",
            "5",
        ),
        ("true ? false ? 1 : 2 : 3", "2"),
        ("false ? 1 : true ? 2 : 3", "2"),
        ("true || holder.number < 0 ? 1 : 0", "1"),
    ] {
        structured_debugger::send(
            &job,
            &Action::Evaluate {
                stop_id: stop_id(&conditional_expression_state),
                expression: expression.into(),
            },
        )
        .unwrap();
        conditional_expression_state = debug_state(&job, |state| {
            state
                .evaluation
                .as_ref()
                .is_some_and(|value| value.expression == expression)
        });
        let evaluation = conditional_expression_state.evaluation.as_ref().unwrap();
        assert!(
            evaluation.error.is_none(),
            "{expression}: {:?}",
            evaluation.error
        );
        assert_eq!(
            evaluation.variable.as_ref().unwrap().r#type,
            "int",
            "{expression}"
        );
        assert_eq!(
            evaluation.variable.as_ref().unwrap().value,
            expected,
            "{expression}"
        );
        assert_eq!(evaluation.stop_id, stop_id(&conditional_expression_state));
        assert_eq!(
            conditional_expression_state
                .watches
                .iter()
                .map(|watch| watch.expression.clone())
                .collect::<Vec<_>>(),
            persistent_watch_expressions
        );
    }
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&conditional_expression_state),
            expression: "Main.staticHolders[base - 7].toString()".into(),
        },
    )
    .unwrap();
    let refused_evaluation = debug_state(&job, |state| {
        state.evaluation.as_ref().is_some_and(|value| {
            value.expression == "Main.staticHolders[base - 7].toString()"
                && value.error.as_deref().is_some_and(|error| {
                    error.contains("Method calls and assignments are unavailable")
                })
        })
    });
    assert!(
        refused_evaluation.error.is_none(),
        "{:?}",
        refused_evaluation.error
    );
    assert_eq!(
        refused_evaluation
            .watches
            .iter()
            .map(|watch| watch.expression.clone())
            .collect::<Vec<_>>(),
        persistent_watch_expressions
    );
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&stopped),
            expression: "holder.number > 3 && holder.values[0] == 0".into(),
        },
    )
    .unwrap();
    let predicate = debug_state(&job, |state| {
        state.watches.iter().any(|watch| {
            watch.expression == "holder.number > 3 && holder.values[0] == 0"
                && watch
                    .variable
                    .as_ref()
                    .is_some_and(|value| value.value == "true")
        })
    });
    assert!(predicate.error.is_none(), "{:?}", predicate.error);
    structured_debugger::send(
        &job,
        &Action::Watch {
            stop_id: stop_id(&stopped),
            expression: "holder.toString()".into(),
        },
    )
    .unwrap();
    debug_state(&job, |state| {
        state
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Method calls and assignments are unavailable"))
    });
    structured_debugger::send(
        &job,
        &Action::Step {
            stop_id: stop_id(&stopped),
            kind: StepKind::Into,
            exclusion_filters: vec![],
        },
    )
    .unwrap();
    let callee = at_line(&job, line("int value ="));
    assert_eq!(callee.frames[0].method_name, "calculate");
    assert!(structured_debugger::send(
        &job,
        &Action::SelectFrame {
            stop_id: stop_id(&stopped),
            frame_id: stopped.frames[0].id.clone()
        }
    )
    .is_err());
    let caller = callee
        .frames
        .iter()
        .find(|frame| frame.method_name == "main")
        .unwrap();
    structured_debugger::send(
        &job,
        &Action::SelectFrame {
            stop_id: stop_id(&callee),
            frame_id: caller.id.clone(),
        },
    )
    .unwrap();
    debug_state(&job, |state| {
        state.selected_frame_id.as_deref() == Some(&caller.id)
            && state
                .variables
                .iter()
                .any(|variable| variable.name == "holder")
    });
    structured_debugger::send(
        &job,
        &Action::SelectFrame {
            stop_id: stop_id(&callee),
            frame_id: callee.frames[0].id.clone(),
        },
    )
    .unwrap();
    debug_state(&job, |state| {
        state.selected_frame_id.as_deref() == Some(&callee.frames[0].id)
    });
    structured_debugger::send(
        &job,
        &Action::Step {
            stop_id: stop_id(&callee),
            kind: StepKind::Over,
            exclusion_filters: vec![],
        },
    )
    .unwrap();
    let returned = at_line(&job, line("return value"));
    assert!(returned
        .variables
        .iter()
        .any(|variable| variable.name == "value" && variable.value == "42"));
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&returned),
            expression: "value = value + 1".into(),
        },
    )
    .unwrap();
    let read_only_assignment = debug_state(&job, |state| {
        state.evaluation.as_ref().is_some_and(|evaluation| {
            evaluation.expression == "value = value + 1"
                && evaluation
                    .error
                    .as_deref()
                    .is_some_and(|error| error.contains("assignments are unavailable"))
        })
    });
    assert!(read_only_assignment
        .variables
        .iter()
        .any(|variable| variable.name == "value" && variable.value == "42"));
    structured_debugger::send(
        &job,
        &Action::SetLocalValue {
            stop_id: stop_id(&read_only_assignment),
            frame_id: read_only_assignment.selected_frame_id.clone().unwrap(),
            assignment: "value = value + 1".into(),
        },
    )
    .unwrap();
    let assigned = debug_state(&job, |state| {
        state
            .message
            .as_deref()
            .is_some_and(|message| message.starts_with("Set local variable"))
            && state
                .variables
                .iter()
                .any(|variable| variable.name == "value" && variable.value == "43")
    });
    assert!(assigned.evaluation.is_none());
    structured_debugger::send(
        &job,
        &Action::SetLocalValue {
            stop_id: stop_id(&assigned),
            frame_id: assigned.selected_frame_id.clone().unwrap(),
            assignment: "value = \"not an int\"".into(),
        },
    )
    .unwrap();
    let refused_type_write = debug_state(&job, |state| {
        state
            .error
            .as_deref()
            .is_some_and(|error| error.contains("primitive assignment"))
    });
    assert!(refused_type_write
        .variables
        .iter()
        .any(|variable| variable.name == "value" && variable.value == "43"));
    structured_debugger::send(
        &job,
        &Action::SetLocalValue {
            stop_id: stop_id(&refused_type_write),
            frame_id: refused_type_write.selected_frame_id.clone().unwrap(),
            assignment: "holder.number = 99".into(),
        },
    )
    .unwrap();
    let refused_field_write = debug_state(&job, |state| {
        state
            .error
            .as_deref()
            .is_some_and(|error| error.contains("one visible local variable"))
    });
    assert!(refused_field_write
        .variables
        .iter()
        .any(|variable| variable.name == "value" && variable.value == "43"));
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&refused_field_write),
            expression: "holder.number".into(),
        },
    )
    .unwrap();
    let field_unchanged = debug_state(&job, |state| {
        state.evaluation.as_ref().is_some_and(|evaluation| {
            evaluation.expression == "holder.number"
                && evaluation
                    .variable
                    .as_ref()
                    .is_some_and(|variable| variable.value == "7")
        })
    });
    structured_debugger::send(
        &job,
        &Action::Step {
            stop_id: stop_id(&field_unchanged),
            kind: StepKind::Out,
            exclusion_filters: vec![],
        },
    )
    .unwrap();
    let caller = at_line(&job, line("int result"));
    structured_debugger::send(
        &job,
        &Action::Step {
            stop_id: stop_id(&caller),
            kind: StepKind::Over,
            exclusion_filters: vec![],
        },
    )
    .unwrap();
    let completed = at_line(&job, line("Path.of(\"debug-result"));
    assert!(completed
        .variables
        .iter()
        .any(|variable| variable.name == "result" && variable.value == "43"));
    super::super::debugger_sources::toggle(
        &job,
        &super::super::debugger_sources::BreakpointRequest {
            source: super::super::debugger_sources::SourceRequest {
                workspace_id: job.request.workspace_id.clone(),
                generation: job.request.generation,
                session_id: job.read().unwrap().session_id,
                request_id: "clear-class-from-source".into(),
                document: super::super::debugger_sources::Document {
                    path: "Main.java".into(),
                    text: MAIN.into(),
                    version: 1,
                },
                stop_id: completed.stop_id.clone(),
                frame_id: completed.selected_frame_id.clone(),
            },
            line: line("int result"),
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    debug_state(&job, |state| state.breakpoints.is_empty());
    debug_state(&job, |state| state.breakpoints.is_empty());
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&completed),
        },
    )
    .unwrap();
    let finished = wait_for(&job, |snapshot| {
        snapshot.state == "succeeded" || snapshot.state == "failed"
    });
    assert_eq!(finished.state, "succeeded", "{}", finished.output);
    assert!(finished
        .output
        .contains(&format!("{}🧪\n", "x".repeat(2047))));
    assert_eq!(finished.debugger_state.unwrap().status, Status::Terminated);
    assert_eq!(
        fs::read_to_string(root.join("debug-result.txt")).unwrap(),
        "43"
    );
    assert_eq!(fs::read_to_string(root.join("Main.java")).unwrap(), MAIN);
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_uncaught_exception_pause_and_stop_revoke_runtime_references() {
    for exception in [true, false] {
        let (root, binding) = fixture();
        let body = if exception {
            "throw new IllegalStateException(\"JDI exception fixture\");"
        } else {
            "while (true) Thread.sleep(1000);"
        };
        fs::write(root.join("Main.java"),format!("public class Main {{ public static void main(String[] args) throws Exception {{ java.nio.file.Files.writeString(java.nio.file.Path.of(\"debug-pid.txt\"), \"\" + ProcessHandle.current().pid()); {body} }} }}")).unwrap();
        let executor = JavaExecutionState::default();
        let mut launch = request(&binding, "debug");
        launch.configuration.debugger_mode = "jdi".into();
        if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
            launch.configuration.jdk_home = home;
        }
        executor.start(binding, launch).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
        if exception {
            structured_debugger::send(
                &job,
                &Action::Exceptions {
                    mode: ExceptionMode::Uncaught,
                    class_name: String::new(),
                    include_subclasses: true,
                },
            )
            .unwrap();
        }
        structured_debugger::send(
            &job,
            &Action::Continue {
                stop_id: stop_id(&entry),
            },
        )
        .unwrap();
        let stopped = if exception {
            debug_state(&job, |state| {
                state.reason.as_deref() == Some("exception")
                    && state
                        .message
                        .as_deref()
                        .is_some_and(|message| message.contains("IllegalStateException"))
            })
        } else {
            wait_for(&job, |snapshot| {
                snapshot
                    .debugger_state
                    .as_ref()
                    .is_some_and(|state| state.status == Status::Running)
                    && root.join("debug-pid.txt").exists()
            });
            structured_debugger::send(&job, &Action::Pause).unwrap();
            debug_state(&job, |state| state.reason.as_deref() == Some("pause"))
        };
        assert!(!stopped.frames.is_empty());
        let pid: u32 = fs::read_to_string(root.join("debug-pid.txt"))
            .unwrap()
            .parse()
            .unwrap();
        job.stop();
        let ended = job.read().unwrap();
        assert_eq!(ended.state, "stopped");
        let debugger = ended.debugger_state.unwrap();
        assert_eq!(debugger.status, Status::Terminated);
        assert!(
            debugger.frames.is_empty()
                && debugger.variables.is_empty()
                && debugger.stop_id.is_none()
        );
        assert!(structured_debugger::send(
            &job,
            &Action::Continue {
                stop_id: stop_id(&stopped)
            }
        )
        .is_err());
        for _ in 0..100 {
            if !Path::new(&format!("/proc/{pid}")).exists() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !Path::new(&format!("/proc/{pid}")).exists(),
            "debuggee survived Stop"
        );
        executor.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "Requires a real full JDK, compiler, debugger transport and process ownership"]
fn real_jdi_drop_frame_reenters_with_changed_arguments_preserves_effects_and_retires_stop() {
    let program = r#"public class Main {
  static int calls, finalized;
  static int compute(int value) {
    calls++;
    try {
      int result = value * 6;
      return result;
    } finally { finalized++; }
  }
  static int wrapper(int value) { return compute(value); }
  public static void main(String[] args) throws Exception {
    int result = wrapper(7);
    java.nio.file.Files.writeString(java.nio.file.Path.of("drop-result.txt"), result + ":" + calls + ":" + finalized);
  }
}
"#;
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), program).unwrap();
    let executor = JavaExecutionState::default();
    let mut launch = request(&binding, "debug");
    launch.configuration.debugger_mode = "jdi".into();
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
    assert!(!entry.can_drop_frame);
    let breakpoint = (program
        .lines()
        .position(|line| line.contains("return result;"))
        .unwrap()
        + 1) as u32;
    structured_debugger::send(
        &job,
        &Action::SetBreakpoint {
            class_name: "Main".into(),
            line: breakpoint,
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    debug_state(&job, |state| state.breakpoints.len() == 1);
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&entry),
        },
    )
    .unwrap();
    let first = at_line(&job, breakpoint);
    assert!(first.can_drop_frame);
    let frame = first.selected_frame_id.clone().unwrap();
    structured_debugger::send(
        &job,
        &Action::SetLocalValue {
            stop_id: stop_id(&first),
            frame_id: frame.clone(),
            assignment: "value=8".into(),
        },
    )
    .unwrap();
    debug_state(&job, |state| {
        state
            .variables
            .iter()
            .any(|v| v.name == "value" && v.value == "8")
    });
    structured_debugger::send(
        &job,
        &Action::Evaluate {
            stop_id: stop_id(&first),
            expression: "value".into(),
        },
    )
    .unwrap();
    debug_state(&job, |state| state.evaluation.is_some());
    structured_debugger::send(
        &job,
        &Action::DropFrame {
            stop_id: stop_id(&first),
            frame_id: frame.clone(),
        },
    )
    .unwrap();
    let caller = debug_state(&job, |state| state.reason.as_deref() == Some("frame-drop"));
    assert_ne!(caller.stop_id, first.stop_id);
    assert!(caller.evaluation.is_none());
    assert_eq!(caller.frames[0].method_name, "wrapper");
    assert!(caller.can_drop_frame);
    assert!(caller.frames.iter().all(|f| f.id != frame));
    assert!(structured_debugger::send(
        &job,
        &Action::DropFrame {
            stop_id: stop_id(&first),
            frame_id: frame
        }
    )
    .is_err());
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&caller),
        },
    )
    .unwrap();
    let second = debug_state(&job, |state| {
        state.stop_id != caller.stop_id
            && state
                .frames
                .first()
                .is_some_and(|f| f.line == Some(breakpoint))
    });
    assert_eq!(
        second
            .variables
            .iter()
            .find(|v| v.name == "result")
            .unwrap()
            .value,
        "48"
    );
    let wrapper = second.frames[1].id.clone();
    structured_debugger::send(
        &job,
        &Action::SelectFrame {
            stop_id: stop_id(&second),
            frame_id: wrapper.clone(),
        },
    )
    .unwrap();
    debug_state(&job, |state| {
        state.selected_frame_id.as_deref() == Some(wrapper.as_str())
    });
    structured_debugger::send(
        &job,
        &Action::DropFrame {
            stop_id: stop_id(&second),
            frame_id: wrapper,
        },
    )
    .unwrap();
    let main = debug_state(&job, |state| {
        state.reason.as_deref() == Some("frame-drop") && state.stop_id != second.stop_id
    });
    assert_eq!(main.frames[0].method_name, "main");
    assert!(!main.can_drop_frame);
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&main),
        },
    )
    .unwrap();
    let third = debug_state(&job, |state| {
        state.stop_id != main.stop_id
            && state
                .frames
                .first()
                .is_some_and(|f| f.line == Some(breakpoint))
    });
    structured_debugger::send(
        &job,
        &Action::ClearBreakpoint {
            class_name: "Main".into(),
            line: breakpoint,
        },
    )
    .unwrap();
    debug_state(&job, |state| state.breakpoints.is_empty());
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stop_id(&third),
        },
    )
    .unwrap();
    let completed = wait_for(&job, |snapshot| {
        snapshot.state == "succeeded" || snapshot.state == "failed"
    });
    assert_eq!(completed.state, "succeeded", "{}", completed.output);
    assert_eq!(
        fs::read_to_string(root.join("drop-result.txt")).unwrap(),
        "42:3:1"
    );
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_step_exclusion_filters_skip_matching_classes_but_preserve_breakpoints() {
    const SOURCE: &str = "public class Main {\n  public static void main(String[] args) {\n    int result = Library.calculate(6);\n    System.out.println(result);\n  }\n  static class Library {\n    static int calculate(int base) {\n      int value = base * 7;\n      return value;\n    }\n  }\n}\n";
    for (pattern, breakpoint) in [(None, false), (Some("Main$Library"), false), (Some("Main$*"), false), (Some("*Library"), false), (Some("Main$Library"), true)] {
        let filtered = pattern.is_some();
        let (root, binding) = fixture();
        fs::write(root.join("Main.java"), SOURCE).unwrap();
        let executor = JavaExecutionState::default();
        let mut launch = request(&binding, "debug");
        launch.configuration.debugger_mode = "jdi".into();
        if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
            launch.configuration.jdk_home = selected_jdk(&home).unwrap().to_string_lossy().into_owned();
        }
        executor.start(binding, launch).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
        structured_debugger::send(&job, &Action::SetBreakpoint {
            class_name: "Main".into(), line: 3, condition: String::new(), hit_count: 0, log_message: String::new(),
        }).unwrap();
        debug_state(&job, |state| state.breakpoints.len() == 1);
        if breakpoint {
            structured_debugger::send(&job, &Action::SetBreakpoint {
                class_name: "Main$Library".into(), line: 8, condition: String::new(), hit_count: 0, log_message: String::new(),
            }).unwrap();
            debug_state(&job, |state| state.breakpoints.len() == 2);
        }
        structured_debugger::send(&job, &Action::Continue { stop_id: stop_id(&entry) }).unwrap();
        let call = at_line(&job, 3);
        structured_debugger::send(&job, &Action::Step {
            stop_id: stop_id(&call), kind: StepKind::Into,
            exclusion_filters: pattern.into_iter().map(str::to_string).collect(),
        }).unwrap();
        let stopped = at_line(&job, if filtered && !breakpoint { 4 } else { 8 });
        assert_eq!(stopped.frames[0].class_name, if filtered && !breakpoint { "Main" } else { "Main$Library" });
        assert_eq!(stopped.reason.as_deref(), Some(if breakpoint { "breakpoint" } else { "step" }));
        assert!(stopped.error.is_none(), "{:?}", stopped.error);
        executor.shutdown_all();
        assert_eq!(fs::read_to_string(root.join("Main.java")).unwrap(), SOURCE);
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_oversized_command_is_refused_without_retiring_the_stop_or_transport() {
    const SOURCE: &str = "public class Main {\n  public static void main(String[] args) {\n    int answer = 42;\n    System.out.println(\"ALIVE:\" + answer);\n  }\n}\n";
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), SOURCE).unwrap();
    let executor = JavaExecutionState::default();
    let mut launch = request(&binding, "debug");
    launch.configuration.debugger_mode = "jdi".into();
    if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
        launch.configuration.jdk_home = home;
    }
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
    structured_debugger::send(&job, &Action::SetBreakpoint {
        class_name: "Main".into(), line: 3, condition: String::new(), hit_count: 0, log_message: String::new(),
    }).unwrap();
    debug_state(&job, |state| state.breakpoints.len() == 1);
    structured_debugger::send(&job, &Action::Continue { stop_id: stop_id(&entry) }).unwrap();
    let stopped = at_line(&job, 3);
    let fields_for_size = |size: usize| {
        let mut fields = vec!["step".into(), stop_id(&stopped), "over".into(), "0".into()];
        while fields.join("\0").len() < size {
            let remaining = size - fields.join("\0").len() - 1;
            assert!(remaining > 0);
            fields.push("a".repeat(remaining.min(512)));
        }
        fields
    };
    let oversized = structured_debugger::send_fields(&job, fields_for_size(2305));
    // Always clean up the actual JVM even when replaying the unsafe pre-fix sender.
    let mut resumed = false;
    if oversized.is_err() {
        let unchanged = job.read().unwrap().debugger_state.unwrap();
        assert_eq!(unchanged.stop_id, stopped.stop_id);
        assert_eq!(unchanged.status, Status::Suspended);
        // 2,304 raw bytes encode to exactly 3,072 Base64 bytes: the reader's accepted boundary.
        structured_debugger::send_fields(&job, fields_for_size(2304)).unwrap();
        let stepped = at_line(&job, 4);
        structured_debugger::send(&job, &Action::Continue { stop_id: stop_id(&stepped) }).unwrap();
        let ended = wait_for(&job, |snapshot| snapshot.state == "succeeded" || snapshot.state == "failed");
        resumed = ended.state == "succeeded" && ended.exit_code == Some(0) && ended.output.contains("ALIVE:42");
    }
    executor.shutdown_all();
    assert_eq!(fs::read_to_string(root.join("Main.java")).unwrap(), SOURCE);
    fs::remove_dir_all(root).unwrap();
    assert!(oversized.is_err(), "An encoded command larger than the JDI reader limit reached its input pipe");
    assert!(oversized.unwrap_err().contains("too large"));
    assert!(resumed, "The admitted commands after refusal must still run the JVM to completion");
}

#[test]
#[ignore = "requires a full JDK with JDI and local debugger sockets"]
fn real_jdi_exception_class_filters_match_exact_and_late_loaded_subclasses() {
    const SOURCE: &str = "public class Main {\n  static class Base extends RuntimeException {}\n  static class Child extends Base {}\n  public static void main(String[] args) {\n    try { throw new IllegalStateException(); } catch (RuntimeException ignored) {}\n    try { throw new Child(); } catch (RuntimeException ignored) {}\n    try { throw new Base(); } catch (RuntimeException ignored) {}\n    System.out.println(\"FILTERS:OK\");\n  }\n}\n";
    for (name, subclasses, uncaught, lines) in [
        ("Main$Base", false, false, vec![7]),
        ("Main$Base", true, false, vec![6, 7]),
        ("Main$Child", false, false, vec![6]),
        ("Main$Base", true, true, vec![]),
    ] {
        let (root, binding) = fixture();
        fs::write(root.join("Main.java"), SOURCE).unwrap();
        let executor = JavaExecutionState::default();
        let mut launch = request(&binding, "debug");
        launch.configuration.debugger_mode = "jdi".into();
        if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") { launch.configuration.jdk_home = home; }
        executor.start(binding, launch).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let entry = debug_state(&job, |state| state.reason.as_deref() == Some("entry"));
        structured_debugger::send(&job, &Action::MuteBreakpoints { muted: true }).unwrap();
        debug_state(&job, |state| state.breakpoints_muted == Some(true));
        structured_debugger::send(&job, &Action::Exceptions {
            mode: if uncaught { ExceptionMode::Uncaught } else { ExceptionMode::Caught },
            class_name: name.into(), include_subclasses: subclasses,
        }).unwrap();
        let configured = debug_state(&job, |state| state.exception_class_name == name);
        assert_eq!(configured.stop_id, entry.stop_id);
        assert_eq!(configured.exception_include_subclasses, subclasses);
        structured_debugger::send(&job, &Action::Continue { stop_id: stop_id(&entry) }).unwrap();
        for line in lines {
            let stopped = at_line(&job, line);
            assert_eq!(stopped.reason.as_deref(), Some("exception"));
            assert!(stopped.message.as_ref().unwrap().contains(if line == 6 { "Main$Child" } else { "Main$Base" }));
            structured_debugger::send(&job, &Action::Continue { stop_id: stop_id(&stopped) }).unwrap();
        }
        let ended = wait_for(&job, |snapshot| snapshot.state == "succeeded" || snapshot.state == "failed");
        executor.shutdown_all();
        assert_eq!(fs::read_to_string(root.join("Main.java")).unwrap(), SOURCE);
        fs::remove_dir_all(root).unwrap();
        assert_eq!(ended.exit_code, Some(0));
        assert!(ended.output.contains("FILTERS:OK"));
    }
}
