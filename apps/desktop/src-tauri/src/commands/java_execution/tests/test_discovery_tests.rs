use super::*;
use std::collections::BTreeSet;

fn project(kind: &str, framework: &str) -> (PathBuf, CurrentWorkspaceBinding, String, String) {
    let (root, binding) = fixture();
    fs::create_dir_all(root.join("src/test/java")).unwrap();
    let dependency = match framework {
        "junit4" => ("junit", "junit", "4.13.2"),
        "testng" => ("org.testng", "testng", "7.10.2"),
        _ => ("org.junit.jupiter", "junit-jupiter", "5.11.2"),
    };
    let descriptor = if kind == "maven" {
        format!(
            r#"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>discovery</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>{}</groupId><artifactId>{}</artifactId><version>{}</version><scope>test</scope></dependency></dependencies><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin></plugins></build></project>"#,
            dependency.0, dependency.1, dependency.2
        )
    } else {
        fs::write(
            root.join("settings.gradle"),
            "rootProject.name='discovery'\n",
        )
        .unwrap();
        fs::write(
            root.join("gradle.properties"),
            "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
        )
        .unwrap();
        format!("plugins {{ id 'java' }}\nrepositories {{ mavenCentral() }}\ndependencies {{ testImplementation '{}:{}:{}'; {} }}\ntest {{ {} }}\n",dependency.0,dependency.1,dependency.2,if framework == "jupiter" { "testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.11.2'" } else { "" },match framework { "junit4" => "useJUnit()", "testng" => "useTestNG()", _ => "useJUnitPlatform()" })
    };
    fs::write(
        root.join(if kind == "maven" {
            "pom.xml"
        } else {
            "build.gradle"
        }),
        &descriptor,
    )
    .unwrap();
    let annotation = match framework {
        "junit4" => "org.junit.Test",
        "testng" => "org.testng.annotations.Test",
        _ => "org.junit.jupiter.api.Test",
    };
    let source = format!(
        r#"import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public class DiscoveryTest {{
  @{annotation} public void selected() throws Exception {{
    String expected = "1.8".equals(System.getProperty("java.specification.version")) ? null : "captured 😀";
    if (!java.util.Objects.equals(expected, System.getProperty("fixture.discovery"))) throw new AssertionError("lost test JVM settings");
    String proof = "selected\n" + Paths.get(System.getProperty("java.home")).toRealPath() + "\n" + System.getenv("DISCOVERY_MODE");
    Files.write(Paths.get("selected-proof.txt"), proof.getBytes(StandardCharsets.UTF_8));
  }}
  @{annotation} public void companion() throws Exception {{
    Files.createFile(Paths.get("companion-proof.txt"));
    throw new AssertionError("companion");
  }}
}}
"#
    );
    fs::write(root.join("src/test/java/DiscoveryTest.java"), &source).unwrap();
    (root, binding, descriptor, source)
}
fn finished(state: &JavaExecutionState) -> Snapshot {
    let job = state.job.lock().unwrap().clone().unwrap();
    wait_for(&job, |snapshot| {
        matches!(snapshot.state.as_str(), "succeeded" | "failed")
    })
}
fn real_discovery(kind: &str) {
    let home = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME")
        .map(|value| selected_jdk(&value).unwrap())
        .unwrap_or_else(|_| jdk_home().unwrap());
    let legacy_maven = kind == "maven" && java8_launcher(&home);
    let runtime_home = if legacy_maven && home.join("jre").is_dir() {
        home.join("jre")
    } else {
        home.clone()
    }.canonicalize().unwrap();
    for framework in ["junit4", "jupiter", "testng"] {
        let (root, binding, mut descriptor, source) = project(kind, framework);
        if legacy_maven {
            descriptor = descriptor.replace("release>17", "release>8").replace(">7.10.2<", ">7.5.1<");
            fs::write(root.join("pom.xml"), &descriptor).unwrap();
        }
        let state = JavaExecutionState::default();
        let mut discover = request(&binding, "discover");
        discover.configuration.build_tool = kind.into();
        discover.configuration.jdk_home = home.to_string_lossy().into_owned();
        discover.configuration.jvm_options = vec!["".into()]; // Incomplete application settings do not prevent discovery.
        // The captured settings are reused by Surefire. Java 8 runs with the
        // project defaults while Surefire still needs a launcher argument file.
        if !legacy_maven {
            discover.configuration.test_jvm_options = vec!["-Dfixture.discovery=captured 😀".into()];
        }
        discover.configuration.environment = vec![EnvironmentVariable {
            name: "DISCOVERY_MODE".into(),
            value: "captured environment 😀".into(),
        }];
        state.start(binding.clone(), discover).unwrap();
        let found = finished(&state);
        assert_eq!(found.state, "succeeded", "{}", found.output);
        assert_eq!(found.exit_code, Some(0));
        assert!(found.test_results.is_none());
        let result = found.test_discovery.as_ref().unwrap();
        assert_eq!(result.status, "ready", "{:?}\n{}", result, found.output);
        let selected = result
            .tests
            .iter()
            .find(|test| {
                test.class_name == "DiscoveryTest"
                    && test.method_name.as_deref() == Some("selected")
            })
            .expect("runner provides literal method identity");
        assert!(result
            .tests
            .iter()
            .any(|test| test.class_name == "DiscoveryTest" && test.kind == "class"));
        assert!(!root.join("selected-proof.txt").exists());
        assert!(!root.join("companion-proof.txt").exists());
        let mut run = request(&binding, "test");
        run.configuration.project_path = "later-form-does-not-exist".into();
        run.configuration.jdk_home = "/nonexistent-jdk".into();
        run.configuration.test_jvm_options = vec!["".into()];
        run.test_selection = Some(TestSelection {
            discovery_session_id: found.session_id.clone(),
            test_id: selected.id.clone(),
        });
        let mut untrusted = run.clone();
        untrusted.trusted = false;
        assert!(state.start(binding.clone(), untrusted).is_err());
        let mut unknown = run.clone();
        unknown.test_selection.as_mut().unwrap().test_id = "unknown".into();
        assert!(state.start(binding.clone(), unknown).is_err());
        state.start(binding.clone(), run.clone()).unwrap();
        let passed = finished(&state);
        assert_eq!(passed.state, "succeeded", "{}", passed.output);
        assert_eq!(passed.test_results.as_ref().unwrap().summary.total, 1);
        assert_eq!(
            fs::read_to_string(root.join("selected-proof.txt")).unwrap(),
            format!(
                "selected\n{}\ncaptured environment 😀",
                runtime_home.display()
            )
        );
        assert!(!root.join("companion-proof.txt").exists());
        assert!(state
            .start(binding.clone(), run)
            .err()
            .unwrap()
            .contains("stale"));
        assert_eq!(
            fs::read_to_string(root.join(if kind == "maven" {
                "pom.xml"
            } else {
                "build.gradle"
            }))
            .unwrap(),
            descriptor
        );
        assert_eq!(
            fs::read_to_string(root.join("src/test/java/DiscoveryTest.java")).unwrap(),
            source
        );
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}
#[test]
#[ignore = "requires Maven, a JDK and real JUnit 4/Jupiter/TestNG dependencies"]
fn real_maven_test_discovery_and_captured_method_selection() {
    real_discovery("maven");
}

#[test]
#[ignore = "requires a full Java 8 or 11 JDK, offline Maven and cached JUnit 4 dependencies"]
fn real_legacy_jdk_and_maven_discovery_preserve_literal_options() {
    let home = selected_jdk(&std::env::var("IDE_TEST_ALTERNATE_JDK_HOME").unwrap()).unwrap();
    let repository = PathBuf::from(std::env::var_os("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY").unwrap());
    for kind in ["jdk", "maven"] {
        let (root, binding, descriptor, _) = project("maven", "junit4");
        let source = r#"import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.BlockJUnit4ClassRunner;
import org.junit.runners.model.InitializationError;
@RunWith(DiscoveryTest.Runner.class)
public class DiscoveryTest {
    public static class Runner extends BlockJUnit4ClassRunner {
        public Runner(Class<?> type) throws InitializationError {
            super(type);
            if (!"spaces and 'quotes'\nwith \\ backslash and café".equals(System.getProperty("fixture.discovery"))) {
                throw new AssertionError("The discovery JVM did not see the exact option");
            }
        }
    }
    @Test public void selected() throws Exception {
        java.nio.file.Files.createFile(java.nio.file.Paths.get("unexpected-test-body"));
    }
}
"#;
        fs::write(root.join("src/test/java/DiscoveryTest.java"), source).unwrap();
        fs::write(root.join("pom.xml"), descriptor.replace("release>17", "release>8")).unwrap();
        let mut discover = request(&binding, "discover");
        discover.configuration.build_tool = kind.into();
        discover.configuration.jdk_home = home.to_str().unwrap().into();
        discover.configuration.test_jvm_options =
            vec!["-Dfixture.discovery=spaces and 'quotes'\nwith \\ backslash and café".into()];
        if kind == "jdk" {
            for jar in ["junit/junit/4.13.2/junit-4.13.2.jar", "org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar"] {
                let path = Path::new(jar);
                let name = path.file_name().unwrap();
                fs::copy(repository.join(path), root.join(name)).unwrap();
                discover.configuration.class_path.push(name.to_str().unwrap().into());
            }
        }
        let state = JavaExecutionState::default();
        state.start(binding, discover).unwrap();
        let result = finished(&state);
        assert_eq!(result.state, "succeeded", "{kind}: {}", result.output);
        let discovery = result.test_discovery.unwrap();
        assert_eq!(discovery.status, "ready", "{kind}: {discovery:?}");
        assert!(discovery.tests.iter().any(|test| test.class_name == "DiscoveryTest"
            && test.method_name.as_deref() == Some("selected")), "{kind}: {discovery:?}");
        assert!(!root.join("unexpected-test-body").exists());
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires Gradle, a compatible JDK and real JUnit 4/Jupiter/TestNG dependencies"]
fn real_gradle_test_discovery_and_captured_method_selection() {
    real_discovery("gradle");
}

#[test]
#[ignore = "requires Gradle, a compatible JDK and real JUnit dependencies"]
fn real_gradle_discovery_respects_configured_test_task_filters() {
    let (root, binding, _, _) = project("gradle", "junit4");
    let build_file = root.join("build.gradle");
    let descriptor = format!(
        "{}\ntest {{\n  include '**/DiscoveryTest.class'\n  include '**/ExcludedTest.class'\n  exclude '**/ExcludedTest.class'\n}}\n",
        fs::read_to_string(&build_file).unwrap()
    );
    fs::write(&build_file, &descriptor).unwrap();
    for (class_name, proof_name) in [
        ("ExcludedTest", "excluded-proof.txt"),
        ("OutsideTest", "outside-proof.txt"),
    ] {
        fs::write(
            root.join("src/test/java").join(format!("{class_name}.java")),
            format!(
                "public class {class_name} {{ @org.junit.Test public void caseMethod() throws Exception {{ java.nio.file.Files.writeString(java.nio.file.Path.of(\"{proof_name}\"), \"must not run\"); }} }}\n"
            ),
        )
        .unwrap();
    }

    let home = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME")
        .map(|value| selected_jdk(&value).unwrap())
        .unwrap_or_else(|_| jdk_home().unwrap());
    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "discover");
    launch.configuration.build_tool = "gradle".into();
    launch.configuration.jdk_home = home.to_string_lossy().into_owned();
    state.start(binding.clone(), launch).unwrap();
    let found = finished(&state);
    assert_eq!(found.state, "succeeded", "{}", found.output);
    let discovery = found.test_discovery.as_ref().unwrap();
    assert_eq!(
        discovery.status, "ready",
        "{:?}\n{}",
        discovery, found.output
    );
    let classes = discovery
        .tests
        .iter()
        .map(|test| test.class_name.clone())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(classes, ["DiscoveryTest".to_owned()].into());
    assert!(discovery.tests.iter().any(|test| {
        test.class_name == "DiscoveryTest" && test.method_name.as_deref() == Some("selected")
    }));
    assert!(!root.join("selected-proof.txt").exists());
    assert!(!root.join("companion-proof.txt").exists());
    assert!(!root.join("excluded-proof.txt").exists());
    assert!(!root.join("outside-proof.txt").exists());
    assert_eq!(fs::read_to_string(&build_file).unwrap(), descriptor);
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires Maven, Gradle, a compatible JDK and real JUnit dependencies"]
fn real_discovery_refuses_missing_provider_skipped_helper_and_disabled_dry_run() {
    for mode in ["no-provider", "skipped-helper", "disabled-dry-run"] {
        let kind = if mode == "disabled-dry-run" {
            "gradle"
        } else {
            "maven"
        };
        let (root, binding, descriptor, _) = project(kind, "junit4");
        let descriptor = match mode {
            "no-provider" => { fs::write(root.join("src/test/java/DiscoveryTest.java"),"public class DiscoveryTest {}\n").unwrap(); let start=descriptor.find("<dependencies>").unwrap(); let end=descriptor.find("</dependencies>").unwrap()+"</dependencies>".len(); format!("{}{}", &descriptor[..start],&descriptor[end..]) },
            "skipped-helper" => descriptor.replace("</plugins>","<plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version><configuration><skip>true</skip></configuration></plugin></plugins>"),
            _ => format!("{descriptor}\ntest {{ doFirst {{ dryRun = false }} }}\n"),
        };
        fs::write(
            root.join(if kind == "maven" {
                "pom.xml"
            } else {
                "build.gradle"
            }),
            &descriptor,
        )
        .unwrap();
        let state = JavaExecutionState::default();
        let mut launch = request(&binding, "discover");
        launch.configuration.build_tool = kind.into();
        if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
            launch.configuration.jdk_home = home;
        }
        state.start(binding, launch).unwrap();
        let result = finished(&state);
        assert_eq!(result.state, "failed", "{mode}: {}", result.output);
        assert_eq!(
            result.test_discovery.as_ref().unwrap().status,
            "unavailable"
        );
        assert!(result.test_discovery.as_ref().unwrap().tests.is_empty());
        assert!(result.test_results.is_none());
        if mode == "skipped-helper" {
            assert_eq!(result.exit_code, Some(0), "{}", result.output);
        } else {
            assert!(
                result.exit_code.is_some_and(|code| code != 0),
                "{}",
                result.output
            );
        }
        assert!(!root.join("selected-proof.txt").exists());
        assert!(!root.join("companion-proof.txt").exists());
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires Maven, Gradle, a JDK and real TestNG dependencies"]
fn real_testng_inherited_class_annotations_data_providers_and_failed_rerun() {
    for kind in ["maven", "gradle"] {
        let (root, binding, descriptor, _) = project(kind, "testng");
        let source = |broken: bool| {
            format!(
                r#"import org.testng.annotations.*; import java.nio.file.*;
abstract class InheritedBase {{
  @Test public void inherited() throws Exception {{ Files.writeString(Path.of("inherited-proof.txt"),"selected"); }}
}}
@Test public class DiscoveryTest extends InheritedBase {{
  @BeforeSuite public void setup() throws Exception {{ Files.writeString(Path.of("setup-proof.txt"),"setup"); }}
  @Test(enabled=false) public void disabled() throws Exception {{ Files.writeString(Path.of("disabled-proof.txt"),"unexpected"); throw new AssertionError("disabled"); }}
  @DataProvider public Object[][] values() throws Exception {{ Files.writeString(Path.of("provider-proof.txt"),"initialized"); return new Object[][]{{{{"one"}},{{"two"}}}}; }}
  @Test(dataProvider="values") public void dataDriven(String value) throws Exception {{ Files.writeString(Path.of("data-proof.txt"),value+"\n",StandardOpenOption.CREATE,StandardOpenOption.APPEND); }}
  public void companion() throws Exception {{ Files.writeString(Path.of("companion-proof.txt"),"called\n",StandardOpenOption.CREATE,StandardOpenOption.APPEND); if ({broken}) throw new AssertionError("repair"); }}
  public void dollar$() throws Exception {{ Files.writeString(Path.of("dollar-proof.txt"),"literal method"); }}
  @Test(dependsOnMethods="inherited") public void dependent() throws Exception {{ Files.writeString(Path.of("dependent-proof.txt"),"unexpected execution"); }}
}}
"#
            )
        };
        fs::write(root.join("src/test/java/DiscoveryTest.java"), source(true)).unwrap();
        let home = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME")
            .map(|value| selected_jdk(&value).unwrap())
            .unwrap_or_else(|_| jdk_home().unwrap());
        let state = JavaExecutionState::default();
        let mut launch = request(&binding, "discover");
        launch.configuration.build_tool = kind.into();
        launch.configuration.jdk_home = home.to_string_lossy().into_owned();
        state.start(binding.clone(), launch).unwrap();
        let found = finished(&state);
        assert_eq!(found.state, "succeeded", "{}", found.output);
        let discovery = found.test_discovery.as_ref().unwrap();
        assert_eq!(discovery.status, "ready", "{:?}", discovery);
        for method in [
            "inherited",
            "companion",
            "dataDriven",
            "dollar$",
            "dependent",
        ] {
            assert!(
                discovery
                    .tests
                    .iter()
                    .any(|test| test.class_name == "DiscoveryTest"
                        && test.method_name.as_deref() == Some(method)),
                "{kind}: {method}: {:?}",
                discovery
            );
        }
        assert!(!discovery
            .tests
            .iter()
            .any(|test| test.method_name.as_deref() == Some("disabled")));
        for proof in [
            "inherited-proof.txt",
            "setup-proof.txt",
            "disabled-proof.txt",
            "data-proof.txt",
            "companion-proof.txt",
            "dollar-proof.txt",
            "dependent-proof.txt",
        ] {
            assert!(
                !root.join(proof).exists(),
                "{kind}: discovery executed {proof}"
            );
        }
        // Maven interception omits data-provider execution. Gradle/TestNG's own
        // dry-run may initialize providers while enumerating their cases.
        if kind == "maven" {
            assert!(!root.join("provider-proof.txt").exists());
        }
        let selected = discovery
            .tests
            .iter()
            .find(|test| test.method_name.as_deref() == Some("inherited"))
            .unwrap();
        let mut run = request(&binding, "test");
        run.test_selection = Some(TestSelection {
            discovery_session_id: found.session_id,
            test_id: selected.id.clone(),
        });
        state.start(binding.clone(), run).unwrap();
        let passed = finished(&state);
        assert_eq!(passed.state, "succeeded", "{}", passed.output);
        assert_eq!(passed.test_results.as_ref().unwrap().summary.total, 1);
        assert_eq!(
            fs::read_to_string(root.join("inherited-proof.txt")).unwrap(),
            "selected"
        );
        let mut discover = request(&binding, "discover");
        discover.configuration.build_tool = kind.into();
        discover.configuration.jdk_home = home.to_string_lossy().into_owned();
        state.start(binding.clone(), discover).unwrap();
        let found = finished(&state);
        assert_eq!(found.state, "succeeded", "{}", found.output);
        let literal = found
            .test_discovery
            .as_ref()
            .unwrap()
            .tests
            .iter()
            .find(|test| test.method_name.as_deref() == Some("dollar$"))
            .unwrap();
        let mut selected = request(&binding, "test");
        selected.test_selection = Some(TestSelection {
            discovery_session_id: found.session_id,
            test_id: literal.id.clone(),
        });
        state.start(binding.clone(), selected).unwrap();
        let literal = finished(&state);
        assert_eq!(literal.state, "succeeded", "{}", literal.output);
        assert_eq!(literal.test_results.as_ref().unwrap().summary.total, 1);
        assert_eq!(
            fs::read_to_string(root.join("dollar-proof.txt")).unwrap(),
            "literal method"
        );
        let mut run = request(&binding, "test");
        run.configuration.build_tool = kind.into();
        run.configuration.jdk_home = home.to_string_lossy().into_owned();
        run.configuration.test_filter = "DiscoveryTest#dataDriven".into();
        state.start(binding.clone(), run.clone()).unwrap();
        let data = finished(&state);
        assert_eq!(data.state, "succeeded", "{}", data.output);
        assert_eq!(data.test_results.as_ref().unwrap().summary.total, 2);
        assert_eq!(
            fs::read_to_string(root.join("data-proof.txt")).unwrap(),
            "one\ntwo\n"
        );
        let mut discover = request(&binding, "discover");
        discover.configuration.build_tool = kind.into();
        discover.configuration.jdk_home = home.to_string_lossy().into_owned();
        state.start(binding.clone(), discover).unwrap();
        let found = finished(&state);
        assert_eq!(found.state, "succeeded", "{}", found.output);
        let companion = found
            .test_discovery
            .as_ref()
            .unwrap()
            .tests
            .iter()
            .find(|test| test.method_name.as_deref() == Some("companion"))
            .unwrap();
        let mut selected = request(&binding, "test");
        selected.test_selection = Some(TestSelection {
            discovery_session_id: found.session_id,
            test_id: companion.id.clone(),
        });
        state.start(binding.clone(), selected).unwrap();
        let failed = finished(&state);
        assert_eq!(failed.state, "failed", "{}", failed.output);
        assert_eq!(failed.test_results.as_ref().unwrap().summary.total, 1);
        assert!(failed.test_results.as_ref().unwrap().can_rerun_failed);
        fs::write(root.join("src/test/java/DiscoveryTest.java"), source(false)).unwrap();
        state
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
        let repaired = finished(&state);
        assert_eq!(repaired.state, "succeeded", "{}", repaired.output);
        assert_eq!(repaired.test_results.as_ref().unwrap().summary.total, 1);
        assert_eq!(
            fs::read_to_string(root.join("companion-proof.txt")).unwrap(),
            "called\ncalled\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("data-proof.txt")).unwrap(),
            "one\ntwo\n"
        );
        assert!(!root.join("disabled-proof.txt").exists());
        assert!(!root.join("dependent-proof.txt").exists());
        assert_eq!(
            fs::read_to_string(root.join(if kind == "maven" {
                "pom.xml"
            } else {
                "build.gradle"
            }))
            .unwrap(),
            descriptor
        );
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires Maven, Gradle, a JDK and the real TestNG 6.13.1 dependency"]
fn real_tools_refuse_testng_before_documented_dry_run_support() {
    for kind in ["maven", "gradle"] {
        let (root, binding, descriptor, source) = project(kind, "testng");
        let file = if kind == "maven" {
            "pom.xml"
        } else {
            "build.gradle"
        };
        fs::write(root.join(file), descriptor.replace("7.10.2", "6.13.1")).unwrap();
        let state = JavaExecutionState::default();
        let mut discover = request(&binding, "discover");
        discover.configuration.build_tool = kind.into();
        if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
            discover.configuration.jdk_home = home;
        }
        state.start(binding, discover).unwrap();
        let found = finished(&state);
        assert_eq!(found.state, "failed", "{kind}: {}", found.output);
        assert_eq!(found.test_discovery.as_ref().unwrap().status, "unavailable");
        if kind == "maven" {
            assert!(
                found
                    .output
                    .contains("identifiable TestNG version 6.14 or later"),
                "{}",
                found.output
            );
        }
        assert!(!root.join("selected-proof.txt").exists(), "{kind}");
        assert!(!root.join("companion-proof.txt").exists(), "{kind}");
        assert_eq!(
            fs::read_to_string(root.join("src/test/java/DiscoveryTest.java")).unwrap(),
            source
        );
        assert_eq!(
            fs::read_to_string(root.join(file)).unwrap(),
            descriptor.replace("7.10.2", "6.13.1")
        );
        state.shutdown_all();
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
#[ignore = "requires Maven, JDK 21 and cached JUnit 4 dependencies"]
fn real_maven_discovery_uses_only_the_effective_module_test_output() {
    let (root, binding, descriptor, _) = project("maven", "junit4");
    let module = root.join("app");
    fs::create_dir(&module).unwrap();
    fs::rename(root.join("src"), module.join("src")).unwrap();
    fs::create_dir_all(module.join("src/main/java")).unwrap();
    fs::write(
        module.join("src/main/java/ProductionProbe.java"),
        "public class ProductionProbe { @org.junit.Test public void mainOutputOnly() { throw new AssertionError(); } }",
    ).unwrap();
    fs::write(
        module.join("pom.xml"),
        descriptor.replace("<scope>test</scope>", "").replace(
            "<build>",
            "<build><testOutputDirectory>${project.basedir}/custom/test classes</testOutputDirectory>",
        ),
    ).unwrap();
    fs::write(
        root.join("pom.xml"),
        "<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>reactor</artifactId><version>1</version><packaging>pom</packaging><modules><module>app</module></modules></project>",
    ).unwrap();

    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "discover");
    launch.configuration.build_tool = "maven".into();
    launch.configuration.project_path = "app".into();
    state.start(binding.clone(), launch.clone()).unwrap();
    let discovered = finished(&state);
    assert_eq!(discovered.state, "succeeded", "{}", discovered.output);
    let tests = discovered.test_discovery.unwrap();
    assert_eq!(tests.status, "ready");
    assert!(tests.tests.iter().all(|test| test.class_name == "DiscoveryTest"));
    assert_eq!(
        tests.tests.iter().filter_map(|test| test.method_name.as_deref()).collect::<BTreeSet<_>>(),
        BTreeSet::from(["companion", "selected"]),
    );
    assert!(module.join("target/classes/ProductionProbe.class").is_file());
    assert!(module.join("custom/test classes/DiscoveryTest.class").is_file());
    for marker in ["selected-proof.txt", "companion-proof.txt"] {
        assert!(!module.join(marker).exists(), "{marker}");
    }

    // The manual reactor root must not compile or discover another module.
    fs::remove_dir_all(module.join("custom")).unwrap();
    launch.configuration.project_path.clear();
    state.start(binding, launch).unwrap();
    let root_discovery = finished(&state);
    assert_eq!(root_discovery.state, "failed", "{}", root_discovery.output);
    assert_eq!(root_discovery.test_discovery.unwrap().status, "unavailable");
    assert!(!module.join("custom").exists());
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires Maven, JDK 21 and cached JUnit 4 dependencies"]
fn real_maven_captured_discovery_keeps_aggregator_test_launch_non_recursive() {
    let (root, binding, descriptor, source) = project("maven", "junit4");
    let module = root.join("child");
    fs::create_dir_all(module.join("src/test/java")).unwrap();
    fs::write(
        module.join("pom.xml"),
        descriptor.replace("<artifactId>discovery</artifactId>", "<artifactId>nested</artifactId>"),
    ).unwrap();
    fs::write(module.join("src/test/java/DiscoveryTest.java"), &source).unwrap();
    let aggregator = descriptor
        .replace("<version>1</version>", "<version>1</version><packaging>pom</packaging><modules><module>child</module></modules>")
        .replace("<build>", "<build><testOutputDirectory>${project.basedir}/custom/test classes</testOutputDirectory>")
        .replace("<version>3.14.1</version>", "<version>3.14.1</version><executions><execution><phase>test-compile</phase><goals><goal>testCompile</goal></goals></execution></executions>")
        .replace("<version>3.5.3</version>", "<version>3.5.3</version><executions><execution><phase>test</phase><goals><goal>test</goal></goals></execution></executions>");
    fs::write(root.join("pom.xml"), &aggregator).unwrap();

    let state = JavaExecutionState::default();
    let mut launch = request(&binding, "discover");
    launch.configuration.build_tool = "maven".into();
    launch.configuration.test_jvm_options = vec!["-Dfixture.discovery=captured 😀".into()];
    launch.configuration.environment = vec![EnvironmentVariable {
        name: "DISCOVERY_MODE".into(),
        value: "captured module".into(),
    }];
    state.start(binding.clone(), launch.clone()).unwrap();
    let discovery = finished(&state);
    assert_eq!(discovery.state, "succeeded", "{}", discovery.output);
    let list = discovery.test_discovery.unwrap();
    assert_eq!(list.status, "ready");
    let selected = list.tests.iter().find(|test| {
        test.class_name == "DiscoveryTest" && test.method_name.as_deref() == Some("selected")
    }).expect("the aggregator's own test is discoverable");
    assert!(root.join("custom/test classes/DiscoveryTest.class").is_file());
    assert!(!module.join("target").exists());
    assert!(!root.join("selected-proof.txt").exists());

    let mut run = request(&binding, "test");
    run.configuration.project_path = "child".into();
    run.test_selection = Some(TestSelection {
        discovery_session_id: discovery.session_id,
        test_id: selected.id.clone(),
    });
    state.start(binding.clone(), run).unwrap();
    let tested = finished(&state);
    assert_eq!(tested.state, "succeeded", "{}", tested.output);
    assert!(!module.join("target").exists(), "the nested test ran: {}", tested.output);
    let results = tested.test_results.unwrap();
    assert_eq!(results.summary.passed, 1);
    assert_eq!(results.suites[0].report_path, "target/surefire-reports/TEST-DiscoveryTest.xml");
    assert!(fs::read_to_string(root.join("selected-proof.txt")).unwrap().ends_with("\ncaptured module"));
    assert!(!root.join("companion-proof.txt").exists());

    fs::remove_file(root.join("selected-proof.txt")).unwrap();
    state.restart(binding.clone(), RestartRequest {
        workspace_id: binding.workspace_id.clone(),
        generation: 1,
        session_id: tested.session_id,
        trusted: true,
        source_breakpoints: vec![],
    }).unwrap();
    let repeated = finished(&state);
    assert_eq!(repeated.state, "succeeded", "{}", repeated.output);
    assert!(root.join("selected-proof.txt").is_file());
    assert!(!module.join("target").exists());
    launch.operation = "test".into();
    launch.configuration.test_filter = "DiscoveryTest#selected".into();
    state.start(binding, launch).unwrap();
    let reactor_test = finished(&state);
    assert_eq!(reactor_test.state, "succeeded", "{}", reactor_test.output);
    assert_eq!(reactor_test.test_results.unwrap().summary.passed, 2);
    assert!(module.join("selected-proof.txt").is_file());
    assert_eq!(fs::read_to_string(root.join("pom.xml")).unwrap(), aggregator);
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
