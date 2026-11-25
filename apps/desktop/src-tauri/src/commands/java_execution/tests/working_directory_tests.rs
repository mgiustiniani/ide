use super::*;
const MAIN: &str = r#"import java.nio.file.*;
public class Main {
 public static void main(String[] args) throws Exception {
  if (!Files.readString(Path.of("settings.txt")).equals("APP_CWD_PROOF")) throw new AssertionError("wrong resource");
  Files.writeString(Path.of("cwd-proof.txt"), Path.of("").toRealPath()+"\n"+Path.of(System.getProperty("user.dir")).toRealPath()+"\n"+Files.readSymbolicLink(Path.of("/proc/self/cwd")));
  System.out.println("APP_CWD_OK");
 }
}
"#;

fn prepare(kind: &str) -> (PathBuf, CurrentWorkspaceBinding, PathBuf, PathBuf) {
    let (root, binding) = fixture();
    fs::remove_file(root.join("Main.java")).unwrap();
    let project = root.join("project");
    let runtime = root.join("run assets/servízio's");
    fs::create_dir_all(&runtime).unwrap();
    fs::write(runtime.join("settings.txt"), "APP_CWD_PROOF").unwrap();
    let source = if kind == "jdk" {
        project.join("Main.java")
    } else {
        project.join("src/main/java/Main.java")
    };
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, MAIN).unwrap();
    if kind == "maven" {
        fs::write(project.join("pom.xml"), r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>cwd</artifactId><version>1</version><properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin></plugins></build></project>"#).unwrap();
    } else if kind == "gradle" {
        fs::write(
            project.join("settings.gradle"),
            "rootProject.name = 'cwd-fixture'\n",
        )
        .unwrap();
        fs::write(
            project.join("build.gradle"),
            "plugins { id 'application' }\napplication { mainClass = 'Main' }\n",
        )
        .unwrap();
        fs::write(
            project.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
        #[cfg(unix)]
        if let Some(executable) = std::env::var_os("IDE_GRADLE_TEST_EXECUTABLE") {
            use std::os::unix::fs::PermissionsExt;
            let executable = PathBuf::from(executable).canonicalize().unwrap();
            let quoted = executable.to_string_lossy().replace('\'', "'\\''");
            fs::write(
                project.join("gradlew"),
                format!("#!/bin/sh\nexec '{quoted}' --offline --no-daemon \"$@\"\n"),
            )
            .unwrap();
            fs::set_permissions(project.join("gradlew"), fs::Permissions::from_mode(0o700))
                .unwrap();
        }
    }
    (root, binding, project, runtime)
}
fn launch(kind: &str, debug: bool, profile: bool) {
    let (root, binding, project, runtime) = prepare(kind);
    let mut request = request(&binding, if debug { "debug" } else { "run" });
    request.profile = profile;
    request.configuration.build_tool = kind.into();
    request.configuration.project_path = "project".into();
    request.configuration.working_directory = "run assets/servízio's".into();
    request.configuration.debugger_mode = "jdi".into();
    let state = JavaExecutionState::default();
    state.start(binding, request).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    if debug {
        let paused = wait_for(&job, |snapshot| {
            snapshot.state == "failed"
                || snapshot
                    .debugger_state
                    .as_ref()
                    .is_some_and(|state| state.reason.as_deref() == Some("entry"))
        });
        assert_ne!(paused.state, "failed", "{}", paused.output);
        structured_debugger::send(
            &job,
            &structured_debugger::Action::Continue {
                stop_id: paused.debugger_state.unwrap().stop_id.unwrap(),
            },
        )
        .unwrap();
    }
    let finished = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(finished.state, "succeeded", "{}", finished.output);
    assert!(
        finished.output.contains("APP_CWD_OK"),
        "{}",
        finished.output
    );
    let expected = format!(
        "{}\n{}\n{}",
        runtime.display(),
        runtime.display(),
        runtime.display()
    );
    assert_eq!(
        fs::read_to_string(runtime.join("cwd-proof.txt")).unwrap(),
        expected
    );
    assert!(!project.join("cwd-proof.txt").exists());
    assert!(!root.join("cwd-proof.txt").exists());
    let compiled = match kind {
        "maven" => "target/classes/Main.class",
        "gradle" => "build/classes/java/main/Main.class",
        _ => ".ide/java/classes/Main.class",
    };
    assert!(project.join(compiled).is_file());
    if profile {
        let path = finished
            .profile_path
            .as_ref()
            .expect("completed recording path");
        assert!(
            path.starts_with("project/.ide/flight-recordings/"),
            "{path}"
        );
        assert!(!runtime.join(".ide/flight-recordings").exists());
        assert!(fs::metadata(root.join(path)).unwrap().len() > 0);
        let summary =
            flight_recording::summarize(&selected_jdk("").unwrap(), &root.join(path)).unwrap();
        assert!(summary.chunks > 0);
    }
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
#[test]
#[ignore = "requires a full JDK"]
fn real_jdk_uses_separate_application_directory() {
    launch("jdk", false, false);
}
#[test]
#[ignore = "requires a full JDK and local JDI sockets"]
fn real_jdi_uses_separate_application_directory() {
    launch("jdk", true, false);
}
#[test]
#[ignore = "requires a full JDK, Maven and locally cached plugins"]
fn real_maven_uses_separate_application_directory() {
    launch("maven", false, false);
}
#[test]
#[ignore = "requires a full JDK, Maven and local JDI sockets"]
fn real_maven_jdi_uses_separate_application_directory() {
    launch("maven", true, false);
}
#[test]
#[ignore = "requires a full JDK and IDE_GRADLE_TEST_EXECUTABLE"]
fn real_gradle_uses_separate_application_directory() {
    launch("gradle", false, false);
}
#[test]
#[ignore = "requires a full JDK, Gradle and local JDI sockets"]
fn real_gradle_jdi_uses_separate_application_directory() {
    launch("gradle", true, false);
}

#[test]
fn invalid_or_non_directory_working_paths_refuse_run_but_do_not_block_build() {
    let (root, binding, project, runtime) = prepare("jdk");
    fs::write(root.join("file.txt"), "not a directory").unwrap();
    // This checks planning only and must not depend on a machine-installed JDK.
    let sdk = root.join("planning-sdk");
    fs::create_dir_all(sdk.join("bin")).unwrap();
    for name in ["java", "javac"] {
        fs::write(
            sdk.join("bin").join(executable_name(name)),
            "planning fixture",
        )
        .unwrap();
    }
    for value in ["../outside", "/tmp", "missing", "file.txt", "a\\b", "a\n"] {
        let mut run = request(&binding, "run");
        run.configuration.project_path = "project".into();
        run.configuration.working_directory = value.into();
        run.configuration.jdk_home = sdk.to_string_lossy().into();
        assert!(invocation(&root, &run).is_err(), "{value}");
        assert!(validate_settings(&run.configuration, "test").is_ok());
        assert!(validate_settings(&run.configuration, "discover").is_ok());
        run.operation = "build".into();
        let plan = invocation(&root, &run).unwrap();
        assert!(plan.iter().all(|step| step.directory == project));
    }
    let mut config = request(&binding, "run").configuration;
    assert_eq!(
        application_directory(&root, &project, &config).unwrap(),
        project
    );
    config.working_directory = ".".into();
    assert_eq!(
        application_directory(&root, &project, &config).unwrap(),
        root
    );
    config.working_directory = "run assets/servízio's".into();
    assert_eq!(
        application_directory(&root, &project, &config).unwrap(),
        runtime
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
fn directory_links_cannot_escape_the_authorized_workspace() {
    use std::os::unix::fs::symlink;
    let (root, binding, project, _) = prepare("jdk");
    let outside = root.with_extension("outside-cwd");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, root.join("external")).unwrap();
    let mut config = request(&binding, "run").configuration;
    config.working_directory = "external".into();
    assert!(application_directory(&root, &project, &config).is_err());
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}

#[test]
#[cfg(unix)]
#[ignore = "requires a real JDK; holds only the fixture's compiler before retargeting a directory"]
fn real_jdk_refuses_a_working_directory_retargeted_during_compilation() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (root, binding, _, runtime) = prepare("jdk");
    let real_home = selected_jdk("").unwrap();
    let fake_home = root.join("controlled-sdk");
    fs::create_dir_all(fake_home.join("bin")).unwrap();
    symlink(real_home.join("bin/java"), fake_home.join("bin/java")).unwrap();
    fs::write(fake_home.join("bin/javac"), b"#!/bin/sh\nprintf ready > \"$IDE_CWD_TEST_CONTROL/entered\"\nwhile [ ! -f \"$IDE_CWD_TEST_CONTROL/release\" ]; do /usr/bin/sleep 0.02; done\nexec \"$IDE_CWD_REAL_JAVAC\" \"$@\"\n").unwrap();
    fs::set_permissions(
        fake_home.join("bin/javac"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    let control = root.join("control");
    fs::create_dir(&control).unwrap();
    let other = root.join("other-runtime");
    fs::create_dir(&other).unwrap();
    fs::write(other.join("settings.txt"), "APP_CWD_PROOF").unwrap();
    let mut run = request(&binding, "run");
    run.configuration.project_path = "project".into();
    run.configuration.jdk_home = fake_home.to_string_lossy().into();
    run.configuration.working_directory = "run assets/servízio's".into();
    run.configuration.environment = vec![
        EnvironmentVariable {
            name: "IDE_CWD_TEST_CONTROL".into(),
            value: control.to_string_lossy().into(),
        },
        EnvironmentVariable {
            name: "IDE_CWD_REAL_JAVAC".into(),
            value: real_home.join("bin/javac").to_string_lossy().into(),
        },
    ];
    let executor = JavaExecutionState::default();
    executor.start(binding, run).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    wait_for(&job, |snapshot| {
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        control.join("entered").exists()
    });
    fs::rename(&runtime, root.join("original-runtime")).unwrap();
    symlink(&other, &runtime).unwrap();
    fs::write(control.join("release"), "go").unwrap();
    let result = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(result.state, "failed", "{}", result.output);
    assert!(
        result
            .output
            .contains("working directory changed before launch"),
        "{}",
        result.output
    );
    assert!(!other.join("cwd-proof.txt").exists());
    assert!(!root.join("original-runtime/cwd-proof.txt").exists());
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(unix)]
#[ignore = "requires Linux, a real JDK and IDE_GRADLE_TEST_EXECUTABLE"]
fn real_gradle_refuses_a_directory_selection_retargeted_during_compilation() {
    use std::os::unix::fs::symlink;
    let (root, binding, project, runtime) = prepare("gradle");
    let other = root.join("other-runtime");
    fs::create_dir(&other).unwrap();
    fs::write(other.join("settings.txt"), "APP_CWD_PROOF").unwrap();
    symlink(&runtime, root.join("runtime-selection")).unwrap();
    fs::write(project.join("build.gradle"), r#"plugins { id 'application' }
application { mainClass = 'Main' }
tasks.named('classes') {
    doLast {
        def selection = projectDir.toPath().parent.resolve('runtime-selection')
        java.nio.file.Files.delete(selection)
        java.nio.file.Files.createSymbolicLink(selection, projectDir.toPath().parent.resolve('other-runtime'))
    }
}
"#).unwrap();
    let mut run = request(&binding, "run");
    run.configuration.build_tool = "gradle".into();
    run.configuration.project_path = "project".into();
    run.configuration.working_directory = "runtime-selection".into();
    let executor = JavaExecutionState::default();
    executor.start(binding, run).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let result = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(result.state, "failed", "{}", result.output);
    assert!(
        result
            .output
            .contains("working directory changed before launch"),
        "{}",
        result.output
    );
    assert_eq!(
        fs::canonicalize(root.join("runtime-selection")).unwrap(),
        other
    );
    assert!(!runtime.join("cwd-proof.txt").exists());
    assert!(!other.join("cwd-proof.txt").exists());
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires Linux and a full JDK with Flight Recorder"]
fn real_jdk_jfr_uses_separate_application_directory() {
    launch("jdk", false, true);
}
#[test]
#[ignore = "requires Linux, a full JDK with Flight Recorder and cached Maven plugins"]
fn real_maven_jfr_uses_separate_application_directory() {
    launch("maven", false, true);
}
#[test]
#[ignore = "requires Linux, a full JDK with Flight Recorder and IDE_GRADLE_TEST_EXECUTABLE"]
fn real_gradle_jfr_uses_separate_application_directory() {
    launch("gradle", false, true);
}

#[test]
#[ignore = "requires Linux and a full JDK with Flight Recorder"]
fn real_jfr_keeps_quoted_comma_unicode_project_paths_literal() {
    for name in ["project's, café", "project \"quoted\", café"] {
        let (root, binding, project, runtime) = prepare("jdk");
        fs::rename(&project, root.join(name)).unwrap();
        let executor = JavaExecutionState::default();
        let mut launch = request(&binding, "run");
        launch.profile = true;
        launch.configuration.project_path = name.into();
        launch.configuration.working_directory = "run assets/servízio's".into();
        executor.start(binding, launch).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let completed = wait_for(&job, |snapshot| {
            !["starting", "running"].contains(&snapshot.state.as_str())
        });
        assert_eq!(completed.state, "succeeded", "{}", completed.output);
        assert!(
            completed.output.contains("APP_CWD_OK"),
            "{}",
            completed.output
        );
        let path = completed
            .profile_path
            .as_ref()
            .expect("completed recording path");
        assert!(root.join(path).starts_with(root.join(name)));
        assert!(fs::metadata(root.join(path)).unwrap().len() > 0);
        let summary =
            flight_recording::summarize(&selected_jdk("").unwrap(), &root.join(path)).unwrap();
        assert!(summary.chunks > 0);
        assert!(!runtime.join(".ide").exists());
        executor.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}
