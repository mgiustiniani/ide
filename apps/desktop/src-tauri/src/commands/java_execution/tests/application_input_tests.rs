use super::*;
use base64::Engine;

const MAIN: &str = r#"import java.io.ByteArrayOutputStream;
import java.util.Base64;
public class Main {
 public static void main(String[] args) throws Exception {
  System.out.println("APP_INPUT_READY");
  ByteArrayOutputStream received = new ByteArrayOutputStream();
  byte[] buffer = new byte[4096];
  int count;
  while ((count = System.in.read(buffer)) != -1) received.write(buffer, 0, count);
  System.out.println("APP_INPUT_BYTES:" + Base64.getEncoder().encodeToString(received.toByteArray()));
 }
}
"#;

fn prepare(kind: &str) -> (PathBuf, CurrentWorkspaceBinding) {
    let (root, binding) = fixture();
    fs::write(root.join("Main.java"), MAIN).unwrap();
    if kind != "jdk" {
        fs::create_dir_all(root.join("src/main/java")).unwrap();
        fs::rename(root.join("Main.java"), root.join("src/main/java/Main.java")).unwrap();
    }
    if kind == "maven" {
        fs::write(root.join("pom.xml"), r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>input</artifactId><version>1</version><properties><maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin></plugins></build></project>"#).unwrap();
    } else if kind == "gradle" {
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name = 'input-fixture'\n",
        )
        .unwrap();
        fs::write(
            root.join("build.gradle"),
            "plugins { id 'application' }\napplication { mainClass = 'Main' }\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
        #[cfg(unix)]
        if let Some(executable) = std::env::var_os("IDE_GRADLE_TEST_EXECUTABLE") {
            use std::os::unix::fs::PermissionsExt;
            let executable = PathBuf::from(executable).canonicalize().unwrap();
            let quoted = executable.to_string_lossy().replace('\'', "'\\''");
            fs::write(
                root.join("gradlew"),
                format!("#!/bin/sh\nexec '{quoted}' --offline --no-daemon \"$@\"\n"),
            )
            .unwrap();
            fs::set_permissions(root.join("gradlew"), fs::Permissions::from_mode(0o700)).unwrap();
        }
    }
    (root, binding)
}

fn input_request(
    binding: &CurrentWorkspaceBinding,
    session_id: &str,
    sequence: u64,
    bytes: Option<&[u8]>,
) -> ApplicationInputRequest {
    ApplicationInputRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: session_id.into(),
        sequence,
        data_base64: bytes.map(|value| base64::engine::general_purpose::STANDARD.encode(value)),
    }
}

fn run(kind: &str, mode: &str) {
    run_with_profile(kind, mode, false);
}

fn run_with_profile(kind: &str, mode: &str, profile: bool) {
    let (root, binding) = prepare(kind);
    let mut launch = request(&binding, if mode == "run" { "run" } else { "debug" });
    launch.configuration.build_tool = kind.into();
    launch.configuration.application_input = true;
    launch.profile = profile;
    launch.configuration.debugger_mode = if mode == "jdi" { "jdi" } else { "jdb" }.into();
    let state = JavaExecutionState::default();
    let started = state.start(binding.clone(), launch).unwrap();
    assert_eq!(started.application_input.unwrap().state, "waiting");
    let job = state.job.lock().unwrap().clone().unwrap();
    if mode == "jdi" {
        let paused = wait_for(&job, |snapshot| {
            snapshot.state == "failed"
                || snapshot
                    .debugger_state
                    .as_ref()
                    .is_some_and(|debugger| debugger.reason.as_deref() == Some("entry"))
        });
        assert_ne!(paused.state, "failed", "{}", paused.output);
        structured_debugger::send(
            &job,
            &structured_debugger::Action::Continue {
                stop_id: paused.debugger_state.unwrap().stop_id.unwrap(),
            },
        )
        .unwrap();
    } else if mode == "jdb" {
        let paused = wait_for(&job, |snapshot| {
            snapshot.state == "failed" || snapshot.output.contains("main[1]")
        });
        assert_ne!(paused.state, "failed", "{}", paused.output);
        let mut current = job.child.lock().unwrap();
        debugger_input::send(current.as_mut().unwrap().stdin.as_mut().unwrap(), "cont").unwrap();
    }
    let ready = wait_for(&job, |snapshot| {
        snapshot.state == "failed" || snapshot.output.contains("APP_INPUT_READY")
    });
    assert_ne!(ready.state, "failed", "{}", ready.output);
    assert_eq!(ready.application_input.unwrap().state, "open");
    let text = format!(
        "quit\ncont\n\ncafé 𐐀 'quoted' $(false);\0{}",
        "🙂雪".repeat(1400)
    );
    let bytes = text.as_bytes();
    let mut offset = 0;
    let mut sequence = 1;
    while offset < bytes.len() {
        let end = (offset + application_input::CHUNK_LIMIT).min(bytes.len());
        let request = input_request(
            &binding,
            &started.session_id,
            sequence,
            Some(&bytes[offset..end]),
        );
        let result = state.application_input_at(&binding, &request).unwrap();
        let repeated = state.application_input_at(&binding, &request).unwrap();
        assert_eq!(
            result.acknowledgement.accepted_bytes,
            repeated.acknowledgement.accepted_bytes
        );
        offset += result.acknowledgement.accepted_bytes;
        sequence += 1;
    }
    let eof = input_request(&binding, &started.session_id, sequence, None);
    state.application_input_at(&binding, &eof).unwrap();
    let finished = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(finished.state, "succeeded", "{}", finished.output);
    let expected = format!(
        "APP_INPUT_BYTES:{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    assert!(finished.output.contains(&expected), "{}", finished.output);
    if profile {
        let path = root.join(finished.profile_path.as_ref().expect("JFR recording path"));
        assert!(fs::metadata(&path).unwrap().len() > 0);
        let home = selected_jdk("").unwrap();
        let summary = Command::new(home.join("bin").join(executable_name("jfr")))
            .arg("summary")
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            summary.status.success(),
            "{}",
            String::from_utf8_lossy(&summary.stderr)
        );
        assert!(String::from_utf8_lossy(&summary.stdout).contains("jdk."));
    }
    assert_eq!(
        finished.application_input.unwrap().accepted_bytes,
        bytes.len() as u64
    );
    // The same EOF acknowledgement remains safe after process completion.
    state.application_input_at(&binding, &eof).unwrap();
    let mut stale = input_request(&binding, &started.session_id, sequence + 1, Some(b"late"));
    assert!(state.application_input_at(&binding, &stale).is_err());
    stale.session_id.push_str("-replaced");
    assert!(state.application_input_at(&binding, &stale).is_err());
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

macro_rules! real_case {
    ($name:ident, $kind:literal, $mode:literal) => {
        #[test]
        #[ignore = "requires a real full JDK, loopback access and the selected offline build tool"]
        fn $name() {
            run($kind, $mode);
        }
    };
}
real_case!(real_application_input_jdk_run, "jdk", "run");
real_case!(real_application_input_jdk_jdi, "jdk", "jdi");
real_case!(real_application_input_jdk_jdb, "jdk", "jdb");
real_case!(real_application_input_maven_run, "maven", "run");
real_case!(real_application_input_maven_jdi, "maven", "jdi");
real_case!(real_application_input_maven_jdb, "maven", "jdb");
real_case!(real_application_input_gradle_run, "gradle", "run");
real_case!(real_application_input_gradle_jdi, "gradle", "jdi");
real_case!(real_application_input_gradle_jdb, "gradle", "jdb");

#[test]
#[ignore = "requires a real full JDK with JFR and loopback access"]
fn real_application_input_jfr_jdk() {
    run_with_profile("jdk", "run", true);
}
#[test]
#[ignore = "requires a real full JDK with JFR, loopback access and offline Maven"]
fn real_application_input_jfr_maven() {
    run_with_profile("maven", "run", true);
}
#[test]
#[ignore = "requires a real full JDK with JFR, loopback access and offline Gradle"]
fn real_application_input_jfr_gradle() {
    run_with_profile("gradle", "run", true);
}

#[test]
#[ignore = "requires a real full JDK and loopback access"]
fn real_application_input_restart_stop_and_non_application_operations() {
    let (root, binding) = prepare("jdk");
    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "run");
    launch.configuration.application_input = true;
    let started = state.start(binding.clone(), launch).unwrap();
    let old = state.job.lock().unwrap().clone().unwrap();
    wait_for(&old, |snapshot| snapshot.output.contains("APP_INPUT_READY"));
    let previous = input_request(&binding, &started.session_id, 1, Some(b"previous input"));
    state.application_input_at(&binding, &previous).unwrap();
    let next = state
        .restart(
            binding.clone(),
            RestartRequest {
                workspace_id: binding.workspace_id.clone(),
                generation: 1,
                session_id: started.session_id,
                trusted: true,
                source_breakpoints: vec![],
            },
        )
        .unwrap();
    assert_ne!(next.session_id, previous.session_id);
    assert!(state.application_input_at(&binding, &previous).is_err());
    let current = state.job.lock().unwrap().clone().unwrap();
    assert!(current.request.configuration.application_input);
    assert!(current.request.configuration.jvm_options.is_empty());
    wait_for(&current, |snapshot| {
        snapshot.output.contains("APP_INPUT_READY")
    });
    current.stop();
    assert_eq!(
        current.read().unwrap().application_input.unwrap().state,
        "closed"
    );
    assert!(state
        .application_input_at(
            &binding,
            &input_request(&binding, &next.session_id, 1, Some(b"stopped"))
        )
        .is_err());
    let mut build = request(&binding, "build");
    build.configuration.application_input = true;
    state.start(binding.clone(), build).unwrap();
    let build = state.job.lock().unwrap().clone().unwrap();
    let finished = wait_for(&build, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(finished.state, "succeeded", "{}", finished.output);
    assert!(finished.application_input.is_none());
    assert!(state
        .application_input_at(
            &binding,
            &input_request(&binding, &finished.session_id, 1, None)
        )
        .is_err());
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
