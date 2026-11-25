use super::*;
use serde_json::json;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let name: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir().join(format!("ide-gradle-test-methods-{name}"));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("reports")).unwrap();
        fs::create_dir(root.join("other-reports")).unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn row(&self) -> serde_json::Value {
        json!({"kind":"method","version":2,"requestId":"one","reportDirectory":self.0.join("reports"),"className":"fixture.Owner","reportName":"display()","outcome":"failure","sourceClassName":"fixture.Owner","methodName":"actualMethod"})
    }
    fn data(&self, rows: &[serde_json::Value]) -> Vec<u8> {
        let mut lines: Vec<_> = rows
            .iter()
            .map(|row| serde_json::to_string(row).unwrap())
            .collect();
        lines.push(json!({"kind":"complete","version":2,"requestId":"one","entries":rows.len(),"unavailable":false}).to_string());
        (lines.join("\n") + "\n").into_bytes()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn correlates_runner_method_source_only_with_the_same_report_class_and_name() {
    let fixture = Fixture::new();
    let index = parse(&fixture.data(&[fixture.row()]), "one", &fixture.0).unwrap();
    let report = fixture.0.join("reports/TEST-fixture.Owner.xml");
    assert_eq!(
        index.lookup(&report, "fixture.Owner", "display()", "failed"),
        Some(&Method::Known {
            source_class: "fixture.Owner".into(),
            name: "actualMethod".into(),
            declaring_class: None,
            test_origin: None,
            declaring_origin: None,
        })
    );
    assert!(index
        .lookup(
            &fixture.0.join("other-reports/TEST-fixture.Owner.xml"),
            "fixture.Owner",
            "display()",
            "failed"
        )
        .is_none());
    assert!(index
        .lookup(&report, "fixture.Other", "display()", "failed")
        .is_none());
    assert!(index
        .lookup(&report, "fixture.Owner", "another()", "failed")
        .is_none());
}

#[test]
fn rejects_stale_incomplete_unavailable_and_escaping_method_metadata() {
    let fixture = Fixture::new();
    let valid = fixture.data(&[fixture.row()]);
    assert!(parse(&valid, "another", &fixture.0).is_err());
    assert!(parse(&valid[..valid.len() - 1], "one", &fixture.0).is_err());
    assert!(parse(
        (fixture.row().to_string() + "\n").as_bytes(),
        "one",
        &fixture.0
    )
    .is_err());
    assert!(parse(&vec![b'x'; BYTE_LIMIT + 1], "one", &fixture.0).is_err());
    let mut after = valid.clone();
    after.extend_from_slice(b"{}\n");
    assert!(parse(&after, "one", &fixture.0).is_err());
    let text = String::from_utf8(valid.clone())
        .unwrap()
        .replace("\"unavailable\":false", "\"unavailable\":true");
    assert!(parse(text.as_bytes(), "one", &fixture.0).is_err());
    let text = String::from_utf8(valid)
        .unwrap()
        .replace("\"entries\":1", "\"entries\":2");
    assert!(parse(text.as_bytes(), "one", &fixture.0).is_err());
    for field in ["className", "sourceClassName", "methodName"] {
        let mut row = fixture.row();
        row[field] = json!("bad()name");
        assert!(parse(&fixture.data(&[row]), "one", &fixture.0).is_err());
    }
    let mut row = fixture.row();
    row["reportDirectory"] = json!(std::env::temp_dir());
    assert!(parse(&fixture.data(&[row]), "one", &fixture.0).is_err());
    let mut row = fixture.row();
    row["unexpected"] = json!(true);
    assert!(parse(&fixture.data(&[row]), "one", &fixture.0).is_err());
}

#[test]
fn keeps_duplicate_source_agreement_and_refuses_conflicting_or_unknown_duplicates() {
    let fixture = Fixture::new();
    let report = fixture.0.join("reports/TEST-fixture.Owner.xml");
    let row = fixture.row();
    let index = parse(
        &fixture.data(&[row.clone(), row.clone()]),
        "one",
        &fixture.0,
    )
    .unwrap();
    assert!(matches!(
        index.lookup(&report, "fixture.Owner", "display()", "failed"),
        Some(Method::Known { .. })
    ));
    for other in [json!("otherMethod"), serde_json::Value::Null] {
        let mut changed = row.clone();
        changed["methodName"] = other.clone();
        if other.is_null() {
            changed["sourceClassName"] = serde_json::Value::Null;
        }
        let index = parse(
            &fixture.data(&[row.clone(), changed, row.clone()]),
            "one",
            &fixture.0,
        )
        .unwrap();
        assert_eq!(
            index.lookup(&report, "fixture.Owner", "display()", "failed"),
            Some(&Method::Ambiguous)
        );
    }
}

#[test]
fn fresh_report_rerun_uses_the_runner_identity_instead_of_stripping_display_text() {
    let fixture = Fixture::new();
    let tracker = super::super::test_results::Tracker::prepare(
        &fixture.0,
        &fixture.0,
        "gradle",
        &["reports".into()],
    );
    fs::write(fixture.0.join("reports/TEST-fixture.Owner.xml"),r#"<testsuite name="fixture.Owner" tests="1" failures="1" errors="0" skipped="0"><testcase classname="fixture.Owner" name="display()"><failure message="failure"/></testcase></testsuite>"#).unwrap();
    let mut results = tracker.finish("");
    assert_eq!(results.failed_selections().unwrap(), ["fixture.Owner"]);
    let index = parse(&fixture.data(&[fixture.row()]), "one", &fixture.0).unwrap();
    results.correlate_gradle_methods(&fixture.0, &index);
    assert_eq!(
        results.failed_selections().unwrap(),
        ["fixture.Owner#actualMethod"]
    );
    assert_eq!(
        results.rerun_selections[0].method_name.as_deref(),
        Some("actualMethod")
    );
    let empty = parse(&fixture.data(&[]), "one", &fixture.0).unwrap();
    results.correlate_gradle_methods(&fixture.0, &empty);
    assert_eq!(results.failed_selections().unwrap(), ["fixture.Owner"]);
    let mut other = fixture.row();
    other["methodName"] = json!("anotherMethod");
    let index = parse(&fixture.data(&[fixture.row(), other]), "one", &fixture.0).unwrap();
    results.correlate_gradle_methods(&fixture.0, &index);
    assert_eq!(results.failed_selections().unwrap(), ["fixture.Owner"]);
    assert!(results.rerun_selections[0].method_name.is_none());
}

#[test]
fn private_metadata_refuses_links_and_cleans_up_its_files() {
    let fixture = Fixture::new();
    let artifact = Artifact::create().unwrap();
    let bytes = String::from_utf8(fixture.data(&[fixture.row()]))
        .unwrap()
        .replace("\"one\"", &format!("\"{}\"", artifact.identity));
    fs::write(&artifact.output, bytes).unwrap();
    assert!(artifact.read(&fixture.0).is_ok());
    #[cfg(unix)]
    {
        let copy = fixture.0.join("linked-output");
        fs::hard_link(&artifact.output, &copy).unwrap();
        assert!(artifact.read(&fixture.0).is_err());
        fs::remove_file(copy).unwrap();
        fs::remove_file(&artifact.output).unwrap();
        std::os::unix::fs::symlink(fixture.0.join("reports"), &artifact.output).unwrap();
        assert!(artifact.read(&fixture.0).is_err());
    }
    let output = artifact.output.clone();
    let source = artifact.source.path.clone();
    drop(artifact);
    assert!(!output.exists() && !source.exists());
}

#[test]
fn equal_display_names_are_correlated_by_outcome_and_do_not_grant_flaky_identity() {
    let fixture = Fixture::new();
    let tracker = super::super::test_results::Tracker::prepare(
        &fixture.0,
        &fixture.0,
        "gradle",
        &["reports".into()],
    );
    fs::write(fixture.0.join("reports/TEST-fixture.Owner.xml"), r#"<testsuite name="fixture.Owner" tests="3" failures="1" errors="0" skipped="1"><testcase classname="fixture.Owner" name="display()"/><testcase classname="fixture.Owner" name="display()"><failure message="failure"/></testcase><testcase classname="fixture.Owner" name="display()"><skipped/></testcase></testsuite>"#).unwrap();
    let mut rows = vec![];
    for (outcome, method) in [
        ("failure", "actualMethod"),
        ("success", "passedMethod"),
        ("skipped", "skippedMethod"),
    ] {
        let mut row = fixture.row();
        row["outcome"] = json!(outcome);
        row["methodName"] = json!(method);
        if outcome == "success" {
            row["sourceClassName"] = json!("fixture.Base");
        }
        rows.push(row);
    }
    let index = parse(&fixture.data(&rows), "one", &fixture.0).unwrap();
    let mut results = tracker.finish("");
    results.correlate_gradle_methods(&fixture.0, &index);
    let cases = &results.suites[0].cases;
    for (case, name) in cases
        .iter()
        .zip(["passedMethod", "actualMethod", "skippedMethod"])
    {
        let source = case.method_source.as_ref().unwrap();
        assert_eq!(
            source.class_name,
            if case.state == "passed" {
                "fixture.Base"
            } else {
                "fixture.Owner"
            }
        );
        assert_eq!(source.method_name, name);
    }
    assert_eq!(
        results.failed_selections().unwrap(),
        ["fixture.Owner#actualMethod"]
    );
    let json = serde_json::to_value(&results).unwrap();
    assert_eq!(
        json["suites"][0]["cases"][0]["methodSource"]["methodName"],
        "passedMethod"
    );
    assert!(index
        .lookup(
            &fixture.0.join("reports/TEST-fixture.Owner.xml"),
            "fixture.Owner",
            "display()",
            "flaky"
        )
        .is_none());
    let mut conflicting = rows[0].clone();
    conflicting["methodName"] = json!("anotherFailure");
    rows.push(conflicting);
    results.correlate_gradle_methods(
        &fixture.0,
        &parse(&fixture.data(&rows), "one", &fixture.0).unwrap(),
    );
    assert!(results.suites[0].cases[1].method_source.is_none());
    assert!(results.suites[0].cases[0].method_source.is_some());
    assert_eq!(results.failed_selections().unwrap(), ["fixture.Owner"]);
    results.correlate_gradle_methods(
        &fixture.0,
        &parse(&fixture.data(&[]), "one", &fixture.0).unwrap(),
    );
    assert!(results.suites[0]
        .cases
        .iter()
        .all(|case| case.method_source.is_none()));
}

#[test]
fn distinguishes_runner_class_from_effective_declaration_and_keeps_rerun_on_the_subclass() {
    let fixture = Fixture::new();
    let tracker = super::super::test_results::Tracker::prepare(
        &fixture.0,
        &fixture.0,
        "gradle",
        &["reports".into()],
    );
    fs::write(fixture.0.join("reports/TEST-fixture.Owner.xml"), r#"<testsuite name="fixture.Owner" tests="1" failures="1" errors="0" skipped="0"><testcase classname="fixture.Owner" name="display()"><failure message="failure"/></testcase></testsuite>"#).unwrap();
    let mut row = fixture.row();
    row["declaringClassName"] = json!("fixture.Base");
    let mut results = tracker.finish("");
    results.correlate_gradle_methods(
        &fixture.0,
        &parse(&fixture.data(&[row.clone()]), "one", &fixture.0).unwrap(),
    );
    let source = results.suites[0].cases[0].method_source.as_ref().unwrap();
    assert_eq!(source.class_name, "fixture.Owner");
    assert_eq!(source.declaring_class_name.as_deref(), Some("fixture.Base"));
    assert_eq!(
        results.failed_selections().unwrap(),
        ["fixture.Owner#actualMethod"]
    );
    let data = serde_json::to_value(&results).unwrap();
    assert_eq!(
        data["suites"][0]["cases"][0]["methodSource"]["declaringClassName"],
        "fixture.Base"
    );
    row["declaringClassName"] = json!("bad()name");
    assert!(parse(&fixture.data(&[row.clone()]), "one", &fixture.0).is_err());
    row["declaringClassName"] = json!("fixture.Base");
    row["methodName"] = serde_json::Value::Null;
    row["sourceClassName"] = serde_json::Value::Null;
    assert!(parse(&fixture.data(&[row]), "one", &fixture.0).is_err());
}

#[test]
fn compiled_origins_are_workspace_relative_and_preserve_cross_module_identity() {
    let fixture = Fixture::new();
    let directory = fixture.0.join("app/build/classes/java/test");
    let archive = fixture.0.join("base/build/libs/base.jar");
    fs::create_dir_all(&directory).unwrap();
    fs::create_dir_all(archive.parent().unwrap()).unwrap();
    fs::write(&archive, b"compiled archive").unwrap();
    let mut row = fixture.row();
    row["declaringClassName"] = json!("fixture.Base");
    row["testOrigin"] = json!(directory);
    row["declaringOrigin"] = json!(archive);
    let index = parse(&fixture.data(&[row.clone()]), "one", &fixture.0).unwrap();
    let report = fixture.0.join("reports/TEST-fixture.Owner.xml");
    let Some(Method::Known {
        test_origin,
        declaring_origin,
        ..
    }) = index.lookup(&report, "fixture.Owner", "display()", "failed")
    else {
        panic!("missing method")
    };
    assert_eq!(
        serde_json::to_value(test_origin).unwrap(),
        json!({"path":"app/build/classes/java/test","kind":"directory"})
    );
    assert_eq!(
        serde_json::to_value(declaring_origin).unwrap(),
        json!({"path":"base/build/libs/base.jar","kind":"archive"})
    );
    let tracker = super::super::test_results::Tracker::prepare(
        &fixture.0,
        &fixture.0,
        "gradle",
        &["reports".into()],
    );
    fs::write(&report, r#"<testsuite name="fixture.Owner" tests="1" failures="1"><testcase classname="fixture.Owner" name="display()"><failure/></testcase></testsuite>"#).unwrap();
    let mut results = tracker.finish("");
    results.correlate_gradle_methods(&fixture.0, &index);
    assert_eq!(
        results.failed_selections().unwrap(),
        ["fixture.Owner#actualMethod"]
    );
    let data = serde_json::to_value(&results).unwrap();
    assert_eq!(
        data["suites"][0]["cases"][0]["methodSource"]["declaringOrigin"]["path"],
        "base/build/libs/base.jar"
    );
    let mut changed = row.clone();
    changed["declaringOrigin"] = json!(directory);
    let conflicts = parse(&fixture.data(&[row, changed]), "one", &fixture.0).unwrap();
    assert_eq!(
        conflicts.lookup(&report, "fixture.Owner", "display()", "failed"),
        Some(&Method::Ambiguous)
    );
}

#[test]
fn class_origins_omit_missing_external_and_symlink_escaping_paths_and_reject_invalid_records() {
    let fixture = Fixture::new();
    let report = fixture.0.join("reports/TEST-fixture.Owner.xml");
    for origin in [std::env::temp_dir(), fixture.0.join("missing.jar")] {
        let mut row = fixture.row();
        row["testOrigin"] = json!(origin);
        let index = parse(&fixture.data(&[row]), "one", &fixture.0).unwrap();
        assert!(matches!(
            index.lookup(&report, "fixture.Owner", "display()", "failed"),
            Some(Method::Known {
                test_origin: None,
                ..
            })
        ));
    }
    #[cfg(unix)]
    {
        let outside = Fixture::new();
        let link = fixture.0.join("outside");
        std::os::unix::fs::symlink(&outside.0, &link).unwrap();
        let mut row = fixture.row();
        row["testOrigin"] = json!(link);
        let index = parse(&fixture.data(&[row]), "one", &fixture.0).unwrap();
        assert!(matches!(
            index.lookup(&report, "fixture.Owner", "display()", "failed"),
            Some(Method::Known {
                test_origin: None,
                ..
            })
        ));
    }
    for origin in [
        json!("relative/classes"),
        json!(""),
        json!("/bad\0path"),
        json!("/".to_owned() + &"x".repeat(4096)),
        json!({"path":"classes"}),
    ] {
        let mut row = fixture.row();
        row["testOrigin"] = origin;
        assert!(parse(&fixture.data(&[row]), "one", &fixture.0).is_err());
    }
    let mut row = fixture.row();
    row["declaringOrigin"] = json!(fixture.0.join("reports"));
    assert!(parse(&fixture.data(&[row]), "one", &fixture.0).is_err());
}

#[test]
fn owns_and_removes_compiled_inspector_storage() {
    let artifact = Artifact::create().unwrap();
    let directory = artifact.inspector.path.parent().unwrap().to_path_buf();
    fs::create_dir(directory.join("classes")).unwrap();
    fs::write(directory.join("classes/owned.class"), b"owned").unwrap();
    let script = fs::read_to_string(&artifact.source.path).unwrap();
    assert!(!script.contains("IDE_TEST_METHOD_SETTINGS"));
    let output = artifact.output.clone();
    let source = artifact.source.path.clone();
    drop(artifact);
    assert!(!directory.exists());
    assert!(!output.exists());
    assert!(!source.exists());
}

#[test]
#[ignore = "requires IDE_TEST_INSPECTOR_COMPILER_JDK and IDE_TEST_INSPECTOR_RUNTIME_JDK"]
fn real_test_jdk_inspector_loads_newer_bytecode_without_initializing_project_classes() {
    use std::io::{Cursor, Write};
    use std::process::Command;
    let compiler = PathBuf::from(std::env::var("IDE_TEST_INSPECTOR_COMPILER_JDK").unwrap());
    let runtime = PathBuf::from(std::env::var("IDE_TEST_INSPECTOR_RUNTIME_JDK").unwrap());
    assert_ne!(
        compiler.canonicalize().unwrap(),
        runtime.canonicalize().unwrap()
    );
    let fixture = Fixture::new();
    let classes = fixture.0.join("project-classes");
    let helpers = fixture.0.join("helper-classes");
    fs::create_dir(&classes).unwrap();
    fs::create_dir(&helpers).unwrap();
    let source = fixture.0.join("Derived.java");
    fs::write(&source, r#"class Base {
      static { try { new java.io.File("initialized-project-class").createNewFile(); } catch (Exception e) { throw new Error(e); } }
      protected void inherited() {}
    }
    interface Contract { default void contractMethod() {} }
    public class Derived extends Base implements Contract {
      void direct() {}
      public static java.lang.reflect.Method[] getMethods() { throw new AssertionError("project method invoked"); }
      public static java.lang.reflect.Method[] getDeclaredMethods() { throw new AssertionError("project method invoked"); }
    }"#).unwrap();
    let artifact = Artifact::create().unwrap();
    let run = |command: &mut Command| {
        for name in ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"] {
            command.env_remove(name);
        }
        let result = command.current_dir(&fixture.0).output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    run(Command::new(runtime.join("bin/javac"))
        .arg("-d")
        .arg(&classes)
        .arg(&source));
    run(Command::new(compiler.join("bin/javac"))
        .args(["--release", "8", "-proc:none", "-d"])
        .arg(&helpers)
        .arg(&artifact.inspector.path));
    let release = fs::read_to_string(compiler.join("release")).unwrap();
    let major: u16 = release
        .lines()
        .find_map(|line| line.strip_prefix("JAVA_VERSION=\""))
        .unwrap()
        .split('.')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let bytecode = fs::read(classes.join("Derived.class")).unwrap();
    assert!(
        u16::from_be_bytes([bytecode[6], bytecode[7]]) > major + 44,
        "The fixture must use bytecode newer than the compiler/Gradle JDK"
    );
    let input = fixture.0.join("request");
    let output = fixture.0.join("response");
    let mut data = Vec::new();
    fn utf(data: &mut Vec<u8>, value: &str) {
        assert!(value.is_ascii());
        data.write_all(&(value.len() as u16).to_be_bytes()).unwrap();
        data.write_all(value.as_bytes()).unwrap();
    }
    data.extend_from_slice(&1_i32.to_be_bytes());
    utf(&mut data, classes.to_str().unwrap());
    data.extend_from_slice(&4_i32.to_be_bytes());
    for (class, method) in [
        ("Derived", "inherited"),
        ("Derived", "direct"),
        ("Derived", "contractMethod"),
        ("Absent", "missing"),
    ] {
        utf(&mut data, class);
        utf(&mut data, method);
    }
    fs::write(&input, data).unwrap();
    run(Command::new(runtime.join("bin/java"))
        .arg("-cp")
        .arg(&helpers)
        .arg("IdeTestMethodInspector")
        .arg(&input)
        .arg(&output));
    let mut response = Cursor::new(fs::read(output).unwrap());
    let mut count = [0; 4];
    response.read_exact(&mut count).unwrap();
    assert_eq!(i32::from_be_bytes(count), 4);
    fn read_utf(response: &mut Cursor<Vec<u8>>) -> String {
        let mut size = [0; 2];
        response.read_exact(&mut size).unwrap();
        let mut bytes = vec![0; u16::from_be_bytes(size) as usize];
        response.read_exact(&mut bytes).unwrap();
        String::from_utf8(bytes).unwrap()
    }
    for owner in ["Base", "Derived", "Contract"] {
        assert_eq!(read_utf(&mut response), classes.to_str().unwrap());
        assert_eq!(read_utf(&mut response), owner);
        assert_eq!(read_utf(&mut response), classes.to_str().unwrap());
    }
    for _ in 0..3 {
        assert_eq!(read_utf(&mut response), "");
    }
    assert_eq!(response.position(), response.get_ref().len() as u64);
    assert!(!fixture.0.join("initialized-project-class").exists());
}
