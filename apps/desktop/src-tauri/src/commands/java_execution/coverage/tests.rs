use super::*;

fn report(session: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="fixture"><sessioninfo id="{session}" start="1" dump="2"/><package name="example"><class name="example/Choice" sourcefilename="Choice.java"><method name="choose" desc="(I)I" line="2"><counter type="INSTRUCTION" missed="1" covered="3"/></method></class><sourcefile name="Choice.java"><line nr="2" mi="1" ci="3" mb="1" cb="1"/><line nr="3" mi="1" ci="0" mb="0" cb="0"/><counter type="INSTRUCTION" missed="2" covered="3"/><counter type="BRANCH" missed="1" covered="1"/><counter type="LINE" missed="1" covered="1"/></sourcefile></package><counter type="INSTRUCTION" missed="2" covered="3"/><counter type="BRANCH" missed="1" covered="1"/><counter type="LINE" missed="1" covered="1"/></report>"#
    )
}

#[test]
fn imports_measured_lines_and_branches_only_for_the_owned_session() {
    let (totals, files) = xml::parse(
        report("owned").as_bytes(),
        "target/site/jacoco/jacoco.xml",
        "owned",
    )
    .unwrap();
    assert_eq!(totals.branches.covered, 1);
    assert_eq!(totals.lines.missed, 1);
    assert_eq!(files[0].lines[0].missed_branches, 1);
    assert_eq!(files[0].lines[1].covered_instructions, 0);
    assert_eq!(files[0].module_root, None);
    assert!(xml::parse(report("older").as_bytes(), "report.xml", "owned").is_err());
}

#[test]
fn gradle_coverage_module_root_comes_only_from_a_safe_owned_sidecar() {
    let root = std::env::temp_dir().join(format!(
        "ide-java-coverage-module-root-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let report_path = root.join("reports/1/jacoco.xml");
    fs::create_dir_all(report_path.parent().unwrap()).expect("report directory");
    fs::write(&report_path, report("owned")).expect("coverage XML");
    let metadata = report_path.parent().unwrap().join("module.json");
    fs::write(&metadata, br#"{"moduleRoot":"gradle/library"}"#).expect("module metadata");
    assert_eq!(
        gradle_report_module_root(&root.join("reports"), &report_path),
        Some("gradle/library".into())
    );

    for unsafe_root in [
        "../outside",
        "/absolute",
        "gradle\\library",
        "gradle/./library",
    ] {
        fs::write(
            &metadata,
            serde_json::json!({ "moduleRoot": unsafe_root }).to_string(),
        )
        .expect("unsafe module metadata");
        assert_eq!(
            gradle_report_module_root(&root.join("reports"), &report_path),
            None
        );
    }

    fs::remove_file(&metadata).expect("remove metadata");
    fs::remove_dir_all(root).expect("remove temporary reports");
}

#[test]
fn refuses_malformed_oversized_unmeasured_or_external_entity_reports() {
    let valid = report("owned");
    for malformed in [
        valid.replace("report.dtd", "https://example.invalid/external.dtd"),
        valid.replace("Choice.java", "../Choice.java"),
        valid.replace("nr=\"2\"", "nr=\"0\""),
        valid.replace("nr=\"3\"", "nr=\"2\""),
        valid.replace("ci=\"3\"", "ci=\"1000000001\""),
        valid.replace(
            "type=\"LINE\" missed=\"1\" covered=\"1\"",
            "type=\"LINE\" missed=\"0\" covered=\"2\"",
        ),
        valid.replace("<sourcefile", "<unknown"),
        valid.replace("</report>", ""),
        format!("{valid}{valid}"),
        valid
            .replace("covered=\"3\"", "covered=\"0\"")
            .replace("missed=\"2\"", "missed=\"0\""),
        valid.replace("fixture", "&unknown;"),
        valid.replace(
            "</package><counter type=\"INSTRUCTION\" missed=\"2\" covered=\"3\"",
            "</package><counter type=\"INSTRUCTION\" missed=\"0\" covered=\"3\"",
        ),
    ] {
        assert!(
            xml::parse(malformed.as_bytes(), "report.xml", "owned").is_err(),
            "{malformed}"
        );
    }
}

#[test]
fn accumulation_refuses_overflow_without_changing_previously_measured_totals() {
    let mut total = Counters::default();
    total.lines.covered = 1_000_000_000;
    let mut next = Counters::default();
    next.instructions.covered = 1;
    next.lines.covered = 1;
    assert!(total.add(&next).is_err());
    assert_eq!(total.instructions.covered, 0);
    assert_eq!(total.lines.covered, 1_000_000_000);
}

#[test]
#[cfg(unix)]
fn discovery_and_reads_refuse_symlink_hardlink_and_nonregular_reports() {
    use std::os::unix::fs::symlink;
    let artifact = CoverageArtifact::create(
        Path::new("/tmp"),
        Path::new("/tmp"),
        "",
        "maven",
        None,
        &[],
        &[],
        false,
        None,
    )
    .unwrap();
    let root = artifact.settings.path.parent().unwrap();
    let outside = root.join("outside.xml");
    fs::write(&outside, report("owned")).unwrap();
    let target = root.join("module/target");
    fs::create_dir_all(&target).unwrap();
    symlink(root, target.join("site")).unwrap();
    let xml = root.join("jacoco.xml");
    symlink(&outside, &xml).unwrap();
    assert!(reports(root, true, false).unwrap().is_empty());
    assert!(read_report(root, &xml).is_err());
    fs::remove_file(&xml).unwrap();
    fs::hard_link(&outside, &xml).unwrap();
    assert!(read_report(root, &xml).is_err());
    fs::remove_file(&xml).unwrap();
    fs::create_dir(&xml).unwrap();
    assert!(read_report(root, &xml).is_err());
}

#[test]
fn integration_coverage_ignores_stale_unit_coverage_reports() {
    let root = std::env::temp_dir().join(format!(
        "ide-java-coverage-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let unit = root.join("module/target/site/jacoco/jacoco.xml");
    let integration = root.join("module/target/site/jacoco-it/jacoco.xml");
    fs::create_dir_all(unit.parent().unwrap()).expect("unit report directory");
    fs::create_dir_all(integration.parent().unwrap()).expect("integration report directory");
    fs::write(&unit, b"stale unit coverage").expect("stale unit report");
    fs::write(&integration, b"current integration coverage").expect("integration report");

    let integration_reports = reports(&root, true, true).expect("integration reports");
    assert_eq!(integration_reports, vec![integration.clone()]);
    let regular_reports = reports(&root, true, false).expect("regular reports");
    assert_eq!(regular_reports.len(), 2);
    assert!(regular_reports.contains(&unit));
    assert!(regular_reports.contains(&integration));
    fs::remove_dir_all(root).expect("remove temporary project");
}

#[test]
fn integration_coverage_resets_only_the_selected_projects_standard_execution_file() {
    let root = std::env::temp_dir().join(format!(
        "ide-java-coverage-reset-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let target = root.join("target");
    let data = target.join("jacoco-it.exec");
    fs::create_dir_all(&target).expect("project target directory");
    fs::write(&data, b"stale execution data").expect("stale execution data");

    reset_maven_integration_data(&root).expect("reset stale data");
    assert!(!data.exists());
    fs::remove_dir_all(root).expect("remove temporary project");
}

#[test]
#[ignore = "requires Gradle, a full JDK, and cached or reachable JUnit dependencies"]
fn real_gradle_composite_coverage_reports_selected_and_included_java_projects() {
    use std::process::Command;

    let workspace = std::env::temp_dir().join(format!(
        "ide-java-composite-coverage-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let project = workspace.join("application");
    let app = project.join("app");
    let library = workspace.join("library");
    let leaf = workspace.join("leaf");
    fs::create_dir_all(app.join("src/main/java/app")).unwrap();
    fs::create_dir_all(app.join("src/integrationTest/java/app")).unwrap();
    fs::create_dir_all(library.join("src/main/java/library")).unwrap();
    fs::create_dir_all(leaf.join("src/main/java/leaf")).unwrap();
    fs::write(
        project.join("settings.gradle"),
        "rootProject.name = 'application'\ninclude ':app'\nincludeBuild('../library')\n",
    )
    .unwrap();
    fs::write(project.join("build.gradle"), "").unwrap();
    fs::write(
        app.join("build.gradle"),
        "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { implementation 'fixture:library:1.0'; testImplementation 'junit:junit:4.13.2' }\nsourceSets { integrationTest { java.srcDir 'src/integrationTest/java'; compileClasspath += sourceSets.main.output; runtimeClasspath += sourceSets.main.output } }\nconfigurations { integrationTestImplementation.extendsFrom implementation, testImplementation; integrationTestRuntimeOnly.extendsFrom runtimeOnly, testRuntimeOnly }\ntasks.register('integrationTest', Test) { testClassesDirs = sourceSets.integrationTest.output.classesDirs; classpath = sourceSets.integrationTest.runtimeClasspath }\n",
    )
    .unwrap();
    fs::write(
        library.join("settings.gradle"),
        "rootProject.name = 'library'\nincludeBuild('../leaf')\n",
    )
    .unwrap();
    fs::write(
        library.join("build.gradle"),
        "plugins { id 'java-library' }\ngroup = 'fixture'\nversion = '1.0'\ndependencies { api 'fixture:leaf:1.0' }\n",
    )
    .unwrap();
    fs::write(leaf.join("settings.gradle"), "rootProject.name = 'leaf'\n").unwrap();
    fs::write(
        leaf.join("build.gradle"),
        "plugins { id 'java-library' }\ngroup = 'fixture'\nversion = '1.0'\n",
    )
    .unwrap();
    fs::write(
        app.join("src/main/java/app/App.java"),
        "package app; public final class App { public static String message() { return library.Greeter.message(); } }\n",
    )
    .unwrap();
    fs::write(
        app.join("src/integrationTest/java/app/AppTest.java"),
        "package app; import org.junit.Test; import static org.junit.Assert.*; public final class AppTest { @Test public void includesLibraryCode() { assertEquals(\"hello\", App.message()); } }\n",
    )
    .unwrap();
    fs::write(
        library.join("src/main/java/library/Greeter.java"),
        "package library; public final class Greeter { public static String message() { return leaf.Leaf.message(); } }\n",
    )
    .unwrap();
    fs::write(
        leaf.join("src/main/java/leaf/Leaf.java"),
        "package leaf; public final class Leaf { public static String message() { return \"hello\"; } }\n",
    )
    .unwrap();

    let artifact = CoverageArtifact::create(
        &workspace,
        &project,
        "application",
        "gradle",
        Some("integrationTest"),
        &[],
        &[],
        false,
        Some(&app),
    )
    .expect("coverage artifact");
    let executable =
        std::env::var_os("IDE_GRADLE_TEST_EXECUTABLE").unwrap_or_else(|| "gradle".into());
    let test_task = artifact
        .gradle_task()
        .expect("mapped integration-test coverage task");
    let output = Command::new(&executable)
        .current_dir(&project)
        .arg("--no-daemon")
        .arg("--console=plain")
        .arg("--init-script")
        .arg(&artifact.settings.path)
        .arg(format!(":app:{test_task}"))
        .output()
        .expect("start Gradle");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let report_task = artifact
        .gradle_report_task()
        .expect("composite coverage report task");
    let report_arguments = super::super::gradle_coverage_report_arguments(
        &[
            "--no-daemon".into(),
            "--console=plain".into(),
            format!(":app:{test_task}"),
            "--init-script".into(),
            artifact.settings.path.to_string_lossy().into_owned(),
            "--rerun-tasks".into(),
            "--tests".into(),
            "app.AppTest.includesLibraryCode".into(),
        ],
        &artifact,
    )
    .expect("captured Gradle report arguments");
    assert!(report_arguments
        .iter()
        .any(|argument| argument == &format!(":{report_task}")));
    let report_output = Command::new(&executable)
        .current_dir(&project)
        .args(report_arguments)
        .output()
        .expect("start Gradle coverage reporting");
    assert!(
        report_output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&report_output.stdout),
        String::from_utf8_lossy(&report_output.stderr)
    );

    let report_root = artifact.settings.path.parent().unwrap().join("reports");
    let report_paths = reports(&report_root, false, false).expect("composite reports");
    assert_eq!(
        report_paths.len(),
        3,
        "{report_paths:?}\n{}\n{}",
        String::from_utf8_lossy(&report_output.stdout),
        String::from_utf8_lossy(&report_output.stderr)
    );
    let mut measured = Vec::new();
    for path in report_paths {
        let data = read_report(&report_root, &path).expect("owned JaCoCo report");
        let (_, files) = xml::parse(&data, "composite/jacoco.xml", &artifact.token)
            .expect("current-session JaCoCo report");
        let module_root =
            gradle_report_module_root(&report_root, &path).expect("workspace-relative module root");
        measured.extend(
            files
                .into_iter()
                .map(|file| (file.name, module_root.clone())),
        );
    }
    assert!(
        measured
            .iter()
            .any(|(name, root)| name == "App.java" && root == "application/app"),
        "{measured:?}"
    );
    assert!(
        measured
            .iter()
            .any(|(name, root)| name == "Greeter.java" && root == "library"),
        "{measured:?}"
    );
    assert!(
        measured
            .iter()
            .any(|(name, root)| name == "Leaf.java" && root == "leaf"),
        "{measured:?}"
    );
    fs::remove_dir_all(workspace).expect("remove composite fixture");
}
