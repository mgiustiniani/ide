use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "ide-junit-results-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&root).unwrap();
    root.canonicalize().unwrap()
}
const PASSED: &str = r#"<testsuite name="example.SampleTest" tests="1" failures="0" errors="0" skipped="0"><testcase classname="example.SampleTest" name="passes" time="0.002"/></testsuite>"#;
const FAILED: &str = r#"<testsuite name="example.SampleTest" tests="2" failures="1" errors="0" skipped="0"><testcase classname="example.SampleTest" name="passes"/><testcase classname="example.SampleTest" name="fails"><failure type="AssertionError" message="expected &lt;1&gt; but &lt;2&gt;">at example.SampleTest.fails(SampleTest.java:9)</failure></testcase></testsuite>"#;

#[test]
fn maven_uses_direct_surefire_reports_and_omits_nested_testng_copies() {
    let root = fixture();
    let reports = root.join("target/surefire-reports");
    fs::create_dir_all(reports.join("junitreports")).unwrap();
    let tracker = Tracker::prepare(&root, &root, "maven", &[]);
    fs::write(reports.join("TEST-Sample.xml"), PASSED.replace("<testcase", "<properties><property name=\"ide.test.jvm.options\" value=\"current\"/></properties><testcase")).unwrap();
    fs::write(reports.join("junitreports/TEST-Sample.xml"), PASSED).unwrap();
    fs::write(
        reports.join("junitreports/TEST-Malformed.xml"),
        "not a report",
    )
    .unwrap();
    let result = tracker.finish_with_jvm_options("", Some("current"));
    assert_eq!(result.status, "ready");
    assert_eq!(result.summary.total, 1);
    assert!(result.test_jvm_options_error.is_none());
    assert_eq!(
        result.suites[0].report_path,
        "target/surefire-reports/TEST-Sample.xml"
    );
    let custom = root.join("custom/results");
    fs::create_dir_all(custom.join("copies")).unwrap();
    let tracker = Tracker::prepare(&root, &root, "maven", &["custom/results".into()]);
    fs::write(custom.join("TEST-Actual.xml"), PASSED).unwrap();
    fs::write(custom.join("copies/TEST-Actual.xml"), PASSED).unwrap();
    assert_eq!(tracker.finish("").summary.total, 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn plain_jdk_reads_only_fresh_reports_from_its_session_directory() {
    let root = fixture();
    let relative = ".ide/java/test-results/run-current";
    let reports = root.join(relative);
    fs::create_dir_all(&reports).unwrap();
    let tracker = Tracker::prepare(&root, &root, "jdk", &[relative.into()]);
    fs::write(reports.join("TEST-junit-jupiter.xml"), PASSED).unwrap();
    let result = tracker.finish("");
    assert_eq!(result.status, "ready");
    assert_eq!(result.build_tool, "jdk");
    assert_eq!(result.summary.total, 1);
    assert_eq!(result.summary.passed, 1);
    assert_eq!(
        result.suites[0].report_path,
        format!("{relative}/TEST-junit-jupiter.xml")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn maven_integration_runs_read_only_fresh_failsafe_reports() {
    let root = fixture();
    let surefire = root.join("service/target/surefire-reports");
    let failsafe = root.join("service/target/failsafe-reports");
    fs::create_dir_all(&surefire).unwrap();
    fs::write(surefire.join("TEST-Stale.xml"), FAILED).unwrap();
    let tracker = Tracker::prepare_for_operation(
        &root,
        &root.join("service"),
        "maven",
        &[],
        "integration-test",
    );
    fs::create_dir_all(&failsafe).unwrap();
    fs::write(failsafe.join("TEST-FreshIT.xml"), PASSED).unwrap();

    let result = tracker.finish("service");
    assert_eq!(result.status, "ready");
    assert_eq!(result.summary.total, 1);
    assert_eq!(result.summary.passed, 1);
    assert!(result.suites[0]
        .report_path
        .ends_with("target/failsafe-reports/TEST-FreshIT.xml"));

    let next = Tracker::prepare_for_operation(
        &root,
        &root.join("service"),
        "maven",
        &[],
        "integration-test",
    );
    fs::write(surefire.join("TEST-Stale.xml"), PASSED).unwrap();
    let missing = next.finish("service");
    assert_eq!(missing.status, "unavailable");
    assert_eq!(missing.summary.total, 0);
    assert_eq!(missing.unchanged_reports, 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn confirms_test_jvm_options_only_in_every_fresh_populated_suite() {
    let root = fixture();
    let directory = root.join("target/surefire-reports");
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join("TEST-Sample.xml");
    let confirmed = PASSED.replace("<testcase", "<properties><property name=\"ide.test.jvm.options\" value=\"current\"/></properties><testcase");
    let tracker = Tracker::prepare(&root, &root, "maven", &[]);
    assert!(tracker
        .finish_with_jvm_options("", Some("current"))
        .test_jvm_options_error
        .is_some());
    fs::write(&file, &confirmed).unwrap();
    let result = tracker.finish_with_jvm_options("", Some("current"));
    assert_eq!(result.summary.passed, 1);
    assert!(result.test_jvm_options_error.is_none());
    assert!(tracker
        .finish_with_jvm_options("", Some("retired"))
        .test_jvm_options_error
        .is_some());
    let unchanged = Tracker::prepare(&root, &root, "maven", &[]);
    assert!(unchanged
        .finish_with_jvm_options("", Some("current"))
        .test_jvm_options_error
        .is_some());
    for xml in [PASSED.to_owned(), confirmed.replace("current", "retired"), format!("<testsuites>{confirmed}{PASSED}</testsuites>"), PASSED.replace("<testcase", "<system-out><properties><property name=\"ide.test.jvm.options\" value=\"current\"/></properties></system-out><testcase"), confirmed.replace("</properties>", "<property name=\"ide.test.jvm.options\" value=\"current\"/></properties>")] {
        fs::write(&file, xml).unwrap();
        let result = tracker.finish_with_jvm_options("", Some("current"));
        assert!(result.test_jvm_options_error.is_some());
        assert!(result.summary.passed > 0);
        assert!(!result.can_rerun_failed);
    }
    fs::write(&file, &confirmed).unwrap();
    fs::write(directory.join("TEST-Other.xml"), FAILED).unwrap();
    let result = tracker.finish_with_jvm_options("", Some("current"));
    assert!(result.test_jvm_options_error.is_some());
    assert!(result.failed_selections().is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reads_real_xml_shapes_with_nested_suites_entities_cdata_skips_errors_and_retries() {
    let xml = r#"<?xml version="1.0" encoding="UTF-8"?><testsuites tests="4" failures="0" errors="1" skipped="1"><testsuite name="outer" tests="4"><testsuite name="inner"><testcase classname="example.T" name="passes" time="0.003"/><testcase classname="example.T" name="errors"><error message="cannot &amp; should not"><![CDATA[stack <frame> 😀]]></error></testcase><testcase classname="example.T" name="skip"><skipped message="disabled"/></testcase><testcase classname="example.T" name="retry"><flakyFailure><stackTrace>first attempt</stackTrace></flakyFailure><system-out>event &#x1f600;</system-out></testcase></testsuite></testsuite></testsuites>"#;
    let suites = parse_report(xml.as_bytes(), "module/build/test-results/test/TEST-T.xml").unwrap();
    assert_eq!(suites[0].name, "outer");
    let cases = &suites[1].cases;
    assert_eq!(cases.len(), 4);
    assert_eq!(cases[0].duration_ms, Some(3.0));
    assert_eq!(cases[1].state, "error");
    assert!(cases[1]
        .detail
        .contains("cannot & should not\nstack <frame> 😀"));
    assert_eq!(cases[2].state, "skipped");
    assert!(cases[2].detail.contains("disabled"));
    assert_eq!(cases[3].state, "flaky");
    assert!(cases[3].detail.contains("first attemptevent 😀"));
}
#[test]
fn rejects_malformed_counts_external_entities_wrong_roots_and_invalid_durations() {
    for xml in [
        "<testsuite><testcase/></wrong>", "<testsuite><testcase>",
        "<testsuite tests=\"1\"/>", "<testsuite><failure/></testsuite>",
        "<!DOCTYPE testsuite [<!ENTITY secret SYSTEM 'file:///etc/passwd'>]><testsuite><testcase name='x'><failure>&secret;</failure></testcase></testsuite>",
        "<testsuite><testcase name='x' time='NaN'/></testsuite>",
        "<testsuite><testcase name='x' time='-1'/></testsuite>",
        "<testsuite/><testsuite/>", "<html/>",
        "<testsuite><testcase name='x' name='duplicate'/></testsuite>",
        "<testsuite><testcase name='x'><error>&undefined;</error></testcase></testsuite>",
    ] { assert!(parse_report(xml.as_bytes(), "TEST-T.xml").is_err(), "{xml}"); }
}
#[test]
fn limits_details_at_utf8_boundaries_and_keeps_truncation_visible() {
    let xml = format!(
        "<testsuite><testcase name='x'><failure>{}</failure></testcase></testsuite>",
        "😀".repeat(5000)
    );
    let suites = parse_report(xml.as_bytes(), "TEST-T.xml").unwrap();
    let case = &suites[0].cases[0];
    assert_eq!(case.detail.len(), MAX_DETAIL);
    assert!(case.detail_truncated);
    assert!(parse_report(&vec![b'x'; MAX_FILE + 1], "TEST-T.xml").is_err());
}
#[test]
fn ignores_unchanged_reports_and_collects_changed_reports_without_writing_them() {
    for kind in ["maven", "gradle"] {
        let root = fixture();
        let directory = root.join(if kind == "maven" {
            "service/target/surefire-reports"
        } else {
            "service/build/test-results/test"
        });
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("TEST-Sample.xml");
        fs::write(&file, PASSED).unwrap();
        let tracker = Tracker::prepare(&root, &root.join("service"), kind, &[]);
        let unchanged = tracker.finish("service");
        assert_eq!(unchanged.status, "unavailable");
        assert_eq!(unchanged.unchanged_reports, 1);
        assert_eq!(unchanged.summary.total, 0);
        assert!(!unchanged.can_rerun_failed);
        fs::write(&file, FAILED).unwrap();
        let results = tracker.finish("service");
        assert_eq!(results.status, "ready");
        assert_eq!(results.summary.total, 2);
        assert_eq!(results.summary.failed, 1);
        assert!(results.can_rerun_failed);
        assert_eq!(
            results.failed_selections().unwrap(),
            ["example.SampleTest#fails"]
        );
        assert_eq!(fs::read_to_string(&file).unwrap(), FAILED);
        fs::remove_dir_all(root).unwrap();
    }
}
#[test]
fn a_fresh_empty_suite_is_unavailable_and_not_a_zero_test_success() {
    let root = fixture();
    let tracker = Tracker::prepare(&root, &root, "maven", &[]);
    fs::create_dir_all(root.join("target/surefire-reports")).unwrap();
    fs::write(
        root.join("target/surefire-reports/TEST-Empty.xml"),
        "<testsuite name='Empty' tests='0' failures='0' errors='0' skipped='0'/>",
    )
    .unwrap();
    let results = tracker.finish("");
    assert_eq!(results.status, "unavailable");
    assert!(results.suites.is_empty());
    assert_eq!(results.summary.total, 0);
    assert!(!results.can_rerun_failed);
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn custom_directories_and_multiple_modules_keep_report_identity_and_refuse_partial_reruns() {
    let root = fixture();
    let tracker = Tracker::prepare(&root, &root, "maven", &["custom/results".into()]);
    fs::create_dir_all(root.join("custom/results")).unwrap();
    fs::write(root.join("custom/results/TEST-Good.xml"), FAILED).unwrap();
    fs::write(
        root.join("custom/results/TEST-Bad.xml"),
        "<testsuite tests='99'/>",
    )
    .unwrap();
    let partial = tracker.finish("");
    assert_eq!(partial.status, "partial");
    assert_eq!(partial.summary.failed, 1);
    assert!(!partial.can_rerun_failed);
    assert!(partial.failed_selections().is_err());
    let before = Tracker::prepare(&root, &root, "gradle", &[]);
    for module in ["a", "b"] {
        let directory = root.join(module).join("build/test-results/test");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("TEST-Same.xml"), PASSED).unwrap();
    }
    let reports = before.finish("");
    assert_eq!(reports.summary.total, 2);
    assert_ne!(reports.suites[0].cases[0].id, reports.suites[1].cases[0].id);
    fs::remove_dir_all(root).unwrap();
}
#[test]
#[cfg(unix)]
fn rejects_escaping_report_paths_symlinks_hard_links_and_special_files() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    let outside = fixture();
    let tracker = Tracker::prepare(&root, &root, "maven", &[]);
    fs::create_dir_all(root.join("target/surefire-reports")).unwrap();
    fs::write(outside.join("outside.xml"), PASSED).unwrap();
    let file = root.join("target/surefire-reports/TEST-X.xml");
    symlink(outside.join("outside.xml"), &file).unwrap();
    assert_eq!(tracker.finish("").status, "unavailable");
    fs::remove_file(&file).unwrap();
    fs::hard_link(outside.join("outside.xml"), &file).unwrap();
    assert_eq!(tracker.finish("").status, "unavailable");
    fs::remove_file(&file).unwrap();
    let fifo = std::ffi::CString::new(file.to_string_lossy().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    assert_eq!(tracker.finish("").status, "unavailable");
    assert_eq!(
        Tracker::prepare(
            &root,
            &root,
            "maven",
            &[outside.to_string_lossy().into_owned()]
        )
        .finish("")
        .status,
        "unavailable"
    );
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}
#[test]
fn reruns_literal_methods_and_whole_classes_for_provider_display_names_without_guessing() {
    let suites = parse_report(FAILED.as_bytes(), "TEST-T.xml").unwrap();
    let mut results = TestResults::collecting("", "maven");
    results.status = "ready".into();
    results.suites = suites;
    for case in results.suites.iter().flat_map(|suite| &suite.cases) {
        results.summary.add(case);
    }
    assert_eq!(
        results.failed_selections().unwrap(),
        ["example.SampleTest#fails"]
    );
    results.suites[0].cases[1].name = "custom provider display (😀) [1]".into();
    assert_eq!(results.failed_selections().unwrap(), ["example.SampleTest"]);
    results.suites[0].cases[1].class_name = "-Danything".into();
    assert!(results.failed_selections().is_err());
    results.status = "partial".into();
    assert!(results.failed_selections().is_err());
}

#[test]
fn publishes_actual_rerun_selections_without_guessing_display_names() {
    let root = fixture();
    let reports = root.join("target/surefire-reports");
    fs::create_dir_all(&reports).unwrap();
    for (name, method) in [
        ("fails", Some("fails")),
        ("fails()", None),
        ("apparentlyOtherMethod()", None),
        ("case [2]", None),
    ] {
        let tracker = Tracker::prepare(&root, &root, "maven", &[]);
        fs::write(
            reports.join("TEST-Sample.xml"),
            FAILED.replace("name=\"fails\"", &format!("name=\"{name}\"")),
        )
        .unwrap();
        let result = tracker.finish("");
        assert_eq!(result.status, "ready");
        assert!(result.can_rerun_failed);
        assert_eq!(result.rerun_selections.len(), 1);
        assert_eq!(result.rerun_selections[0].class_name, "example.SampleTest");
        assert_eq!(result.rerun_selections[0].method_name.as_deref(), method);
    }
    let mut result = TestResults::collecting("", "maven");
    result.rerun_selections.push(RerunSelection {
        class_name: "example.SampleTest".into(),
        method_name: None,
    });
    result.unavailable("stale reports");
    assert!(result.rerun_selections.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reactor_rerun_scopes_homonyms_and_keeps_distinct_module_filters() {
    let workspace = fixture();
    let reactor = workspace.join("reactor");
    let app = reactor.join("app/target/surefire-reports");
    let library = reactor.join("components/library/target/surefire-reports");
    fs::create_dir_all(&app).unwrap();
    fs::create_dir_all(&library).unwrap();
    let tracker = Tracker::prepare(&workspace, &reactor, "maven", &[]);
    fs::write(app.join("TEST-Sample.xml"), FAILED).unwrap();
    let same_method_passed = PASSED.replace("passes", "fails");
    fs::write(library.join("TEST-Sample.xml"), &same_method_passed).unwrap();

    let mut result = tracker.finish("reactor");
    result.scope_maven_reactor_rerun(None);
    assert_eq!(
        result.maven_rerun_projects().unwrap().unwrap(),
        BTreeMap::from([(PathBuf::from("app"), "example.SampleTest#fails".into())])
    );
    assert_eq!(result.failed_selections().unwrap(), ["example.SampleTest#fails"]);

    fs::write(library.join("TEST-Other.xml"), FAILED.replace("SampleTest", "OtherTest")).unwrap();
    let mut result = tracker.finish("reactor");
    result.scope_maven_reactor_rerun(None);
    assert!(result.can_rerun_failed);
    assert_eq!(
        result.maven_rerun_projects().unwrap().unwrap(),
        BTreeMap::from([
            (PathBuf::from("app"), "example.SampleTest#fails".into()),
            (PathBuf::from("components/library"), "example.OtherTest#fails".into()),
        ])
    );

    let both_modules = result.maven_rerun_projects().unwrap().unwrap();
    fs::remove_file(library.join("TEST-Sample.xml")).unwrap();
    fs::remove_file(library.join("TEST-Other.xml")).unwrap();
    let mut result = tracker.finish("reactor");
    result.scope_maven_reactor_rerun(Some(&both_modules));
    assert_eq!(result.status, "partial");
    assert!(!result.can_rerun_failed);

    let only_app = BTreeMap::from([(PathBuf::from("app"), "example.SampleTest#fails".into())]);
    let mut result = tracker.finish("reactor");
    result.scope_maven_reactor_rerun(Some(&only_app));
    assert_eq!(result.maven_rerun_projects().unwrap(), Some(only_app));
    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn custom_maven_reports_require_matching_basedir_and_nearest_descriptor() {
    let workspace = fixture();
    let reactor = workspace.join("reactor");
    let app = reactor.join("app");
    let core = reactor.join("core");
    let app_reports = app.join("test-evidence");
    let core_reports = core.join("test-evidence");
    for (module, directory) in [(&app, &app_reports), (&core, &core_reports)] {
        fs::create_dir_all(directory).unwrap();
        fs::write(module.join("pom.xml"), "<project/>").unwrap();
    }
    fs::write(reactor.join("pom.xml"), "<project/>").unwrap();
    let tracker = Tracker::prepare(
        &workspace,
        &reactor,
        "maven",
        &["reactor/app/test-evidence".into(), "reactor/core/test-evidence".into()],
    );
    let report_with_module = |report: &str, module: &Path| {
        let module = quick_xml::escape::escape(module.to_str().unwrap());
        report.replacen(
            "<testcase",
            &format!(r#"<properties><property name="basedir" value="{module}"/></properties><testcase"#),
            1,
        )
    };
    let core_report = core_reports.join("TEST-Sample.xml");
    fs::write(
        &core_report,
        report_with_module(&PASSED.replace("passes", "fails"), &core),
    ).unwrap();
    let app_report = app_reports.join("TEST-Sample.xml");
    fs::write(&app_report, report_with_module(FAILED, &app)).unwrap();
    let mut results = tracker.finish("reactor");
    results.scope_maven_reactor_rerun(None);
    assert_eq!(results.maven_rerun_projects().unwrap().unwrap(),
        BTreeMap::from([(PathBuf::from("app"), "example.SampleTest#fails".into())]));
    let suite = serde_json::to_value(&results.suites[0]).unwrap();
    assert_eq!(suite["mavenReportModulePath"], "reactor/app");

    for owner in [&reactor, &core] {
        fs::write(&app_report, report_with_module(FAILED, owner)).unwrap();
        let mut results = tracker.finish("reactor");
        results.scope_maven_reactor_rerun(None);
        assert!(results.maven_rerun_projects().is_err());
        assert!(!results.can_rerun_failed);
        assert!(results.suites[0].maven_report_module_path.is_none());
    }
    let duplicate = report_with_module(FAILED, &app).replace(
        "</properties>",
        &format!(r#"<property name="basedir" value="{}"/></properties>"#, app.display()),
    );
    fs::write(&app_report, duplicate).unwrap();
    assert!(tracker.finish("reactor").suites[0].maven_report_module_path.is_none());
    fs::remove_dir_all(workspace).unwrap();
}
