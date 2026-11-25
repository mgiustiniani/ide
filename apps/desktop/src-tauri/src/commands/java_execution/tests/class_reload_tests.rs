use super::super::{
    class_reload,
    structured_debugger::{Action, DebugState, Status},
};
use super::*;

const PROGRAM: &str = r#"public class Swap {
  static int existing = 7;
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("swap-pid.txt"), "" + ProcessHandle.current().pid());
    var url = java.nio.file.Path.of(".ide/java/classes").toUri().toURL();
    Class<?> first = Class.forName("Duplicate", true, new java.net.URLClassLoader(new java.net.URL[]{url}, null));
    Class<?> second = Class.forName("Duplicate", true, new java.net.URLClassLoader(new java.net.URL[]{url}, null));
    while (true) {
      int value = compute();
      java.nio.file.Files.writeString(java.nio.file.Path.of("swap-result.txt"), value + ":" + existing + ":" + Other.read());
      java.nio.file.Files.writeString(java.nio.file.Path.of("swap-history.txt"), value + ":" + existing + ":" + Other.read() + "\n", java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
      Thread.sleep(75);
    }
  }
  static int compute() {
    return 1;
  }
}
class Other { static int read() { return 9; } }
"#;
fn observe(job: &Arc<Job>, predicate: impl Fn(&DebugState) -> bool) -> DebugState {
    wait_for(job, |snapshot| {
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        snapshot.debugger_state.as_ref().is_some_and(&predicate)
    })
    .debugger_state
    .unwrap()
}
fn classes(job: &Arc<Job>, names: &[&str]) -> class_reload::Request {
    let state = job.read().unwrap().debugger_state.unwrap();
    class_reload::Request {
        workspace_id: job.request.workspace_id.clone(),
        generation: job.request.generation,
        session_id: job.read().unwrap().session_id,
        trusted: true,
        stop_id: state.stop_id,
        classes: names
            .iter()
            .map(|name| class_reload::ClassFile {
                class_name: (*name).into(),
                class_file: format!(".reload-fixture/classes/{name}.class"),
                expected_sha256: None,
            })
            .collect(),
    }
}
fn compile(root: &Path, job: &Arc<Job>, source: &str) {
    let dir = root.join(".reload-fixture");
    fs::create_dir_all(dir.join("classes")).unwrap();
    fs::write(dir.join("Swap.java"), source).unwrap();
    fs::write(
        dir.join("Duplicate.java"),
        "public class Duplicate { public int value() { return 1; } }",
    )
    .unwrap();
    let output = Command::new(
        Path::new(&job.request.configuration.jdk_home)
            .join("bin")
            .join(executable_name("javac")),
    )
    .args(["-g", "-d"])
    .arg(dir.join("classes"))
    .arg(dir.join("Swap.java"))
    .arg(dir.join("Duplicate.java"))
    .output()
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
fn measured(root: &Path, expected: &str, job: &Arc<Job>) {
    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    loop {
        assert_eq!(job.read().unwrap().state, "running");
        if fs::read_to_string(root.join("swap-result.txt")).is_ok_and(|text| text == expected) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Runtime did not report {expected}"
        );
        thread::sleep(Duration::from_millis(20));
    }
}
fn outcome(job: &Arc<Job>, expected: &str) -> class_reload::Outcome {
    let result = wait_for(job, |snapshot| {
        snapshot
            .class_reload
            .as_ref()
            .is_some_and(|result| ["applied", "failed"].contains(&result.status.as_str()))
    })
    .class_reload
    .unwrap();
    assert_eq!(
        result.status, expected,
        "Unexpected class-reload result: {result:?}"
    );
    result
}

#[test]
fn active_build_for_hotswap_blocks_a_second_execution() {
    let (root, binding) = fixture();
    let executor = JavaExecutionState::default();
    let build_request = request(&binding, "build");
    let build = Arc::new(Job {
        binding: binding.clone(),
        request: build_request.clone(),
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
            workspace_id: binding.workspace_id.clone(),
            generation: 1,
            session_id: "java-build-sidecar".into(),
            operation: "build".into(),
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
    });
    *executor.class_reload_build.lock().unwrap() = Some(build);

    let error = match executor.start(binding.clone(), request(&binding, "build")) {
        Err(error) => error,
        Ok(_) => panic!("a second execution started beside an active HotSwap build"),
    };
    assert!(error.contains("build running alongside HotSwap"));
    assert!(executor.job.lock().unwrap().is_none());
    drop(executor);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
fn helper_signal(job: &Arc<Job>, signal: i32) {
    #[cfg(unix)]
    {
        let current = job.child.lock().unwrap();
        let helper = current.as_ref().expect("Actual owned helper process");
        assert_eq!(unsafe { libc::kill(helper.id() as i32, signal) }, 0);
    }
}

#[test]
#[cfg(unix)]
#[ignore = "requires real full JDK, JDI sockets and owned debugger processes"]
fn real_jdi_class_reload_changes_new_calls_retains_old_frames_and_fields_and_refuses_atomic_schema_and_loader_ambiguity(
) {
    let (root, binding) = fixture();
    fs::write(root.join("Swap.java"), PROGRAM).unwrap();
    fs::write(
        root.join("Duplicate.java"),
        "public class Duplicate { public int value() { return 1; } }",
    )
    .unwrap();
    let mut launch = request(&binding, "debug");
    launch.configuration.main_class = "Swap".into();
    launch.configuration.debugger_mode = "jdi".into();
    let executor = JavaExecutionState::default();
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = observe(&job, |state| state.reason.as_deref() == Some("entry"));
    assert!(entry.can_reload_classes);
    let line = (PROGRAM
        .lines()
        .position(|line| line.contains("return 1;"))
        .unwrap()
        + 1) as u32;
    structured_debugger::send(
        &job,
        &Action::SetBreakpoint {
            class_name: "Swap".into(),
            line,
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: entry.stop_id.unwrap(),
        },
    )
    .unwrap();
    let mut stopped = observe(&job, |state| state.reason.as_deref() == Some("breakpoint"));
    assert_eq!(stopped.frames[0].method_name, "compute");
    compile(
        &root,
        &job,
        &PROGRAM
            .replace("return 1;", "return 2;")
            .replace("existing = 7", "existing = 99"),
    );
    let mut selected = classes(&job, &["Swap"]);
    for path in [
        "../Swap.class",
        "/tmp/Swap.class",
        "missing.class",
        "Swap.java",
    ] {
        selected.classes[0].class_file = path.into();
        assert!(class_reload::send(&job, &selected).is_err(), "{path}");
    }
    selected = classes(&job, &["Swap"]);
    #[cfg(unix)]
    {
        let linked = root.join("linked.class");
        std::os::unix::fs::symlink(root.join(&selected.classes[0].class_file), &linked).unwrap();
        selected.classes[0].class_file = "linked.class".into();
        assert!(class_reload::send(&job, &selected).is_err());
        fs::remove_file(linked).unwrap();
        selected = classes(&job, &["Swap"]);
        fs::hard_link(
            root.join(&selected.classes[0].class_file),
            root.join("linked.class"),
        )
        .unwrap();
        assert!(class_reload::send(&job, &selected).is_err());
        fs::remove_file(root.join("linked.class")).unwrap();
    }
    selected.trusted = false;
    assert!(class_reload::send(&job, &selected).is_err());
    selected.trusted = true;
    selected.stop_id = Some("retired-stop".into());
    assert!(class_reload::send(&job, &selected).is_err());
    helper_signal(&job, libc::SIGSTOP);
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stopped.stop_id.clone().unwrap(),
        },
    )
    .unwrap();
    class_reload::send(&job, &classes(&job, &["Swap"])).unwrap();
    assert_eq!(job.read().unwrap().class_reload.unwrap().status, "queued");
    assert!(class_reload::send(&job, &classes(&job, &["Swap"])).is_err());
    helper_signal(&job, libc::SIGCONT);
    assert!(outcome(&job, "failed").error.unwrap().contains("obsolete"));
    stopped = observe(&job, |state| {
        state.status == Status::Suspended && state.stop_id != stopped.stop_id
    });
    assert!(stopped.error.is_none());
    class_reload::send(&job, &classes(&job, &["Swap"])).unwrap();
    assert_eq!(outcome(&job, "applied").classes, ["Swap"]);
    let refreshed = observe(&job, |state| state.stop_id != stopped.stop_id);
    assert_eq!(refreshed.status, Status::Suspended);
    assert!(refreshed.frames[0].obsolete);
    assert!(refreshed.breakpoints.is_empty());
    assert!(structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: stopped.stop_id.unwrap()
        }
    )
    .is_err());
    assert!(job.sources.lock().unwrap().as_ref().unwrap().is_err());
    let previous_calls = fs::read_to_string(root.join("swap-history.txt"))
        .unwrap()
        .lines()
        .count();
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: refreshed.stop_id.unwrap(),
        },
    )
    .unwrap();
    observe(&job, |state| state.status == Status::Running);
    measured(&root, "2:7:9", &job);
    assert_eq!(
        fs::read_to_string(root.join("swap-history.txt"))
            .unwrap()
            .lines()
            .nth(previous_calls),
        Some("1:7:9")
    );
    let original_pid = fs::read_to_string(root.join("swap-pid.txt")).unwrap();
    compile(
        &root,
        &job,
        &PROGRAM
            .replace("return 1;", "return 4;")
            .replace("class Other {", "class Other { static int added;"),
    );
    class_reload::send(&job, &classes(&job, &["Swap", "Other"])).unwrap();
    assert!(outcome(&job, "failed")
        .error
        .unwrap()
        .contains("UnsupportedOperationException"));
    measured(&root, "2:7:9", &job);
    assert!(job.class_reload.lock().unwrap().is_none());
    class_reload::send(&job, &classes(&job, &["Duplicate"])).unwrap();
    assert!(outcome(&job, "failed")
        .error
        .unwrap()
        .contains("not uniquely loaded"));
    compile(&root, &job, &PROGRAM.replace("return 1;", "return 3;"));
    helper_signal(&job, libc::SIGSTOP);
    class_reload::send(&job, &classes(&job, &["Swap"])).unwrap();
    assert_eq!(job.read().unwrap().class_reload.unwrap().status, "queued");
    compile(&root, &job, &PROGRAM.replace("return 1;", "return 4;"));
    helper_signal(&job, libc::SIGCONT);
    outcome(&job, "applied");
    measured(&root, "3:7:9", &job);
    let mut mismatch = classes(&job, &["Swap"]);
    mismatch.classes[0].class_file = ".reload-fixture/classes/Other.class".into();
    assert!(class_reload::send(&job, &mismatch).is_err());
    assert!(job.class_reload.lock().unwrap().is_none());
    measured(&root, "3:7:9", &job);
    assert_eq!(
        fs::read_to_string(root.join("swap-pid.txt")).unwrap(),
        original_pid
    );
    assert_eq!(fs::read_to_string(root.join("Swap.java")).unwrap(), PROGRAM);
    helper_signal(&job, libc::SIGSTOP);
    class_reload::send(&job, &classes(&job, &["Swap"])).unwrap();
    job.stop();
    assert_eq!(job.read().unwrap().state, "stopped");
    assert_eq!(job.read().unwrap().class_reload.unwrap().status, "failed");
    assert!(job.class_reload.lock().unwrap().is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
#[ignore = "requires real full JDK, JDI sockets and owned debugger processes"]
fn real_jdi_build_runs_beside_debugger_and_reloaded_class_executes_without_restart() {
    let (root, binding) = fixture();
    fs::write(root.join("Swap.java"), PROGRAM).unwrap();
    fs::write(
        root.join("Duplicate.java"),
        "public class Duplicate { public int value() { return 1; } }",
    )
    .unwrap();
    let mut launch = request(&binding, "debug");
    launch.configuration.main_class = "Swap".into();
    launch.configuration.debugger_mode = "jdi".into();
    let executor = JavaExecutionState::default();
    executor.start(binding.clone(), launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = observe(&job, |state| state.reason.as_deref() == Some("entry"));
    let line = (PROGRAM
        .lines()
        .position(|line| line.contains("return 1;"))
        .unwrap()
        + 1) as u32;
    structured_debugger::send(
        &job,
        &Action::SetBreakpoint {
            class_name: "Swap".into(),
            line,
            condition: String::new(),
            hit_count: 0,
            log_message: String::new(),
        },
    )
    .unwrap();
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: entry.stop_id.unwrap(),
        },
    )
    .unwrap();
    let stopped = observe(&job, |state| state.reason.as_deref() == Some("breakpoint"));

    structured_debugger::send(&job, &Action::ListLoadedClasses).unwrap();
    observe(&job, |state| {
        state
            .loaded_classes
            .iter()
            .any(|item| item.class_name == "Swap")
    });
    let unchanged =
        super::super::class_changes::compare(&job, super::super::class_changes::capture(&job));
    assert_eq!(unchanged.status, "ready");
    assert!(unchanged.classes.is_empty());
    let replacement = PROGRAM.replace("return 1;", "return 1000;");
    fs::write(root.join("Swap.java"), &replacement).unwrap();
    fs::write(
        root.join("Duplicate.java"),
        "public class Duplicate { public int value() { return 2; } }",
    )
    .unwrap();
    let build = executor
        .build_for_class_reload_at(
            &binding,
            ClassReloadBuildRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: job.read().unwrap().session_id,
                trusted: true,
            },
        )
        .unwrap();
    assert_eq!(build.state, "succeeded", "{}", build.output);
    assert_eq!(build.exit_code, 0, "{}", build.output);
    assert_eq!(
        build.class_changes.status, "ready",
        "{}",
        build.class_changes.message
    );
    assert_eq!(build.class_changes.stop_id, stopped.stop_id);
    assert_eq!(build.class_changes.classes.len(), 1);
    let reviewed = build.class_changes.classes[0].clone();
    assert_eq!(reviewed.class_name, "Swap");
    assert!(reviewed
        .expected_sha256
        .as_ref()
        .is_some_and(|hash| hash.len() == 64));
    assert_eq!(job.read().unwrap().state, "running");
    let class_file = ".ide/java/classes/Swap.class";
    assert!(root.join(class_file).is_file());
    let reviewed_bytes = fs::read(root.join(class_file)).unwrap();
    let mut altered = reviewed_bytes.clone();
    *altered.last_mut().unwrap() ^= 1;
    fs::write(root.join(class_file), altered).unwrap();
    let stale = class_reload::Request {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: job.read().unwrap().session_id,
        trusted: true,
        stop_id: stopped.stop_id.clone(),
        classes: vec![reviewed.clone()],
    };
    assert!(class_reload::send(&job, &stale)
        .unwrap_err()
        .contains("changed after review"));
    assert!(job.read().unwrap().class_reload.is_none());
    fs::write(root.join(class_file), reviewed_bytes).unwrap();

    let current = job.read().unwrap();
    let debugger = current.debugger_state.unwrap();
    assert_eq!(debugger.status, Status::Suspended);
    class_reload::send(
        &job,
        &class_reload::Request {
            workspace_id: current.workspace_id,
            generation: current.generation,
            session_id: current.session_id,
            trusted: true,
            stop_id: debugger.stop_id.clone(),
            classes: vec![reviewed],
        },
    )
    .unwrap();
    assert_eq!(outcome(&job, "applied").classes, ["Swap"]);
    let reloaded = observe(&job, |state| {
        state.status == Status::Suspended && state.stop_id != stopped.stop_id
    });
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: reloaded.stop_id.unwrap(),
        },
    )
    .unwrap();
    observe(&job, |state| state.status == Status::Running);
    measured(&root, "1000:7:9", &job);
    assert_eq!(job.read().unwrap().state, "running");
    assert_eq!(
        fs::read_to_string(root.join("Swap.java")).unwrap(),
        replacement
    );
    assert!(entry.can_reload_classes);
    job.stop();
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
#[ignore = "requires real full JDK, JDI sockets and owned debugger processes"]
fn real_jdi_unicode_loaded_class_build_review_and_hotswap_preserve_binary_identity() {
    let (root, binding) = fixture();
    let name = "café.Étage𐐀";
    let source = "package café;\npublic class Étage𐐀 {\n public static void main(String[] args) throws Exception {\n  while (true) { java.nio.file.Files.writeString(java.nio.file.Path.of(\"unicode-swap.txt\"), Integer.toString(réponse())); Thread.sleep(30); }\n }\n static int réponse() { return 1; }\n}\n";
    let source_path = root.join("Étage𐐀.java");
    fs::write(&source_path, source).unwrap();
    let mut launch = request(&binding, "debug");
    launch.configuration.main_class = name.into();
    launch.configuration.debugger_mode = "jdi".into();
    let executor = JavaExecutionState::default();
    executor.start(binding.clone(), launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = observe(&job, |state| state.reason.as_deref() == Some("entry"));
    structured_debugger::send(
        &job,
        &Action::Continue {
            stop_id: entry.stop_id.unwrap(),
        },
    )
    .unwrap();
    wait_for(&job, |_| {
        fs::read_to_string(root.join("unicode-swap.txt")).is_ok_and(|text| text == "1")
    });
    structured_debugger::send(&job, &Action::Pause).unwrap();
    let paused = observe(&job, |state| state.status == Status::Suspended);
    structured_debugger::send(&job, &Action::ListLoadedClasses).unwrap();
    observe(&job, |state| {
        state
            .loaded_classes
            .iter()
            .any(|item| item.class_name == name)
    });
    fs::write(&source_path, source.replace("return 1;", "return 2;")).unwrap();
    let build = executor
        .build_for_class_reload_at(
            &binding,
            ClassReloadBuildRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: job.read().unwrap().session_id,
                trusted: true,
            },
        )
        .unwrap();
    assert_eq!(build.state, "succeeded", "{}", build.output);
    assert_eq!(
        build.class_changes.status, "ready",
        "{}",
        build.class_changes.message
    );
    assert_eq!(build.class_changes.classes.len(), 1);
    let reviewed = build.class_changes.classes[0].clone();
    assert_eq!(reviewed.class_name, name);
    assert_eq!(reviewed.class_file, ".ide/java/classes/café/Étage𐐀.class");
    assert!(reviewed
        .expected_sha256
        .as_ref()
        .is_some_and(|hash| hash.len() == 64));
    class_reload::send(
        &job,
        &class_reload::Request {
            workspace_id: binding.workspace_id.clone(),
            generation: 1,
            session_id: job.read().unwrap().session_id,
            trusted: true,
            stop_id: paused.stop_id.clone(),
            classes: vec![reviewed],
        },
    )
    .unwrap();
    wait_for(&job, |snapshot| {
        snapshot
            .class_reload
            .as_ref()
            .is_some_and(|result| result.status == "applied")
    });
    let stop = job.read().unwrap().debugger_state.unwrap().stop_id.unwrap();
    structured_debugger::send(&job, &Action::Continue { stop_id: stop }).unwrap();
    wait_for(&job, |_| {
        fs::read_to_string(root.join("unicode-swap.txt")).is_ok_and(|text| text == "2")
    });
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
