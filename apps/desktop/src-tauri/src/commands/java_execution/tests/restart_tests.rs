use super::*;

const PROGRAM: &str = r#"public class Main {
  public static void main(String[] args) throws Exception {
    int value = 1;
    java.nio.file.Files.writeString(java.nio.file.Path.of("restart-pid.txt"), "" + ProcessHandle.current().pid());
    java.nio.file.Files.writeString(java.nio.file.Path.of("restart-settings.txt"), String.join("|", args) + "|" + System.getProperty("restart.literal") + "|" + System.getenv("IDE_RESTART_LITERAL") + "|" + System.getProperty("java.home"));
    System.out.println("RESTART_VALUE:" + value);
    if (!java.nio.file.Files.exists(java.nio.file.Path.of("finish.flag"))) Thread.sleep(300000);
  }
}
"#;
fn restart_request(binding: &CurrentWorkspaceBinding, session_id: &str) -> RestartRequest {
    RestartRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: session_id.into(),
        trusted: true,
        source_breakpoints: vec![],
    }
}
fn assert_process_exited(pid: &str) {
    let path = PathBuf::from(format!("/proc/{pid}"));
    for _ in 0..100 {
        if !path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    assert!(!path.exists(), "old application survived restart");
}
#[test]
#[ignore = "Requires a full JDK, real compilation and owned processes"]
fn real_java_restart_rebuilds_saved_source_preserves_settings_and_waits_for_old_process() {
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), PROGRAM).unwrap();
    let executor = JavaExecutionState::default();
    let mut launch = request(&binding, "run");
    launch.configuration.program_arguments = vec!["literal spaced 🧪".into(), "".into()];
    launch.configuration.jvm_options = vec!["-Drestart.literal=literal property".into()];
    launch.configuration.environment = vec![EnvironmentVariable {
        name: "IDE_RESTART_LITERAL".into(),
        value: "literal environment".into(),
    }];
    let started = executor.start(binding.clone(), launch).unwrap();
    let first = executor.job.lock().unwrap().clone().unwrap();
    wait_for(&first, |s| s.output.contains("RESTART_VALUE:1"));
    let first_pid = fs::read_to_string(root.join("restart-pid.txt")).unwrap();
    let settings = fs::read_to_string(root.join("restart-settings.txt")).unwrap();
    assert!(settings.starts_with("literal spaced 🧪||literal property|literal environment|"));
    let mut untrusted = restart_request(&binding, &started.session_id);
    untrusted.trusted = false;
    assert!(executor.restart(binding.clone(), untrusted).is_err());
    assert!(executor
        .restart(binding.clone(), restart_request(&binding, "stale-session"))
        .is_err());
    assert_eq!(first.read().unwrap().state, "running");
    fs::write(
        root.join("Main.java"),
        PROGRAM.replace("int value = 1;", "int value = 2;"),
    )
    .unwrap();
    let next = executor
        .restart(
            binding.clone(),
            restart_request(&binding, &started.session_id),
        )
        .unwrap();
    assert_ne!(next.session_id, started.session_id);
    assert_process_exited(&first_pid);
    let second = executor.job.lock().unwrap().clone().unwrap();
    wait_for(&second, |s| s.output.contains("RESTART_VALUE:2"));
    let second_pid = fs::read_to_string(root.join("restart-pid.txt")).unwrap();
    assert_ne!(first_pid, second_pid);
    assert_eq!(
        settings,
        fs::read_to_string(root.join("restart-settings.txt")).unwrap()
    );
    // The stale first-session request cannot stop or replace the second application.
    assert!(executor
        .restart(
            binding.clone(),
            restart_request(&binding, &started.session_id)
        )
        .is_err());
    assert_eq!(second.read().unwrap().state, "running");
    fs::write(root.join("finish.flag"), "").unwrap();
    let third = executor
        .restart(binding.clone(), restart_request(&binding, &next.session_id))
        .unwrap();
    assert_process_exited(&second_pid);
    let third_job = executor.job.lock().unwrap().clone().unwrap();
    let completed = wait_for(&third_job, |s| {
        ["succeeded", "failed"].contains(&s.state.as_str())
    });
    assert_eq!(completed.state, "succeeded", "{}", completed.output);
    let fourth = executor
        .restart(
            binding.clone(),
            restart_request(&binding, &third.session_id),
        )
        .unwrap();
    assert_ne!(fourth.session_id, third.session_id);
    let fourth_job = executor.job.lock().unwrap().clone().unwrap();
    let completed = wait_for(&fourth_job, |s| {
        ["succeeded", "failed"].contains(&s.state.as_str())
    });
    assert_eq!(completed.state, "succeeded", "{}", completed.output);
    assert_eq!(
        settings,
        fs::read_to_string(root.join("restart-settings.txt")).unwrap()
    );
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "Requires a full JDK with Flight Recorder and jfr"]
fn real_java_profile_rerun_preserves_first_recording_and_reads_only_current_session() {
    let (root, binding) = fixture();
    let home = selected_jdk("").unwrap();
    assert!(flight_recording::available(&home));
    let source = fs::read_to_string(root.join("Main.java")).unwrap()
        .replace("main(String[] args) {", "main(String[] args) throws Exception {")
        .replace("int value = 42;", "int value = 42; java.nio.file.Files.writeString(java.nio.file.Path.of(\"profile-pid.txt\"), \"\" + ProcessHandle.current().pid());");
    fs::write(root.join("Main.java"), &source).unwrap();
    let executor = JavaExecutionState::default();
    let mut launch = request(&binding, "run");
    launch.profile = true;
    executor.start(binding.clone(), launch).unwrap();
    let first_job = executor.job.lock().unwrap().clone().unwrap();
    let first = wait_for(&first_job, |s| {
        ["succeeded", "failed"].contains(&s.state.as_str())
    });
    assert_eq!(first.state, "succeeded", "{}", first.output);
    let first_path = first.profile_path.as_ref().unwrap();
    let first_bytes = fs::read(root.join(first_path)).unwrap();
    assert!(!first_bytes.is_empty());
    let first_pid = fs::read_to_string(root.join("profile-pid.txt")).unwrap();
    let recording_pid = |file: &str| {
        let printed = Command::new(home.join("bin").join(executable_name("jfr")))
            .args(["print", "--json", "--events", "jdk.JVMInformation"])
            .arg(root.join(file))
            .output()
            .unwrap();
        assert!(
            printed.status.success(),
            "{}",
            String::from_utf8_lossy(&printed.stderr)
        );
        let parsed: serde_json::Value = serde_json::from_slice(&printed.stdout).unwrap();
        parsed["recording"]["events"][0]["values"]["pid"]
            .as_u64()
            .unwrap()
            .to_string()
    };
    assert_eq!(recording_pid(first_path), first_pid);
    let analysis = |session_id: &str| FlightRecordingAnalysisRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: session_id.into(),
        trusted: true,
    };
    let first_summary = executor
        .analyze_flight_recording_at(&binding, &analysis(&first.session_id))
        .unwrap();
    assert_eq!(&first_summary.profile_path, first_path);
    fs::write(
        root.join("Main.java"),
        source.replace("int value = 42;", "int value = 84;"),
    )
    .unwrap();
    executor
        .restart(
            binding.clone(),
            restart_request(&binding, &first.session_id),
        )
        .unwrap();
    let second_job = executor.job.lock().unwrap().clone().unwrap();
    let second = wait_for(&second_job, |s| {
        ["succeeded", "failed"].contains(&s.state.as_str())
    });
    assert_eq!(second.state, "succeeded", "{}", second.output);
    assert!(
        second.output.contains("JAVA_RUN_OK:84"),
        "{}",
        second.output
    );
    let second_path = second.profile_path.as_ref().unwrap();
    assert_ne!(first_path, second_path);
    let second_pid = fs::read_to_string(root.join("profile-pid.txt")).unwrap();
    assert_ne!(first_pid, second_pid);
    assert_eq!(recording_pid(second_path), second_pid);
    assert_eq!(fs::read(root.join(first_path)).unwrap(), first_bytes);
    assert!(executor
        .analyze_flight_recording_at(&binding, &analysis(&first.session_id))
        .is_err());
    let current = executor
        .analyze_flight_recording_at(&binding, &analysis(&second.session_id))
        .unwrap();
    assert_eq!(current.session_id, second.session_id);
    assert_eq!(&current.profile_path, second_path);
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
#[ignore = "Requires a full JDK with JFR, Python 3 and owned processes"]
fn real_java_held_recording_reads_refuse_results_after_session_replacement() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (root, binding) = fixture();
    let home = selected_jdk("").unwrap();
    assert!(flight_recording::available(&home));
    let sdk = root.join(".held-jfr-jdk");
    fs::create_dir_all(sdk.join("bin")).unwrap();
    fs::create_dir_all(sdk.join("lib/jfr")).unwrap();
    let control = sdk.join("jfr-control");
    fs::create_dir_all(&control).unwrap();
    for name in ["java", "javac"] {
        symlink(home.join("bin").join(name), sdk.join("bin").join(name)).unwrap();
    }
    symlink(home.join("release"), sdk.join("release")).unwrap();
    symlink(
        home.join("lib/jfr/profile.jfc"),
        sdk.join("lib/jfr/profile.jfc"),
    )
    .unwrap();
    fs::write(
        sdk.join("bin/jfr"),
        include_str!("../../../../../../../tests/story/fixtures/held-jfr-tool.py"),
    )
    .unwrap();
    fs::set_permissions(sdk.join("bin/jfr"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(
        control.join("config.json"),
        serde_json::to_vec(&serde_json::json!({"realJfr":home.join("bin/jfr")})).unwrap(),
    )
    .unwrap();
    let executor = Arc::new(JavaExecutionState::default());
    let mut launch = request(&binding, "run");
    launch.profile = true;
    launch.configuration.jdk_home = sdk.to_string_lossy().into_owned();
    executor.start(binding.clone(), launch).unwrap();
    let complete = |executor: &JavaExecutionState| {
        let job = executor.job.lock().unwrap().clone().unwrap();
        let result = wait_for(&job, |s| {
            ["succeeded", "failed"].contains(&s.state.as_str())
        });
        assert_eq!(result.state, "succeeded", "{}", result.output);
        result
    };
    for mode in ["summary", "print"] {
        let current = complete(&executor);
        fs::write(control.join("armed"), mode).unwrap();
        let reader = executor.clone();
        let read_binding = binding.clone();
        let old_session = current.session_id.clone();
        let task = thread::spawn(move || {
            if mode == "summary" {
                reader
                    .analyze_flight_recording_at(
                        &read_binding,
                        &FlightRecordingAnalysisRequest {
                            workspace_id: read_binding.workspace_id.clone(),
                            generation: 1,
                            session_id: old_session,
                            trusted: true,
                        },
                    )
                    .map(|_| ())
            } else {
                reader
                    .read_flight_recording_timeline_at(
                        &read_binding,
                        &FlightRecordingTimelineRequest {
                            workspace_id: read_binding.workspace_id.clone(),
                            generation: 1,
                            session_id: old_session,
                            trusted: true,
                            event_type: "jdk.JVMInformation".into(),
                        },
                    )
                    .map(|_| ())
            }
        });
        let ready = control.join(format!("{mode}.ready"));
        let until = std::time::Instant::now() + Duration::from_secs(3);
        while !ready.exists() && std::time::Instant::now() < until && !task.is_finished() {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            ready.exists() && !task.is_finished(),
            "real JFR read did not reach its gate"
        );
        executor
            .restart(
                binding.clone(),
                restart_request(&binding, &current.session_id),
            )
            .unwrap();
        let next = complete(&executor);
        assert_ne!(next.session_id, current.session_id);
        assert!(
            !task.is_finished(),
            "the old JFR read must remain held across replacement"
        );
        fs::write(control.join(format!("{mode}.release")), "release").unwrap();
        let error = task.join().unwrap().unwrap_err();
        assert!(error.contains("Java session changed"), "{error}");
        assert_eq!(
            fs::read_to_string(control.join(format!("{mode}.finished"))).unwrap(),
            "0"
        );
    }
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
