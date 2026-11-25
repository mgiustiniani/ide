//! End-to-end native execution of a provider-declared project with real JDK tools.
use super::*;
use crate::commands::java_execution::{
    JavaExecutionState, Request as ExecutionRequest, SessionRequest,
};
use crate::commands::refactorkit_daemon::JavaExecutionProjectSelection;

#[test]
#[ignore = "Requires isolated RefactorKit, full JDK and IDE_JUNIT_PLATFORM_CONSOLE_JAR"]
fn real_declared_project_tests_and_discovery_use_runtime_dependencies_and_only_test_outputs() {
    let engine = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Select isolated daemon");
    let home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Select full JDK");
    let jar = std::env::var_os("IDE_JUNIT_PLATFORM_CONSOLE_JAR").expect("Select JUnit runtime");
    let framework = std::env::var("IDE_DECLARED_TEST_FRAMEWORK").unwrap_or_else(|_| "junit".into());
    assert!(["junit", "testng"].contains(&framework.as_str()));
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let fixture = Fixture::new();
    fs::create_dir(fixture.root.join("lib")).unwrap();
    fs::copy(jar, fixture.root.join("lib/junit.jar")).unwrap();
    let mut framework_classpath = vec!["lib/junit.jar".to_owned()];
    if framework == "testng" {
        let dependencies =
            std::env::var_os("IDE_TESTNG_CLASSPATH").expect("Select TestNG runtime dependencies");
        for (index, dependency) in std::env::split_paths(&dependencies).enumerate() {
            let relative = format!("lib/testng-{index}.jar");
            fs::copy(dependency, fixture.root.join(&relative)).unwrap();
            framework_classpath.push(relative);
        }
    }
    let inputs = [
        ("code/main/demo/MainSupport.java", "package demo; public class MainSupport { public static String value() { return \"main\"; } }\n"),
        ("code/checks/demo/ChecksTest.java", "package demo; public class ChecksTest { @org.junit.jupiter.api.Test public void selected() throws Exception { org.junit.jupiter.api.Assertions.assertEquals(\"main\", MainSupport.value()); org.junit.jupiter.api.Assertions.assertEquals(\"runtime\", Class.forName(\"runtime.Token\").getMethod(\"value\").invoke(null)); java.nio.file.Files.writeString(java.nio.file.Path.of(\"test-proof.txt\"), \"selected\"); } }\n"),
        ("code/checks/runtime/Token.java", "package runtime; public class Token { public static String value() { return \"wrong-selected-output\"; } }\n"),
        ("runtime src/runtime/Token.java", "package runtime; public class Token { public static String value() { return \"runtime\"; } }\n"),
        ("runtime src/runtime/DecoyTest.java", "package runtime; public class DecoyTest { @org.junit.jupiter.api.Test public void unselected() throws Exception { java.nio.file.Files.writeString(java.nio.file.Path.of(\"decoy-body.txt\"), \"wrong\"); } }\n"),
        ("outside/Broken.java", "Invalid unselected Java must be excluded"),
    ].map(|(path, contents)| (path, if framework == "testng" && path == "code/checks/demo/ChecksTest.java" {
        contents.replace("@org.junit.jupiter.api.Test", "@org.testng.annotations.Test")
    } else { contents.to_owned() }));
    for (path, contents) in &inputs {
        let path = fixture.root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
    let built = std::process::Command::new(Path::new(&home).join("bin/javac"))
        .args([
            "--release",
            "17",
            "-proc:none",
            "-cp",
            "lib/junit.jar",
            "-d",
            "runtime classes",
            "runtime src/runtime/Token.java",
            "runtime src/runtime/DecoyTest.java",
        ])
        .current_dir(&fixture.root)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    fs::create_dir(fixture.root.join(".refactorkit")).unwrap();
    let test_compile = std::iter::once("products/main classes".to_owned())
        .chain(framework_classpath.clone())
        .collect::<Vec<_>>();
    let test_runtime = [
        "runtime classes",
        "products/test classes",
        "products/main classes",
    ]
    .map(str::to_owned)
    .into_iter()
    .chain(framework_classpath)
    .collect::<Vec<_>>();
    let manifest = serde_json::to_vec_pretty(&json!({"schemaVersion":"java-declared-project-v1","sdkHome":home,"modules":[{"id":"app","root":".","sourceSets":[
        {"id":"application","kind":"main","sourceRoots":["code/main"],"generatedSourceRoots":[],"outputDirectories":["products/main classes"],"compileClasspath":[],"runtimeClasspath":["products/main classes"],"release":17,"proc":"none"},
        {"id":"checks","kind":"test","sourceRoots":["code/checks"],"generatedSourceRoots":[],"outputDirectories":["products/test classes"],"compileClasspath":test_compile,"runtimeClasspath":test_runtime,"release":17,"proc":"none"}
    ]}]})).unwrap();
    fs::write(
        fixture.root.join(".refactorkit/java-project.json"),
        &manifest,
    )
    .unwrap();
    let state = JavaProjectContextState::default();
    let executor = JavaExecutionState::new(&state);
    struct Cleanup<'a>(&'a JavaExecutionState, &'a JavaProjectContextState);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            self.0.shutdown_all();
            self.1.shutdown_all();
        }
    }
    let _cleanup = Cleanup(&executor, &state);
    let mut evidence = Vec::new();
    for operation in ["build", "test", "discover"] {
        let mut settings = fixture.request();
        settings.sdk_home = home.clone();
        let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let observed =
            query_owned(fixture.binding.clone(), settings, state.0.clone(), ticket).unwrap();
        assert_eq!(observed["status"], "available", "{observed}");
        let context = &observed["context"];
        let selection: JavaExecutionProjectSelection = serde_json::from_value(json!({"providerId":"java-declared-v1","moduleId":"app","sourceSetId":"application","context":{"projectPath":"","sdkHome":home,"mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],"contextSchemaVersion":context["schemaVersion"],"platformIdentities":context["sdk"].as_array().unwrap().iter().map(|sdk|sdk["identitySha256"].clone()).collect::<Vec<_>>()}})).unwrap();
        let request: ExecutionRequest = serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"operation":operation,"trusted":true,"configuration":{"buildTool":"auto","mainClass":"demo.MainSupport","classPath":[],"jdkHome":home,"testFramework":framework,"testFilter":if operation=="test" {"demo.ChecksTest#selected"} else {""}}})).unwrap();
        let started = serde_json::to_value(
            executor
                .start_project(fixture.binding.clone(), request, selection)
                .unwrap(),
        )
        .unwrap();
        let session: SessionRequest = serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        let completed = loop {
            let snapshot =
                serde_json::to_value(executor.snapshot_at(&fixture.binding, &session).unwrap())
                    .unwrap();
            if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) {
                break snapshot;
            }
            assert!(std::time::Instant::now() < deadline, "{snapshot}");
            std::thread::sleep(Duration::from_millis(50));
        };
        assert_eq!(completed["state"], "succeeded", "{completed}");
        if operation == "test" {
            assert_eq!(completed["testResults"]["status"], "ready", "{completed}");
            assert_eq!(
                completed["testResults"]["summary"]["passed"], 1,
                "{completed}"
            );
            assert_eq!(
                fs::read_to_string(fixture.root.join("test-proof.txt")).unwrap(),
                "selected"
            );
            fs::remove_file(fixture.root.join("test-proof.txt")).unwrap();
        }
        if operation == "discover" {
            let discovery = &completed["testDiscovery"];
            assert_eq!(discovery["status"], "ready", "{completed}");
            let tests = discovery["tests"].as_array().unwrap();
            assert!(
                tests
                    .iter()
                    .any(|test| test["className"] == "demo.ChecksTest"
                        && test["methodName"] == "selected"),
                "{completed}"
            );
            assert!(
                tests
                    .iter()
                    .all(|test| test["className"] == "demo.ChecksTest"),
                "Discovery escaped the selected test outputs: {completed}"
            );
            assert!(!fixture.root.join("test-proof.txt").exists());
        }
        assert!(!fixture.root.join("decoy-body.txt").exists());
        evidence.push(completed);
        if let Some(path) = std::env::var_os("IDE_DECLARED_TEST_EVIDENCE") {
            fs::write(path, serde_json::to_vec_pretty(&json!({"framework":framework,"operations":evidence,"fullScenarioVerified":false})).unwrap()).unwrap();
        }
    }
    for (path, contents) in inputs {
        assert_eq!(
            fs::read_to_string(fixture.root.join(path)).unwrap(),
            contents
        );
    }
    assert_eq!(
        fs::read(fixture.root.join(".refactorkit/java-project.json")).unwrap(),
        manifest
    );
    if let Some(path) = std::env::var_os("IDE_DECLARED_TEST_EVIDENCE") {
        fs::write(
            path,
            serde_json::to_vec_pretty(
                &json!({"framework":framework,"operations":evidence,"fullScenarioVerified":true,"inputsPreserved":true}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}

#[test]
#[ignore = "Requires isolated qualified RefactorKit and IDE_JAVA_CONTEXT_TEST_JDK"]
fn real_declared_project_build_run_and_jdi_debug_use_exact_roots_and_dependencies() {
    let engine = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Select isolated daemon");
    let home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Select full JDK");
    let release = std::env::var("IDE_ENTRY_POINTS_RELEASE")
        .unwrap_or_else(|_| "17".into())
        .parse::<u64>()
        .unwrap();
    let sdk = Path::new(&home).canonicalize().unwrap();
    let legacy = fs::read_to_string(sdk.join("release")).unwrap()
        .lines().any(|line| line.starts_with("JAVA_VERSION=\"1.8."));
    let runtime = if legacy { sdk.join("jre") } else { sdk };
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let fixture = Fixture::new();
    let source_path = "source code/build/Main.java";
    let source = "package build;\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(\"DECLARED_OK:\" + dep.Support.message() + \"|\" + System.getProperty(\"java.home\") + \"|\" + java.util.Arrays.toString(args));\n  }\n}\n";
    let material = [
        (source_path, source),
        ("outside/Broken.java", "This unselected source must never reach javac"),
        ("dependency src/dep/Support.java", "package dep; public class Support { public static String message() { return \"from-jar\"; } }\n"),
    ];
    for (path, text) in material {
        let path = fixture.root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    let javac = Path::new(&home).join("bin/javac");
    fs::create_dir(fixture.root.join("lib")).unwrap();
    fs::create_dir(fixture.root.join("dependency classes")).unwrap();
    let target = release.to_string();
    let compiler_flags = if legacy {
        assert_eq!(release, 8);
        vec!["-source", "8", "-target", "8"]
    } else {
        vec!["--release", &target]
    };
    let compiled = std::process::Command::new(javac)
        .args(compiler_flags)
        .args([
            "-proc:none",
            "-d",
            "dependency classes",
            "dependency src/dep/Support.java",
        ])
        .current_dir(&fixture.root)
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let jar = std::process::Command::new(Path::new(&home).join("bin/jar"))
        .args([
            "cf",
            "lib/dependency.jar",
            "-C",
            "dependency classes",
            ".",
        ])
        .current_dir(&fixture.root)
        .output()
        .unwrap();
    assert!(
        jar.status.success(),
        "{}",
        String::from_utf8_lossy(&jar.stderr)
    );
    fs::create_dir(fixture.root.join(".refactorkit")).unwrap();
    let declaration = serde_json::to_vec_pretty(&json!({"schemaVersion":"java-declared-project-v1","sdkHome":home,"modules":[{"id":"app","root":".","sourceSets":[{"id":"application","kind":"main","sourceRoots":["source code"],"generatedSourceRoots":[],"outputDirectories":["products/app classes"],"compileClasspath":["lib/dependency.jar"],"runtimeClasspath":["products/app classes","lib/dependency.jar"],"release":release,"proc":"none"}]}]})).unwrap();
    fs::write(
        fixture.root.join(".refactorkit/java-project.json"),
        &declaration,
    )
    .unwrap();
    let state = JavaProjectContextState::default();
    let executor = JavaExecutionState::new(&state);
    struct Cleanup<'a>(&'a JavaExecutionState, &'a JavaProjectContextState);
    impl Drop for Cleanup<'_> {
        fn drop(&mut self) {
            self.0.shutdown_all();
            self.1.shutdown_all();
        }
    }
    let _cleanup = Cleanup(&executor, &state);
    let mut rows = Vec::new();
    for operation in ["build", "run", "debug"] {
        let mut settings = fixture.request();
        settings.sdk_home = home.clone();
        let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let observed =
            query_owned(fixture.binding.clone(), settings, state.0.clone(), ticket).unwrap();
        assert_eq!(observed["status"], "available", "{observed}");
        let context = &observed["context"];
        let selection: JavaExecutionProjectSelection = serde_json::from_value(json!({"providerId":"java-declared-v1","moduleId":"app","sourceSetId":"application","context":{"projectPath":"","sdkHome":home,"mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],"contextSchemaVersion":context["schemaVersion"],"platformIdentities":context["sdk"].as_array().unwrap().iter().map(|sdk|sdk["identitySha256"].clone()).collect::<Vec<_>>()}})).unwrap();
        let fingerprint = {
            use sha2::{Digest, Sha256};
            format!("{:x}", Sha256::digest(source.as_bytes()))
        };
        let request: ExecutionRequest = serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"operation":operation,"trusted":true,"configuration":{"buildTool":"auto","mainClass":"build.Main","classPath":[],"jdkHome":home,"debuggerMode":"jdi","programArguments":["","a b"]},"sourceBreakpoints":if operation=="debug" {json!([{"sourcePath":source_path,"line":4,"fingerprint":fingerprint}])} else {json!([])}})).unwrap();
        let started = serde_json::to_value(
            executor
                .start_project(fixture.binding.clone(), request, selection)
                .unwrap(),
        )
        .unwrap();
        let session: SessionRequest = serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        let mut breakpoint = false;
        let completed = loop {
            let snapshot =
                serde_json::to_value(executor.snapshot_at(&fixture.binding, &session).unwrap())
                    .unwrap();
            if operation == "debug" && snapshot["debuggerState"]["status"] == "suspended" {
                let debugger = &snapshot["debuggerState"];
                if debugger["reason"] == "breakpoint" {
                    assert!(
                        debugger["frames"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|frame| frame["className"] == "build.Main" && frame["line"] == 4),
                        "{snapshot}"
                    );
                    assert!(
                        debugger["breakpoints"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|point| point["verified"] == true && point["line"] == 4),
                        "{snapshot}"
                    );
                    breakpoint = true;
                } else {
                    assert_eq!(debugger["reason"], "entry", "{snapshot}");
                }
                executor.debug_action_at(&fixture.binding, &serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"sessionId":session.session_id,"action":{"type":"continue","stopId":debugger["stopId"]}})).unwrap()).unwrap();
            }
            if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) {
                break snapshot;
            }
            assert!(std::time::Instant::now() < deadline, "{snapshot}");
            std::thread::sleep(Duration::from_millis(50));
        };
        assert_eq!(completed["state"], "succeeded", "{completed}");
        assert_eq!(completed["exitCode"], 0, "{completed}");
        let bytes = fs::read(fixture.root.join("products/app classes/build/Main.class")).unwrap();
        assert_eq!(&bytes[..4], &[0xca, 0xfe, 0xba, 0xbe]);
        assert_eq!(u16::from_be_bytes([bytes[6], bytes[7]]) as u64, release + 44);
        assert!(!fixture
            .root
            .join("products/app classes/dep/Support.class")
            .exists());
        if operation != "build" {
            let output = completed["output"].as_str().unwrap();
            assert!(output.contains("DECLARED_OK:from-jar|"), "{completed}");
            assert!(
                output.contains(&format!(
                    "|{}|[, a b]",
                    runtime.display()
                )),
                "{completed}"
            );
        }
        if operation == "debug" {
            assert!(breakpoint, "A real source breakpoint is required");
        }
        rows.push(json!({"operation":operation,"state":completed["state"],"exitCode":completed["exitCode"],"breakpointVerified":breakpoint,"output":completed["output"]}));
    }
    for (path, text) in material {
        assert_eq!(fs::read_to_string(fixture.root.join(path)).unwrap(), text);
    }
    assert_eq!(
        fs::read(fixture.root.join(".refactorkit/java-project.json")).unwrap(),
        declaration
    );
    if let Some(path) = std::env::var_os("IDE_DECLARED_EXECUTION_EVIDENCE") {
        fs::write(path, serde_json::to_vec_pretty(&json!({"release":release,"sdkHome":home,"operations":rows,"sourcesPreserved":true,"declarationPreserved":true})).unwrap()).unwrap();
    }
}
