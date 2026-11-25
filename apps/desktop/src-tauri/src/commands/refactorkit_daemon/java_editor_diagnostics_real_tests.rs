use super::*;
use std::process::Command;

#[test]
#[ignore = "requires sealed SDK25 diagnostics daemon and selected full JDK25"]
fn real_java25_compact_editor_diagnostics_preserve_sdk_provenance_and_inputs() {
    qualify_compact_editor_diagnostics(false, 25);
}

#[test]
#[ignore = "requires SDK25 diagnostics daemon, JDK25, real Gradle and explicit evaluation"]
fn real_gradle_java25_compact_editor_diagnostics_preserve_sdk_provenance_and_inputs() {
    qualify_compact_editor_diagnostics(true, 25);
}

#[test]
#[ignore = "requires isolated SDK26 review candidate and selected full JDK26; no default adoption"]
fn real_java26_compact_editor_diagnostics_preserve_sdk_provenance_and_inputs() {
    qualify_compact_editor_diagnostics(false, 26);
}

fn qualify_compact_editor_diagnostics(gradle: bool, release: u32) {
    use super::super::super::{java_editor_diagnostics, java_navigation};
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var(
        "IDE_REFACTORKIT_DAEMON",
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Select the sealed daemon"),
    );
    let sdk = PathBuf::from(
        std::env::var_os("IDE_JAVA_CONTEXT_TEST_JDK").expect("Select the full project JDK"),
    )
    .canonicalize()
    .unwrap();
    assert!(fs::read_to_string(sdk.join("release"))
        .unwrap()
        .contains(&format!("JAVA_VERSION=\"{release}")));
    let release_text = release.to_string();
    let f = Fixture::new();
    let sources = [
        ("record.java", "void main() { int value = 1; }\n"),
        ("var.java", "void main() { int value = 2; }\n"),
        ("yield.java", "void main() { int value = 3; }\n"),
    ];
    fs::create_dir_all(f.root.join("src/main/java")).unwrap();
    for (name, source) in sources {
        fs::write(f.root.join("src/main/java").join(name), source).unwrap();
    }
    let pom = "<project><modelVersion>4.0.0</modelVersion><groupId>consumer</groupId><artifactId>compact</artifactId><version>1</version><properties><maven.compiler.release>25</maven.compiler.release></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>";
    let build_inputs = if gradle {
        vec![
            ("settings.gradle", "rootProject.name = 'compact-diagnostics'\n".to_string()),
            ("build.gradle", "plugins { id 'java' }\njava { toolchain { languageVersion = JavaLanguageVersion.of(25) } }\ntasks.withType(JavaCompile).configureEach { options.release = 25 }\nfile('evaluation-count.txt').append('evaluated\\n')\n".to_string()),
            ("gradle.properties", format!("org.gradle.daemon=false\norg.gradle.workers.max=2\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\norg.gradle.java.installations.paths={}\n", sdk.display())),
        ]
    } else {
        vec![(
            "pom.xml",
            pom.replace(
                "<maven.compiler.release>25",
                &format!("<maven.compiler.release>{release}"),
            ),
        )]
    };
    for (name, content) in &build_inputs {
        fs::write(f.root.join(name), content).unwrap();
    }
    let output = f.root.join(if gradle {
        "build/classes/java/main"
    } else {
        "target/classes"
    });
    fs::create_dir_all(&output).unwrap();
    let sentinel = output.join("unchanged.class");
    fs::write(&sentinel, b"existing build output").unwrap();
    let original_mtime = fs::metadata(&sentinel).unwrap().modified().unwrap();
    let state = JavaProjectContextState::default();
    let mut context_request = f.request();
    context_request.sdk_home = sdk.to_string_lossy().into_owned();
    if release == 26 {
        context_request.provider_id = Some("maven-effective-v1".into());
        context_request.module_id =
            Some(f.root.file_name().unwrap().to_string_lossy().into_owned());
        context_request.source_set_id = Some("main".into());
    }
    if gradle {
        context_request.gradle = Some(GradleSettings {
            executable: std::env::var("IDE_JAVA_CONTEXT_TEST_GRADLE").expect("Select real Gradle"),
            user_home: f
                .root
                .join(".ide/gradle-cache")
                .to_string_lossy()
                .into_owned(),
            gradle_runtime_home: Some(
                std::env::var("IDE_JAVA_CONTEXT_GRADLE_JDK")
                    .expect("Select the Gradle runtime separately"),
            ),
            project_properties: BTreeMap::new(),
        });
        context_request.evaluate_gradle = Some(true);
    }
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let acquired = query_owned(
        f.binding.clone(),
        context_request.clone(),
        state.shared(),
        ticket,
    )
    .unwrap();
    if let Some(path) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
        let mut context_path = path;
        context_path.push(".context.json");
        fs::write(context_path, serde_json::to_vec_pretty(&acquired).unwrap()).unwrap();
    }
    assert_eq!(acquired["status"], "available", "{acquired}");
    if release == 26 {
        assert_eq!(
            acquired["context"]["schemaVersion"],
            "java-project-context-v7"
        );
    }
    let evaluations = gradle.then(|| fs::read(f.root.join("evaluation-count.txt")).unwrap());
    let context = &acquired["context"];
    let mut project = json!({"projectPath":"", "sdkHome":context_request.sdk_home, "mavenRepository":"", "activeMavenProfiles":[], "inactiveMavenProfiles":[],
        "snapshotHash":context["snapshotHash"], "contextHash":context["contextHash"], "contextSchemaVersion":context["schemaVersion"],
        "platformIdentities":context["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()});
    if let Some(settings) = &context_request.gradle {
        project["gradle"] = serde_json::to_value(settings).unwrap();
    }
    let nav = java_navigation::JavaNavigationState::new(&state);
    // The independent compiler oracle has its own workspace and output directory.
    let oracle = Fixture::new();
    fs::create_dir_all(oracle.root.join("classes")).unwrap();
    for (name, source) in sources {
        fs::write(oracle.root.join(name), source).unwrap();
    }
    let cases = [
        (sources[0].1, true),
        ("void main() { int value = missingCompactValue; }\n", false),
        ("class record {}\n", false),
        (sources[0].1, true),
    ];
    let mut evidence = Vec::new();
    for (index, (text, valid)) in cases.into_iter().enumerate() {
        fs::write(oracle.root.join("record.java"), text).unwrap();
        let compiled = Command::new(sdk.join("bin/javac"))
            .current_dir(&oracle.root)
            .args([
                "--release",
                &release_text,
                "-proc:none",
                "-d",
                "classes",
                "record.java",
                "var.java",
                "yield.java",
            ])
            .output()
            .unwrap();
        assert_eq!(
            compiled.status.success(),
            valid,
            "{}",
            String::from_utf8_lossy(&compiled.stderr)
        );
        let request = json!({"workspaceId":f.binding.workspace_id, "generation":1, "requestId":format!("compact-errors-{index}"), "projectContext":project,
            "document":{"path":"src/main/java/record.java", "text":text, "version":index+1}, "limit":500,
            "editorOverlay":{"documents":[{"path":"src/main/java/record.java", "text":text, "version":index+1}]}});
        let typed: java_editor_diagnostics::Request =
            serde_json::from_value(request.clone()).unwrap();
        let result = java_navigation::query_at(
            f.binding.clone(),
            java_navigation::JavaNavigationRequest::editor_diagnostics(typed),
            &nav,
        )
        .unwrap();
        evidence.push(json!({"request":request,"result":result,"javacOracle":{"success":compiled.status.success(),"stderr":String::from_utf8_lossy(&compiled.stderr)}}));
        if let Some(path) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(path, serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
        }
        assert_eq!(result["status"], "ready", "{result}");
        assert_eq!(
            result["provider"]["id"], "java-sdk-compiler-diagnostics-v1",
            "{result}"
        );
        assert_eq!(
            result["provider"]["backend"],
            format!("jdk{release}-javac-compiler-errors-v1"),
            "{result}"
        );
        assert_eq!(result["analyzedSourceCount"], 3, "{result}");
        assert_eq!(result["total"].as_u64().unwrap() == 0, valid, "{result}");
        if index == 1 {
            assert!(
                result["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|item| item["message"]
                        .as_str()
                        .is_some_and(|message| message.contains("missingCompactValue"))),
                "The unsaved body error must be diagnosed: {result}"
            );
        }
        for item in result["items"].as_array().unwrap() {
            assert!(
                item["code"]
                    .as_str()
                    .unwrap()
                    .starts_with("java.javac.compiler.err."),
                "{item}"
            );
            assert_eq!(item["location"]["path"], "src/main/java/record.java");
        }
        for (name, source) in sources {
            assert_eq!(
                fs::read_to_string(f.root.join("src/main/java").join(name)).unwrap(),
                source
            );
        }
        for (name, content) in &build_inputs {
            assert_eq!(fs::read_to_string(f.root.join(name)).unwrap(), *content);
        }
        if let Some(expected) = &evaluations {
            assert_eq!(
                fs::read(f.root.join("evaluation-count.txt")).unwrap(),
                *expected
            );
        }
        assert_eq!(fs::read(&sentinel).unwrap(), b"existing build output");
        assert_eq!(
            fs::metadata(&sentinel).unwrap().modified().unwrap(),
            original_mtime
        );
        let outputs: Vec<_> = fs::read_dir(&output).unwrap().collect();
        assert_eq!(outputs.len(), 1, "Diagnostics must not emit class files");
    }
    decode_editor_diagnostics_evidence(&f.root, &json!(evidence), "ready");
    nav.shutdown_all();
    state.shutdown_all();
}

#[test]
#[ignore = "requires qualified immutable Java diagnostics daemon and selected full JDK"]
fn real_java_editor_diagnostics_distinguish_sdk_api_and_capture_companion_errors() {
    qualify_editor_diagnostics(BuildToolFixture::Maven, false);
}

#[test]
#[ignore = "requires qualified immutable Java diagnostics daemon and selected full JDK"]
fn real_java_editor_diagnostics_report_duplicate_type_in_saved_companion() {
    qualify_editor_diagnostics(BuildToolFixture::Maven, true);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, selected JDK and real Gradle with explicit evaluation"]
fn real_gradle_editor_diagnostics_distinguish_sdk_api_and_capture_companion_errors() {
    qualify_editor_diagnostics(BuildToolFixture::Gradle, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, selected JDK and real Gradle with explicit evaluation"]
fn real_gradle_editor_diagnostics_report_duplicate_type_in_saved_companion() {
    qualify_editor_diagnostics(BuildToolFixture::Gradle, true);
}

#[test]
#[ignore = "requires qualified immutable diagnostics daemon and selected full JDK 27"]
fn real_java27_editor_diagnostics_refuse_unqualified_maven_source_and_retain_metadata() {
    qualify_editor_diagnostics(BuildToolFixture::MavenUnqualifiedSource, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, JDK 27 and explicit Gradle evaluation"]
fn real_java27_editor_diagnostics_refuse_unqualified_gradle_source_and_retain_metadata() {
    qualify_editor_diagnostics(BuildToolFixture::GradleUnqualifiedSource, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, selected JDK and real Maven reactor resolution"]
fn real_maven_reactor_editor_diagnostics_capture_cross_module_companion_errors() {
    qualify_editor_diagnostics(BuildToolFixture::MavenReactor, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, selected JDK and explicit Gradle multi-project evaluation"]
fn real_gradle_multi_project_editor_diagnostics_capture_cross_module_companion_errors() {
    qualify_editor_diagnostics(BuildToolFixture::GradleMultiProject, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon and selected JDK; parent Maven build evidence must be complete"]
fn real_maven_reactor_editor_context_retains_parent_build_evidence() {
    qualify_editor_diagnostics(BuildToolFixture::MavenReactorParentEvidence, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, selected JDK and cached JUnit Jupiter test dependency"]
fn real_maven_test_editor_diagnostics_keep_junit_on_test_classpath() {
    qualify_editor_diagnostics(BuildToolFixture::MavenTestSources, false);
}

#[test]
#[ignore = "requires qualified diagnostics daemon, selected JDK, cached JUnit and explicit Gradle evaluation"]
fn real_gradle_test_editor_diagnostics_keep_junit_on_test_classpath() {
    qualify_editor_diagnostics(BuildToolFixture::GradleTestSources, false);
}

#[derive(Clone, Copy)]
enum BuildToolFixture {
    Maven,
    MavenUnqualifiedSource,
    MavenTestSources,
    MavenReactor,
    MavenReactorParentEvidence,
    Gradle,
    GradleUnqualifiedSource,
    GradleTestSources,
    GradleMultiProject,
}

fn qualify_editor_diagnostics(build_tool: BuildToolFixture, duplicate_types: bool) {
    let gradle = matches!(
        build_tool,
        BuildToolFixture::Gradle
            | BuildToolFixture::GradleUnqualifiedSource
            | BuildToolFixture::GradleTestSources
            | BuildToolFixture::GradleMultiProject
    );
    let unqualified_source = matches!(
        build_tool,
        BuildToolFixture::MavenUnqualifiedSource | BuildToolFixture::GradleUnqualifiedSource
    );
    let multi_module = matches!(
        build_tool,
        BuildToolFixture::MavenReactor
            | BuildToolFixture::MavenReactorParentEvidence
            | BuildToolFixture::GradleMultiProject
    );
    let test_sources = matches!(
        build_tool,
        BuildToolFixture::MavenTestSources | BuildToolFixture::GradleTestSources
    );
    assert!(!(multi_module || test_sources) || !duplicate_types);
    use super::super::super::{java_editor_diagnostics, java_navigation};
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            if let Some(value) = &self.0 {
                std::env::set_var("IDE_REFACTORKIT_DAEMON", value);
            } else {
                std::env::remove_var("IDE_REFACTORKIT_DAEMON");
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var(
        "IDE_REFACTORKIT_DAEMON",
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON")
            .expect("Select the frozen qualified daemon"),
    );
    let sdk =
        PathBuf::from(std::env::var_os("IDE_JAVA_CONTEXT_TEST_JDK").expect("Select a full JDK"))
            .canonicalize()
            .unwrap();
    let restricted = !duplicate_types
        && std::env::var("IDE_JAVA_ERRORS_USE_RELEASE")
            .or_else(|_| std::env::var("IDE_JAVA_ERRORS_RELEASE8"))
            .as_deref()
            == Ok("1");
    let source_release: u64 = std::env::var("IDE_JAVA_ERRORS_SOURCE_RELEASE")
        .unwrap_or_else(|_| if unqualified_source { "27" } else { "8" }.to_string())
        .parse()
        .expect("Select a numeric language release");
    let source_release_text = source_release.to_string();
    let sdk_release = fs::read_to_string(sdk.join("release"))
        .unwrap()
        .lines()
        .find_map(|line| {
            line.strip_prefix("JAVA_VERSION=\"")
                .and_then(|value| value.strip_prefix("1.").unwrap_or(value)
                    .split(['.', '\"', '-', '_', '+']).next())
                .and_then(|value| value.parse::<u64>().ok())
        })
        .unwrap();
    assert!(
        (8..=sdk_release).contains(&source_release),
        "Language release must be supported by the selected compiler"
    );
    if unqualified_source {
        assert_eq!((sdk_release, source_release), (27, 27));
    }
    let f = Fixture::new();
    let (main_path, helper_path, main, helper) = if multi_module {
        ("app/src/main/java/example/Main.java", "library/src/main/java/library/Helper.java",
         "package example; import library.Helper; public class Main { int run() { return Helper.value(); } }\n",
         "package library; public class Helper { public static int value() { return 1; } }\n")
    } else if test_sources {
        ("src/test/java/example/MainTest.java", "src/main/java/example/Helper.java",
         "package example; public class MainTest { @org.junit.jupiter.api.Test void verifies() { if (Helper.value() != 1) throw new AssertionError(); } int run() { return Helper.value(); } }\n",
         "package example; class Helper { static int value() { return 1; } }\n")
    } else {
        (
            "src/main/java/example/Main.java",
            "src/main/java/example/Helper.java",
            "package example; public class Main { int run() { return Helper.value(); } }\n",
            "package example; class Helper { static int value() { return 1; } }\n",
        )
    };
    let primary_file = Path::new(main_path).file_name().unwrap().to_str().unwrap();
    let test_repository = test_sources.then(|| {
        PathBuf::from(
            std::env::var_os("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY")
                .expect("Select the cached Maven repository"),
        )
    });
    let junit_api = test_repository.as_ref().map(|root| {
        root.join("org/junit/jupiter/junit-jupiter-api/5.11.4/junit-jupiter-api-5.11.4.jar")
    });
    if let Some(jar) = &junit_api {
        assert!(
            jar.is_file(),
            "JUnit Jupiter API 5.11.4 must already be cached"
        );
    }
    let modern_sdk_api = sdk_release >= 25 && !duplicate_types;
    let newer_thread_api =
        sdk_release >= 21 && (9..21).contains(&source_release) && !modern_sdk_api;
    let mut api_statements = vec!["java.util.List.of(\"SDK API\");"];
    if modern_sdk_api {
        api_statements.push("java.lang.classfile.ClassFile modern = null;");
    }
    if newer_thread_api {
        api_statements.push("Thread.ofVirtual();");
    }
    api_statements.push("return Helper");
    let dirty_main = main.replace("return Helper", &api_statements.join(" "));
    let expected_api = if restricted { source_release } else { sdk_release };
    let api_error_count = usize::from(expected_api < 9)
        + usize::from(modern_sdk_api && expected_api < 24)
        + usize::from(newer_thread_api && expected_api < 21);
    let dirty_helper = helper.replace("return 1", "return \"wrong type\"");
    // Keep the independent javac oracle outside the provider workspace.
    struct Oracle(std::path::PathBuf);
    impl Drop for Oracle {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let oracle = Oracle(std::env::temp_dir().join(format!(
            "ide-java-errors-oracle-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )));
    fs::create_dir_all(oracle.0.join("classes")).unwrap();
    fs::write(oracle.0.join(primary_file), &dirty_main).unwrap();
    fs::write(oracle.0.join("Helper.java"), helper).unwrap();
    if duplicate_types {
        fs::write(
            oracle.0.join("Other.java"),
            helper.replace("return 1", "return 2"),
        )
        .unwrap();
    }
    let options = if restricted && sdk_release >= 9 {
        vec!["--release", source_release_text.as_str()]
    } else {
        vec![
            "-source",
            source_release_text.as_str(),
            "-target",
            source_release_text.as_str(),
        ]
    };
    let mut compiler = Command::new(sdk.join("bin/javac"));
    compiler.current_dir(&oracle.0).args(&options).args([
        "-d",
        "classes",
        primary_file,
        "Helper.java",
    ]);
    if let Some(jar) = &junit_api {
        compiler.arg("-classpath").arg(jar);
    }
    if duplicate_types {
        compiler.arg("Other.java");
    }
    let compiled = compiler.output().unwrap();
    assert_eq!(
        compiled.status.success(),
        api_error_count == 0 && !duplicate_types,
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let cross_module_oracle = if multi_module {
        let signature_helper = helper
            .replace("int value()", "String value()")
            .replace("return 1", "return \"changed\"");
        fs::write(oracle.0.join("Helper.java"), &signature_helper).unwrap();
        fs::write(oracle.0.join(primary_file), main).unwrap();
        let compile = || {
            Command::new(sdk.join("bin/javac"))
                .current_dir(&oracle.0)
                .args(&options)
                .args(["-d", "classes", primary_file, "Helper.java"])
                .output()
                .unwrap()
        };
        let invalid = compile();
        assert!(
            !invalid.status.success(),
            "A String-returning library must invalidate its int caller"
        );
        fs::write(
            oracle.0.join(primary_file),
            main.replace("int run()", "String run()"),
        )
        .unwrap();
        let repaired = compile();
        assert!(
            repaired.status.success(),
            "{}",
            String::from_utf8_lossy(&repaired.stderr)
        );
        Some(
            json!({"oldCallerCompiled":invalid.status.success(),"oldCallerStderr":String::from_utf8_lossy(&invalid.stderr),"repairedCallerCompiled":repaired.status.success()}),
        )
    } else {
        None
    };
    let test_classpath_oracle = if let Some(jar) = &junit_api {
        let isolated_helper = helper.replace(
            "static int value()",
            "org.junit.jupiter.api.Test testOnly; static int value()",
        );
        fs::write(oracle.0.join("Helper.java"), isolated_helper).unwrap();
        let compile = |classpath: &str| {
            Command::new(sdk.join("bin/javac"))
                .current_dir(&oracle.0)
                .args([
                    "--release",
                    source_release_text.as_str(),
                    "-classpath",
                    classpath,
                    "-d",
                    "classes",
                    "Helper.java",
                ])
                .output()
                .unwrap()
        };
        let main_only = compile("");
        let test = compile(jar.to_str().unwrap());
        assert!(
            !main_only.status.success(),
            "JUnit must be unresolved without the test dependency"
        );
        assert!(
            test.status.success(),
            "{}",
            String::from_utf8_lossy(&test.stderr)
        );
        Some(
            json!({"mainClasspathCompiled":main_only.status.success(),"mainClasspathStderr":String::from_utf8_lossy(&main_only.stderr),"testClasspathCompiled":test.status.success()}),
        )
    } else {
        None
    };
    fs::create_dir_all(f.root.join(main_path).parent().unwrap()).unwrap();
    fs::create_dir_all(f.root.join(helper_path).parent().unwrap()).unwrap();
    fs::write(f.root.join(main_path), main).unwrap();
    fs::write(f.root.join(helper_path), helper).unwrap();
    if duplicate_types {
        fs::write(
            f.root.join("src/main/java/example/Other.java"),
            helper.replace("return 1", "return 2"),
        )
        .unwrap();
    }
    let mode = if restricted {
        format!("<maven.compiler.release>{source_release}</maven.compiler.release>")
    } else {
        format!("<maven.compiler.source>{source_release}</maven.compiler.source><maven.compiler.target>{source_release}</maven.compiler.target>")
    };
    let mut pom = format!("<project><modelVersion>4.0.0</modelVersion><groupId>consumer</groupId><artifactId>app</artifactId><version>1</version><properties>{mode}</properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>");
    if test_sources {
        pom = pom.replace("<properties>", "<dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter-api</artifactId><version>5.11.4</version><scope>test</scope></dependency></dependencies><properties>");
    }
    let build_inputs = if gradle {
        let compiler = if restricted {
            format!("options.release = {source_release}")
        } else {
            let level = if source_release == 8 {
                "1.8".to_string()
            } else {
                source_release_text.clone()
            };
            format!("sourceCompatibility = '{level}'; targetCompatibility = '{level}'")
        };
        let java = format!("java {{ toolchain {{ languageVersion = JavaLanguageVersion.of({sdk_release}) }} }}\ntasks.withType(JavaCompile).configureEach {{ {compiler} }}\n");
        let mut build = if multi_module {
            format!("subprojects {{ apply plugin: 'java'\n{java} }}\nproject(':app') {{ dependencies {{ implementation project(':library') }} }}\nfile('evaluation-count.txt').append('evaluated\\n')\n")
        } else {
            format!("plugins {{ id 'java' }}\n{java}file('evaluation-count.txt').append('evaluated\\n')\n")
        };
        if let Some(repository) = &test_repository {
            let location = repository
                .to_str()
                .unwrap()
                .replace('\\', "\\\\")
                .replace('\'', "\\'");
            build.push_str(&format!("repositories {{ maven {{ url = uri('{location}') }} }}\ndependencies {{ testImplementation 'org.junit.jupiter:junit-jupiter-api:5.11.4' }}\n"));
        }
        vec![
            ("settings.gradle", format!("rootProject.name = 'editor-diagnostics'\n{}", if multi_module {"include 'library', 'app'\n"} else {""})),
            ("build.gradle", build),
            ("gradle.properties", format!("org.gradle.daemon=false\norg.gradle.workers.max=2\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\norg.gradle.java.installations.paths={}\n",sdk.display())),
        ]
    } else if multi_module {
        let root = pom.replace("<artifactId>app</artifactId>", "<artifactId>reactor</artifactId><packaging>pom</packaging><modules><module>library</module><module>app</module></modules>");
        let parent = "<parent><groupId>consumer</groupId><artifactId>reactor</artifactId><version>1</version></parent>";
        vec![
            ("pom.xml", root),
            ("library/pom.xml", format!("<project><modelVersion>4.0.0</modelVersion>{parent}<artifactId>library</artifactId></project>")),
            ("app/pom.xml", format!("<project><modelVersion>4.0.0</modelVersion>{parent}<artifactId>app</artifactId><dependencies><dependency><groupId>consumer</groupId><artifactId>library</artifactId><version>1</version></dependency></dependencies></project>")),
        ]
    } else {
        vec![("pom.xml", pom)]
    };
    for (name, contents) in &build_inputs {
        fs::write(f.root.join(name), contents).unwrap();
    }

    let state = JavaProjectContextState::default();
    let mut context_request = f.request();
    context_request.sdk_home = sdk.to_string_lossy().into_owned();
    if let Some(repository) = &test_repository {
        context_request.maven_repository = repository.to_string_lossy().into_owned();
    }
    if gradle {
        context_request.gradle = Some(GradleSettings {
            executable: std::env::var("IDE_JAVA_CONTEXT_TEST_GRADLE")
                .expect("Set the real Gradle executable"),
            user_home: f
                .root
                .join(".ide/gradle-cache")
                .to_string_lossy()
                .into_owned(),
            gradle_runtime_home: Some(
                std::env::var("IDE_JAVA_CONTEXT_GRADLE_JDK")
                    .expect("Set the Gradle runtime JDK separately"),
            ),
            project_properties: BTreeMap::new(),
        });
        context_request.evaluate_gradle = Some(true);
    }

    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let acquired = query_owned(
        f.binding.clone(),
        context_request.clone(),
        state.shared(),
        ticket,
    )
    .unwrap();
    if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
        let mut probe = output;
        probe.push(".context.json");
        fs::write(probe,serde_json::to_vec_pretty(&json!({"buildTool":if gradle {"gradle"} else {"maven"},"multiModule":multi_module,"testSources":test_sources,"restricted":restricted,"languageRelease":source_release,"sdkHome":sdk,"javacOracle":{"compiled":compiled.status.success(),"stderr":String::from_utf8_lossy(&compiled.stderr)},"ideContextRequest":{"projectPath":context_request.project_path,"sdkHome":context_request.sdk_home,"mavenRepository":context_request.maven_repository,"workspaceId":context_request.workspace_id,"generation":context_request.generation,"requestId":context_request.request_id},"acquired":acquired})).unwrap()).unwrap();
    }
    assert_eq!(acquired["status"], "available", "{acquired}");
    let context = &acquired["context"];
    if matches!(build_tool, BuildToolFixture::MavenReactorParentEvidence) {
        let expected = ["pom.xml", "library/pom.xml", "app/pom.xml"];
        let paths: Vec<_> = context["buildEvidence"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|entry| entry["path"].as_str())
            .collect();
        let complete = expected.iter().all(|path| paths.contains(path));
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output, serde_json::to_vec_pretty(&json!({"case":"Maven reactor parent build evidence","expected":expected,"actual":paths,"complete":complete,"context":context})).unwrap()).unwrap();
        }
        state.shutdown_all();
        assert!(
            complete,
            "Maven parent and child POMs must all be captured as build inputs: {paths:?}"
        );
        return;
    }
    for sdk in context["sdk"].as_array().unwrap() {
        assert_eq!(sdk["sourceRelease"], expected_api, "{context}");
    }
    if test_sources {
        let sets: Vec<_> = context["modules"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|module| module["sourceSets"].as_array().unwrap())
            .collect();
        for kind in ["main", "test"] {
            let set = sets
                .iter()
                .find(|set| set["kind"] == kind)
                .expect("main and test source sets");
            let includes_junit = set["compileClasspath"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| {
                    entry["path"]
                        .as_str()
                        .is_some_and(|path| path.contains("junit-jupiter-api"))
                });
            assert_eq!(includes_junit, kind == "test", "{set}");
        }
    }
    let evaluations = if gradle {
        Some(
            fs::read(f.root.join("evaluation-count.txt"))
                .expect("Explicit Gradle synchronization must evaluate the fixture"),
        )
    } else {
        None
    };

    let mut project = json!({"projectPath":"","sdkHome":context_request.sdk_home,"mavenRepository":context_request.maven_repository,
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],
        "contextSchemaVersion":context["schemaVersion"],"platformIdentities":context["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()});
    if let Some(settings) = &context_request.gradle {
        project["gradle"] = serde_json::to_value(settings).unwrap();
    }
    let nav = java_navigation::JavaNavigationState::new(&state);
    let pid = state
        .0
        .active
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .session
        .child
        .id();
    let run = |request: Value| {
        let request: java_editor_diagnostics::Request = serde_json::from_value(request).unwrap();
        java_navigation::query_at(
            f.binding.clone(),
            java_navigation::JavaNavigationRequest::editor_diagnostics(request),
            &nav,
        )
        .unwrap()
    };
    let mut request = json!({"workspaceId":f.binding.workspace_id,"generation":1,"requestId":"java-errors-dirty","projectContext":project,
        "document":{"path":main_path,"text":dirty_main,"version":41},"limit":500,
        "editorOverlay":{"documents":[{"path":main_path,"text":dirty_main,"version":41},{"path":helper_path,"text":dirty_helper,"version":42}]}});
    if duplicate_types {
        request["document"]["text"] = json!(main);
        request["editorOverlay"]["documents"][0]["text"] = json!(main);
        request["editorOverlay"]["documents"][1]["text"] = json!(helper);
        let result = run(request.clone());
        if let Some(path) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(path, serde_json::to_vec_pretty(&json!({"case":"duplicate type in saved companion","request":request,"result":result,
                "javacOracle":{"compiled":compiled.status.success(),"stderr":String::from_utf8_lossy(&compiled.stderr)}})).unwrap()).unwrap();
        }
        assert_eq!(result["status"], "ready", "{result}");
        assert!(
            result["total"].as_u64().is_some_and(|count| count > 0),
            "Duplicate Java types must not produce a clean compiler result: {result}"
        );
        assert_eq!(result["analyzedSourceCount"], 3);
        decode_editor_diagnostics_evidence(
            &f.root,
            &json!([{"request":request,"result":result}]),
            "ready",
        );
        assert_eq!(fs::read_to_string(f.root.join(main_path)).unwrap(), main);
        assert_eq!(
            fs::read_to_string(f.root.join(helper_path)).unwrap(),
            helper
        );
        for (name, contents) in &build_inputs {
            assert_eq!(fs::read_to_string(f.root.join(name)).unwrap(), *contents);
        }
        if let Some(expected) = &evaluations {
            assert_eq!(
                fs::read(f.root.join("evaluation-count.txt")).unwrap(),
                *expected
            );
        }

        nav.shutdown_all();
        state.shutdown_all();
        return;
    }
    let dirty = run(request.clone());
    if unqualified_source {
        assert_eq!(context["semanticAnalysis"]["availability"], "unqualified");
        assert_eq!(dirty["status"], "refused", "{dirty}");
        assert_eq!(
            dirty["refusalCode"],
            "java.context.sourceAnalysisUnqualified"
        );
        assert!(
            dirty.get("items").is_none(),
            "A refusal cannot imply a clean result"
        );
        decode_editor_diagnostics_evidence(
            &f.root,
            &json!([{"request":request,"result":dirty}]),
            "refused",
        );
        assert_eq!(fs::read_to_string(f.root.join(main_path)).unwrap(), main);
        assert_eq!(
            fs::read_to_string(f.root.join(helper_path)).unwrap(),
            helper
        );
        for (name, contents) in &build_inputs {
            assert_eq!(fs::read_to_string(f.root.join(name)).unwrap(), *contents);
        }
        if let Some(expected) = &evaluations {
            assert_eq!(
                fs::read(f.root.join("evaluation-count.txt")).unwrap(),
                *expected
            );
        }
        {
            let active = state.0.active.lock().unwrap();
            let owned = active
                .as_ref()
                .expect("Metadata session must remain available");
            assert_eq!(owned.session.child.id(), pid);
            assert_eq!(
                owned.context.as_ref().unwrap()["contextHash"],
                context["contextHash"]
            );
            assert_eq!(owned.context.as_ref().unwrap()["status"], "available");
        }
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output, serde_json::to_vec_pretty(&json!({
                "status":"PASS", "buildTool":if gradle {"gradle"} else {"maven"},
                "languageRelease":source_release, "sdkHome":sdk, "usesRelease":restricted,
                "contextSchemaVersion":context["schemaVersion"], "semanticAnalysis":context["semanticAnalysis"],
                "result":dirty, "metadataRetained":true, "sessionPreserved":true,
                "inputsPreserved":true, "gradleEvaluationsUnchanged":gradle,
                "productionTypeScriptDecoder":true
            })).unwrap()).unwrap();
        }
        nav.shutdown_all();
        state.shutdown_all();
        return;
    }
    if let Some(expected) = &evaluations {
        assert_eq!(
            fs::read(f.root.join("evaluation-count.txt")).unwrap(),
            *expected
        );
    }
    if dirty["status"] != "ready" {
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output,serde_json::to_vec_pretty(&json!({"buildTool":if gradle {"gradle"} else {"maven"},"multiModule":multi_module,"testSources":test_sources,"release8":restricted && source_release == 8,"usesRelease":restricted,"languageRelease":source_release,
                "sdkHome":sdk,"request":request,"result":dirty,"apiRelease":expected_api,"modernSdkApi":modern_sdk_api,"gradleEvaluationsUnchanged":gradle,
                "javacOracle":{"compiled":compiled.status.success(),"stderr":String::from_utf8_lossy(&compiled.stderr)}})).unwrap()).unwrap();
        }
    }
    assert_eq!(dirty["status"], "ready", "{dirty}");
    let items = dirty["items"].as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["location"]["path"] == helper_path),
        "{dirty}"
    );
    assert_eq!(
        items
            .iter()
            .any(|item| item["location"]["path"] == main_path),
        api_error_count > 0,
        "{dirty}"
    );
    let mut evidence = vec![json!({"request":request,"result":dirty})];
    request["requestId"] = json!("java-errors-repaired");
    request["editorOverlay"]["documents"][1]["text"] = json!(helper);
    request["editorOverlay"]["documents"][1]["version"] = json!(43);
    let repaired = run(request.clone());
    assert_eq!(repaired["status"], "ready", "{repaired}");
    assert_eq!(repaired["total"], api_error_count, "{repaired}");
    evidence.push(json!({"request":request,"result":repaired}));
    let mut missing = request.clone();
    missing["requestId"] = json!("java-errors-missing");
    missing["editorOverlay"]["documents"]
        .as_array_mut()
        .unwrap()
        .pop();
    let saved_companion = run(missing.clone());
    assert_eq!(saved_companion["status"], "ready", "{saved_companion}");
    assert_eq!(saved_companion["analyzedSourceCount"], 2);
    assert_eq!(saved_companion["total"], api_error_count);
    evidence.push(json!({"request":missing,"result":saved_companion}));
    if multi_module {
        let mut signature_request = request.clone();
        signature_request["requestId"] = json!("java-errors-library-signature");
        signature_request["editorOverlay"]["documents"][1]["text"] = json!(helper
            .replace("int value()", "String value()")
            .replace("return 1", "return \"changed\""));
        signature_request["editorOverlay"]["documents"][1]["version"] = json!(44);
        let changed = run(signature_request.clone());
        evidence.push(json!({"request":signature_request,"result":changed}));
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output,serde_json::to_vec_pretty(&json!({"phase":"changed-library-signature","multiModule":true,"operations":evidence,"crossModuleOracle":cross_module_oracle})).unwrap()).unwrap();
        }
        assert_eq!(changed["status"], "ready", "{changed}");
        assert_eq!(changed["total"], api_error_count + 1, "{changed}");
        assert!(
            changed["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["location"]["path"] == main_path),
            "{changed}"
        );
        signature_request["requestId"] = json!("java-errors-cross-module-repair");
        let repaired_main = dirty_main.replace("int run()", "String run()");
        signature_request["document"]["text"] = json!(repaired_main);
        signature_request["document"]["version"] = json!(45);
        signature_request["editorOverlay"]["documents"][0]["text"] = json!(repaired_main);
        signature_request["editorOverlay"]["documents"][0]["version"] = json!(45);
        let repaired = run(signature_request.clone());
        evidence.push(json!({"request":signature_request,"result":repaired}));
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output,serde_json::to_vec_pretty(&json!({"phase":"repaired-cross-module-caller","multiModule":true,"operations":evidence,"crossModuleOracle":cross_module_oracle})).unwrap()).unwrap();
        }
        assert_eq!(repaired["status"], "ready", "{repaired}");
        assert_eq!(repaired["total"], api_error_count, "{repaired}");
    }
    if test_sources {
        let mut isolation_request = request.clone();
        isolation_request["requestId"] = json!("java-errors-test-dependency-leak");
        isolation_request["editorOverlay"]["documents"][1]["text"] = json!(helper.replace(
            "static int value()",
            "org.junit.jupiter.api.Test testOnly; static int value()"
        ));
        isolation_request["editorOverlay"]["documents"][1]["version"] = json!(44);
        let isolation = run(isolation_request.clone());
        evidence.push(json!({"request":isolation_request,"result":isolation}));
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output,serde_json::to_vec_pretty(&json!({"phase":"test-classpath-isolation","testSources":true,"operations":evidence,"testClasspathOracle":test_classpath_oracle})).unwrap()).unwrap();
        }
        assert_eq!(isolation["status"], "ready", "{isolation}");
        assert_eq!(isolation["total"], api_error_count + 1, "{isolation}");
        assert!(
            isolation["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["location"]["path"] == helper_path),
            "{isolation}"
        );
        isolation_request["requestId"] = json!("java-errors-test-dependency-repair");
        isolation_request["editorOverlay"]["documents"][1]["text"] = json!(helper);
        isolation_request["editorOverlay"]["documents"][1]["version"] = json!(45);
        let repaired = run(isolation_request.clone());
        evidence.push(json!({"request":isolation_request,"result":repaired}));
        if let Some(output) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
            fs::write(output,serde_json::to_vec_pretty(&json!({"phase":"test-classpath-repair","testSources":true,"operations":evidence,"testClasspathOracle":test_classpath_oracle})).unwrap()).unwrap();
        }
        assert_eq!(repaired["status"], "ready", "{repaired}");
        assert_eq!(repaired["total"], api_error_count, "{repaired}");
    }
    decode_editor_diagnostics_evidence(&f.root, &json!(evidence), "ready");
    assert_eq!(fs::read_to_string(f.root.join(main_path)).unwrap(), main);
    assert_eq!(
        fs::read_to_string(f.root.join(helper_path)).unwrap(),
        helper
    );
    for (name, contents) in &build_inputs {
        assert_eq!(fs::read_to_string(f.root.join(name)).unwrap(), *contents);
    }
    if let Some(expected) = &evaluations {
        assert_eq!(
            fs::read(f.root.join("evaluation-count.txt")).unwrap(),
            *expected
        );
    }

    assert_eq!(
        state
            .0
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .session
            .child
            .id(),
        pid
    );
    if let Some(path) = std::env::var_os("IDE_JAVA_ERRORS_EVIDENCE") {
        fs::write(path, serde_json::to_vec_pretty(&json!({"release8":restricted && source_release == 8,"usesRelease":restricted,"languageRelease":source_release,"sdkHome":sdk,"operations":evidence,"buildTool":if gradle {"gradle"} else {"maven"},"multiModule":multi_module,"testSources":test_sources,"gradleEvaluationsUnchanged":gradle,"apiRelease":expected_api,"modernSdkApi":modern_sdk_api,
            "javacOracle":{"compiled":compiled.status.success(),"stderr":String::from_utf8_lossy(&compiled.stderr)},
            "savedCompanionUsesSnapshot":true,"inputsPreserved":true,"sessionPreserved":true,"productionTypeScriptDecoder":true,"crossModuleSignatures":multi_module,"crossModuleOracle":cross_module_oracle,"testClasspathOracle":test_classpath_oracle})).unwrap()).unwrap();
    }
    nav.shutdown_all();
    state.shutdown_all();
}

fn decode_editor_diagnostics_evidence(workspace: &Path, evidence: &Value, expected_status: &str) {
    let wire = workspace.join("java-errors-consumer.json");
    fs::write(&wire, serde_json::to_vec(evidence).unwrap()).unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let decoded = Command::new("node").current_dir(root).args(["--import","tsx","--input-type=module","-e",
        "import fs from 'node:fs';import{normalizeJavaEditorDiagnostics}from './packages/tauri-adapters/src/java-editor-diagnostics-tauri.ts';for(const x of JSON.parse(fs.readFileSync(process.argv[1],'utf8'))){const r=await normalizeJavaEditorDiagnostics(x.result,x.request);if(r.status!==process.argv[2])throw Error('compiler diagnostics rejected');}console.log('PRODUCTION_JAVA_ERRORS_DECODER_ACCEPTED');"])
        .arg(&wire).arg(expected_status).output().unwrap();
    assert!(
        decoded.status.success(),
        "{}",
        String::from_utf8_lossy(&decoded.stderr)
    );
    fs::remove_file(wire).unwrap();
}
