use super::*;

#[test]
#[ignore = "requires full JDK and selected Maven/Gradle tools and offline caches"]
fn real_compiler_output_locations_survive_truncation_and_retire_with_session() {
    let tool = std::env::var("IDE_COMPILER_DIAGNOSTIC_BUILD_TOOL").unwrap_or_else(|_| "jdk".into());
    assert!(["jdk", "maven", "gradle"].contains(&tool.as_str()));
    let (root, binding) = fixture();
    fs::remove_file(root.join("Main.java")).unwrap();
    let source = root.join("library module/src/main/java/example/Café.java");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(
        &source,
        "package example;\npublic class Café {\n public int value() {\n  return missing;\n }\n}\n",
    )
    .unwrap();
    fs::create_dir_all(root.join("app/src/main/java/example")).unwrap();
    fs::write(
        root.join("app/src/main/java/example/App.java"),
        "package example; public class App {}\n",
    )
    .unwrap();
    if tool == "maven" {
        fs::write(root.join("pom.xml"), r#"<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>reactor</artifactId><version>1</version><packaging>pom</packaging><modules><module>library module</module><module>app</module></modules><properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin></plugins></build></project>"#).unwrap();
        for (directory, id) in [("library module", "library"), ("app", "app")] {
            fs::write(root.join(directory).join("pom.xml"), format!(r#"<project><modelVersion>4.0.0</modelVersion><parent><groupId>example</groupId><artifactId>reactor</artifactId><version>1</version></parent><artifactId>{id}</artifactId></project>"#)).unwrap();
        }
    }
    if tool == "gradle" {
        fs::write(root.join("settings.gradle"), "rootProject.name = 'compiler-fixture'\ninclude 'library', 'app'\nproject(':library').projectDir = file('library module')\n").unwrap();
        fs::write(root.join("build.gradle"), "subprojects { apply plugin: 'java'; tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8'; options.release = 17 } }\n").unwrap();
    }
    let state = JavaExecutionState::default();
    let mut build = request(&binding, "build");
    build.configuration.build_tool = tool;
    state.start(binding.clone(), build.clone()).unwrap();
    let job = state.job.lock().unwrap().clone().unwrap();
    let failed = wait_for(&job, |snapshot| snapshot.state == "failed");
    assert_ne!(failed.exit_code, Some(0), "{}", failed.output);
    let diagnostic = failed
        .compiler_diagnostics
        .items
        .iter()
        .find(|d| d.path == "library module/src/main/java/example/Café.java")
        .unwrap_or_else(|| panic!("No compiler location in actual output: {}", failed.output));
    assert_eq!(diagnostic.line, 4);
    assert_eq!(diagnostic.severity, "error");
    assert!(
        diagnostic.message.contains("cannot find symbol"),
        "{}",
        diagnostic.message
    );
    job.append(&vec![b'x'; OUTPUT_LIMIT + 8]);
    let truncated = job.read().unwrap();
    assert!(truncated.output_truncated);
    assert_eq!(
        truncated.compiler_diagnostics.items,
        failed.compiler_diagnostics.items
    );
    fs::write(
        &source,
        "package example; public class Café { public int value() { return 1; } }\n",
    )
    .unwrap();
    state.start(binding, build).unwrap();
    let next_job = state.job.lock().unwrap().clone().unwrap();
    let succeeded = wait_for(&next_job, |s| {
        !["starting", "running"].contains(&s.state.as_str())
    });
    assert_eq!(succeeded.state, "succeeded", "{}", succeeded.output);
    assert_ne!(succeeded.session_id, failed.session_id);
    assert!(succeeded.compiler_diagnostics.is_empty());
    state.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
