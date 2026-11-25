use super::*;
#[test]
fn testng_suites_quote_literal_methods_and_remain_private_owned_files() {
    let file = maven_testng_suite_file(&[
        "p.SampleTest#dollar$".into(),
        "p.SampleTest#second".into(),
        "p.WholeTest".into(),
    ])
    .unwrap();
    let source = fs::read_to_string(&file.path).unwrap();
    assert!(
        source.contains("<class name=\"p.SampleTest\"><methods><include name=\"dollar\\$\"/>")
            && source.contains("<class name=\"p.WholeTest\"></class>")
    );
    assert!(!source.contains("DOCTYPE"));
    let path = file.path.clone();
    let parent = path.parent().unwrap().to_owned();
    drop(file);
    assert!(!path.exists());
    assert!(!parent.exists());
    assert!(maven_testng_suite_file(&["p.Test#.*".into()]).is_err());
    assert!(maven_testng_suite_file(&["p.Test#injected\"/>".into()]).is_err());
}
#[test]
fn clients_cannot_choose_the_native_testng_provider_route() {
    let config = Configuration {
        build_tool: "maven".into(),
        main_class: String::new(),
        class_path: vec![],
        launch_as_module: false,
        project_path: String::new(),
        test_filter: String::new(),
        test_framework: default_test_framework(),
        test_report_paths: vec![],
        working_directory: String::new(),
        application_input: false,
        program_arguments: vec![],
        jvm_options: vec![],
        test_jvm_options: vec![],
        environment: vec![],
        jdk_home: String::new(),
        debugger_mode: default_debugger_mode(),
        debugger_attach: None,
    };
    let request = serde_json::json!({"workspaceId":"one","generation":1,"operation":"test","trusted":true,"configuration":config,"testngSelection":true});
    assert!(serde_json::from_value::<Request>(request).is_err());
}

const MAIN: &str = r#"import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public class Main {
  static String hex(String value) {
    StringBuilder hex = new StringBuilder();
    for (byte b : value.getBytes(StandardCharsets.UTF_8)) hex.append(String.format("%02x", b & 0xff));
    return hex.toString();
  }
  public static void main(String[] args) throws Exception {
    StringBuilder proof = new StringBuilder();
    for (int i=0; i<args.length; i++) proof.append("ARG"+i+"="+hex(args[i])+"\n");
    proof.append("MODE="+hex(System.getenv("IDE_LAUNCH_FIXTURE_MODE"))+"\n");
    proof.append("EMPTY="+hex(System.getenv("IDE_LAUNCH_FIXTURE_EMPTY"))+"\n");
    String literal = System.getProperty("ide.fixture.literal"), empty = System.getProperty("ide.fixture.empty");
    proof.append("VM_LITERAL="+(literal == null ? "NULL" : hex(literal))+"\n");
    proof.append("VM_EMPTY="+(empty == null ? "NULL" : hex(empty))+"\n");
    proof.append("HEAP_FLAG="+java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().contains("-Xmx96m")+"\n");
    proof.append("GRADLE_DEFAULT="+System.getProperty("fixture.gradle.project")+"\n");
    if (literal != null && (Runtime.getRuntime().maxMemory() < 80L*1024*1024 || Runtime.getRuntime().maxMemory() > 128L*1024*1024)) throw new AssertionError("Heap option was not applied");
    proof.append("JDK="+Paths.get(System.getProperty("java.home")).toRealPath()+"\n");
    proof.append("JAVA_HOME="+Paths.get(System.getenv("JAVA_HOME")).toRealPath()+"\n");
    if ("required".equals(System.getProperty("fixture.runtime.dependency"))) {
      Class.forName("junit.framework.TestCase");
      if (!Files.isRegularFile(Paths.get("application-resource.txt"))) throw new AssertionError("Wrong application directory");
    }
    Files.write(Paths.get("launch-proof.txt"), proof.toString().getBytes(StandardCharsets.UTF_8));
    System.out.println("LAUNCH_SETTINGS_OK");
  }
}
"#;
fn hex(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn launch_fixture(kind: &str, debug: bool, with_options: bool, with_arguments: bool) {
    let (root, binding) = fixture();
    let source = if kind == "jdk" {
        root.join("Main.java")
    } else {
        let source = root.join("src/main/java/Main.java");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::remove_file(root.join("Main.java")).unwrap();
        source
    };
    fs::write(&source, MAIN).unwrap();
    let descriptor = match kind {
        "maven" => Some((
            "pom.xml",
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>launch</artifactId><version>1</version><properties><maven.compiler.source>8</maven.compiler.source><maven.compiler.target>8</maven.compiler.target><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version><configuration><arguments><argument>maven-project-default</argument></arguments></configuration></plugin></plugins></build></project>"#,
        )),
        "gradle" => Some((
            "build.gradle",
            "plugins { id 'application' }\napplication { mainClass = 'Main'; applicationDefaultJvmArgs = ['-Dfixture.gradle.project=retained'] }\ntasks.named('run') { args 'gradle-project-default' }\n",
        )),
        _ => None,
    };
    if kind == "gradle" {
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name = 'launch'\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
    }
    let default_home = jdk_home()
        .expect("installed full JDK")
        .canonicalize()
        .unwrap();
    let home = match std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
        Ok(value) => {
            let selected = selected_jdk(&value).unwrap();
            assert_ne!(
                selected, default_home,
                "alternate JDK qualification requires two different installations"
            );
            selected
        }
        Err(_) => default_home,
    };
    let legacy_java = java8_launcher(&home);
    let legacy_maven = kind == "maven" && legacy_java;
    let descriptor = descriptor.map(|(name, content)| {
        let content = if legacy_maven {
            content.replace("<build>", "<dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>runtime</scope></dependency></dependencies><build>")
        } else {
            content.to_owned()
        };
        fs::write(root.join(name), &content).unwrap();
        (name, content)
    });
    let mut selected = request(&binding, if debug { "debug" } else { "run" });
    selected.configuration.build_tool = kind.into();
    selected.configuration.jdk_home = home.to_string_lossy().into_owned();
    selected.configuration.program_arguments = [
        "",
        "two words",
        "both'\"quotes",
        "back\\slash",
        "$(touch injected.txt);literal",
        "line\nbreak",
        "😀",
        "--console=literal",
    ]
    .map(String::from)
    .to_vec();
    if !with_arguments {
        selected.configuration.program_arguments.clear();
    }
    let literal = "literal = both'\"quotes\\slash\n😀 $(touch vm-injected.txt)";
    if with_options {
        selected.configuration.jvm_options = vec![
            "-Xmx96m".into(),
            format!("-Dide.fixture.literal={literal}"),
            "-Dide.fixture.empty=".into(),
        ];
        if !legacy_java {
            selected.configuration.jvm_options.push("--add-opens=java.base/java.lang=ALL-UNNAMED".into());
        }
    }
    let runtime = if legacy_maven && with_options && with_arguments {
        selected.configuration.working_directory = "run assets/café's".into();
        selected.configuration.jvm_options.push("-Dfixture.runtime.dependency=required".into());
        let runtime = root.join(&selected.configuration.working_directory);
        fs::create_dir_all(&runtime).unwrap();
        fs::write(runtime.join("application-resource.txt"), "working directory proof").unwrap();
        runtime
    } else {
        root.clone()
    };
    selected.configuration.environment = vec![
        EnvironmentVariable {
            name: "IDE_LAUNCH_FIXTURE_MODE".into(),
            value: "literal = ' \" 😀".into(),
        },
        EnvironmentVariable {
            name: "IDE_LAUNCH_FIXTURE_EMPTY".into(),
            value: String::new(),
        },
    ];
    let mut expected = String::new();
    for (index, value) in selected.configuration.program_arguments.iter().enumerate() {
        expected.push_str(&format!("ARG{index}={}\n", hex(value)));
    }
    if !with_arguments {
        if kind == "gradle" {
            expected.push_str(&format!("ARG0={}\n", hex("gradle-project-default")));
        } else if kind == "maven" && !with_options {
            expected.push_str(&format!("ARG0={}\n", hex("maven-project-default")));
        }
    }
    expected.push_str(&format!(
        "MODE={}\nEMPTY=\nVM_LITERAL={}\nVM_EMPTY={}\nHEAP_FLAG={}\nGRADLE_DEFAULT={}\nJDK={}\nJAVA_HOME={}\n",
        hex(&selected.configuration.environment[0].value),
        if with_options { hex(literal) } else { "NULL".into() },
        if with_options { "" } else { "NULL" },
        with_options,
        if kind == "gradle" { "retained" } else { "null" },
        if legacy_java && home.join("jre").is_dir() { home.join("jre") } else { home.clone() }.display(),
        home.display()
    ));
    let state = JavaExecutionState::default();
    state.start(binding, selected).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    if debug {
        wait_for(&job, |snapshot| {
            snapshot.output.contains("VM Started") || snapshot.state == "failed"
        });
        {
            let mut child = job.child.lock().unwrap();
            let input = child.as_mut().unwrap().stdin.as_mut().unwrap();
            writeln!(input, "stop in Main.main\ncont").unwrap();
        }
        let stopped = wait_for(&job, |snapshot| {
            snapshot.output.contains("Breakpoint hit") || snapshot.state == "failed"
        });
        assert!(stopped.output.contains("Main.main"), "{}", stopped.output);
        {
            let mut child = job.child.lock().unwrap();
            writeln!(child.as_mut().unwrap().stdin.as_mut().unwrap(), "locals").unwrap();
        }
        let expected_local = format!(
            "args = instance of java.lang.String[{}]",
            if with_arguments { 8 } else { 0 }
        );
        wait_for(&job, |snapshot| {
            snapshot.output.contains(&expected_local) || snapshot.state == "failed"
        });
        {
            let mut child = job.child.lock().unwrap();
            writeln!(child.as_mut().unwrap().stdin.as_mut().unwrap(), "cont").unwrap();
        }
    }
    let snapshot = wait_for(&job, |snapshot| {
        !["starting", "running"].contains(&snapshot.state.as_str())
    });
    assert_eq!(snapshot.exit_code, Some(0), "{}", snapshot.output);
    assert!(
        snapshot.output.contains("LAUNCH_SETTINGS_OK"),
        "{}",
        snapshot.output
    );
    assert_eq!(
        fs::read_to_string(runtime.join("launch-proof.txt")).unwrap(),
        expected,
        "{}",
        snapshot.output
    );
    assert!(!runtime.join("injected.txt").exists());
    assert!(!runtime.join("vm-injected.txt").exists());
    assert_eq!(fs::read_to_string(source).unwrap(), MAIN);
    if let Some((name, content)) = descriptor {
        assert_eq!(fs::read_to_string(root.join(name)).unwrap(), content);
    }
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
#[test]
#[ignore = "requires an installed full JDK"]
fn real_jdk_launch_preserves_literal_arguments_environment_and_selected_jdk() {
    for (options, arguments) in [(true, true), (true, false), (false, false)] {
        launch_fixture("jdk", false, options, arguments);
    }
}
#[test]
#[ignore = "requires installed Maven, a full JDK and cached exec plugin or dependency access"]
fn real_maven_launch_preserves_literal_arguments_environment_and_selected_jdk() {
    for (options, arguments) in [(true, true), (true, false), (false, false)] {
        launch_fixture("maven", false, options, arguments);
    }
}
#[test]
#[ignore = "requires installed Gradle and a full JDK"]
fn real_gradle_launch_preserves_literal_arguments_environment_and_selected_jdk() {
    for (options, arguments) in [(true, true), (true, false), (false, false)] {
        launch_fixture("gradle", false, options, arguments);
    }
}
#[test]
#[ignore = "requires an installed full JDK and jdb"]
fn real_jdb_launch_preserves_literal_arguments_environment_and_selected_jdk() {
    for (options, arguments) in [(true, true), (true, false), (false, false)] {
        launch_fixture("jdk", true, options, arguments);
    }
}

#[test]
fn explicit_jdk_selection_refuses_missing_relative_or_incomplete_jdks() {
    let (root, binding) = fixture();
    for value in ["relative", "/does-not-exist", "bad\0path", "invalid\npath"] {
        assert!(selected_jdk(value).is_err());
    }
    let home = root.join("jdk");
    fs::create_dir_all(home.join("bin")).unwrap();
    fs::write(home.join("bin").join(executable_name("java")), "").unwrap();
    assert!(selected_jdk(&home.to_string_lossy()).is_err());
    fs::write(home.join("bin").join(executable_name("javac")), "").unwrap();
    assert_eq!(selected_jdk(&home.to_string_lossy()).unwrap(), home);
    let capability = capabilities(&binding, 1, "", &home.to_string_lossy()).unwrap();
    assert!(capability.jdk);
    assert!(!capability.debugger);
    let invalid = capabilities(&binding, 1, "", "relative").unwrap();
    assert!(!invalid.available);
    assert!(invalid.reason.unwrap().contains("absolute"));
    fs::remove_dir_all(root).unwrap();
}
