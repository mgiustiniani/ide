//! Bounded, read-only JUnit XML results from reports changed by an owned test task.
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use super::maven_test_forks::RerunProjects;
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_FILE: usize = 2 * 1024 * 1024;
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_REPORTS: usize = 512;
const MAX_CASES: usize = 10_000;
const MAX_DETAIL: usize = 16 * 1024;
#[cfg(test)]
#[path = "test_results_tests.rs"]
mod tests;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClassOrigin {
    pub path: String,
    pub kind: &'static str,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MethodSource {
    pub class_name: String,
    pub method_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declaring_class_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_origin: Option<ClassOrigin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declaring_origin: Option<ClassOrigin>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub id: String,
    pub name: String,
    pub class_name: String,
    pub state: String,
    pub duration_ms: Option<f64>,
    pub detail: String,
    pub detail_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_source: Option<MethodSource>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suite {
    pub report_path: String,
    #[serde(skip)]
    maven_module: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    maven_report_module_path: Option<String>,
    #[serde(skip)]
    reported_basedir: ReportBasedir,
    pub name: String,
    pub cases: Vec<Case>,
}
#[derive(Clone, Debug, Default)]
enum ReportBasedir {
    #[default]
    Missing,
    Present(PathBuf),
    Ambiguous,
}
impl ReportBasedir {
    fn record(&mut self, value: Option<&String>) {
        *self = match (&self, value) {
            (Self::Missing, Some(value)) if value.len() <= 4096 => Self::Present(value.into()),
            _ => Self::Ambiguous,
        };
    }
}

#[derive(Clone, Default, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub error: usize,
    pub skipped: usize,
    pub flaky: usize,
}
impl Summary {
    fn add(&mut self, case: &Case) {
        self.total += 1;
        match case.state.as_str() {
            "passed" => self.passed += 1,
            "failed" => self.failed += 1,
            "error" => self.error += 1,
            "skipped" => self.skipped += 1,
            "flaky" => self.flaky += 1,
            _ => unreachable!(),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunSelection {
    pub class_name: String,
    pub method_name: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResults {
    pub status: String,
    pub project_path: String,
    pub build_tool: String,
    pub suites: Vec<Suite>,
    pub summary: Summary,
    pub unchanged_reports: usize,
    pub message: Option<String>,
    pub can_rerun_failed: bool,
    pub rerun_reason: Option<String>,
    pub rerun_selections: Vec<RerunSelection>,
    #[serde(skip)]
    rerun_methods: BTreeMap<String, Option<String>>,
    #[serde(skip)]
    maven_rerun_projects: Result<Option<RerunProjects>, String>,
    #[serde(skip)]
    pub test_jvm_options_error: Option<String>,
}
impl TestResults {
    pub fn collecting(project_path: &str, build_tool: &str) -> Self {
        Self {
            status: "collecting".into(),
            project_path: project_path.into(),
            build_tool: build_tool.into(),
            suites: vec![],
            summary: Summary::default(),
            unchanged_reports: 0,
            message: Some("Waiting for fresh JUnit XML reports from this test task.".into()),
            can_rerun_failed: false,
            rerun_reason: None,
            rerun_selections: vec![],
            rerun_methods: BTreeMap::new(),
            maven_rerun_projects: Ok(None),
            test_jvm_options_error: None,
        }
    }
    pub fn unavailable(&mut self, reason: &str) {
        self.status = "unavailable".into();
        self.suites.clear();
        self.summary = Summary::default();
        self.message = Some(reason.into());
        self.can_rerun_failed = false;
        self.rerun_selections.clear();
        self.rerun_methods.clear();
        self.maven_rerun_projects = Ok(None);
        self.rerun_reason = Some("Fresh completed test results are required.".into());
    }
    pub fn correlate_gradle_methods(
        &mut self,
        workspace: &Path,
        methods: &super::gradle_test_methods::MethodIndex,
    ) {
        if self.build_tool != "gradle" || self.status != "ready" {
            return;
        }
        self.rerun_methods.clear();
        for suite in &mut self.suites {
            let report = workspace.join(&suite.report_path);
            for case in &mut suite.cases {
                use super::gradle_test_methods::Method;
                case.method_source = None;
                let method = methods.lookup(&report, &case.class_name, &case.name, &case.state);
                if let Some(Method::Known {
                    source_class,
                    name,
                    declaring_class,
                    test_origin,
                    declaring_origin,
                }) = method
                {
                    case.method_source = Some(MethodSource {
                        class_name: source_class.clone(),
                        method_name: name.clone(),
                        declaring_class_name: declaring_class.clone(),
                        test_origin: test_origin.clone(),
                        declaring_origin: declaring_origin.clone(),
                    });
                }
                if matches!(case.state.as_str(), "failed" | "error") {
                    match method {
                        Some(Method::Known { name, .. }) => {
                            self.rerun_methods
                                .insert(case.id.clone(), Some(name.clone()));
                        }
                        Some(Method::Ambiguous) => {
                            self.rerun_methods.insert(case.id.clone(), None);
                        }
                        _ => {}
                    }
                }
            }
        }
        self.refresh_rerun();
        if serde_json::to_vec(self).map_or(true, |bytes| bytes.len() > MAX_BYTES) {
            self.unavailable("Structured test results exceed the 8 MiB presentation limit.");
        }
    }
    pub(super) fn scope_maven_reactor_rerun(&mut self, active: Option<&RerunProjects>) {
        if self.build_tool != "maven" || self.status != "ready" {
            return;
        }
        if let Some(active) = active {
            let reported: BTreeSet<_> = self.suites.iter()
                .filter(|suite| !suite.cases.is_empty())
                .map(|suite| suite.maven_module.as_deref())
                .collect();
            let expected: BTreeSet<_> = active.keys().map(|path| Some(path.as_path())).collect();
            if reported != expected {
                self.status = "partial".into();
                self.message = Some("Fresh reports did not confirm all and only the selected Maven test modules.".into());
            }
        }
        self.maven_rerun_projects = self.maven_reactor_projects(active.is_some());
        self.refresh_rerun();
    }

    fn maven_reactor_projects(&self, restrict: bool) -> Result<Option<RerunProjects>, String> {
        let populated = || self.suites.iter().filter(|suite| !suite.cases.is_empty());
        let qualified = populated().all(|suite| suite.maven_module.is_some());
        if restrict && !qualified {
            return Err("A fresh report does not identify its Maven module.".into());
        }
        let mut cases_by_scope: BTreeMap<&Path, Vec<&Case>> = BTreeMap::new();
        for suite in populated() {
            let scope = if qualified {
                suite.maven_module.as_deref()
            } else {
                Path::new(&suite.report_path).parent()
            };
            let Some(scope) = scope else { return Ok(None); };
            cases_by_scope.entry(scope).or_default().extend(&suite.cases);
        }
        if !restrict && cases_by_scope.len() < 2 {
            return Ok(None);
        }
        let selected = self.select_failures(self.suites.iter().flat_map(|suite| &suite.cases))?;
        let mut projects = BTreeMap::new();
        let mut shared_filter_would_run_other_cases = false;
        let mut different_filters = false;
        for (module, cases) in cases_by_scope {
            let failures = self.select_failures(cases.iter().copied())?;
            shared_filter_would_run_other_cases |= failures != selected && cases.iter().any(|case| {
                !matches!(case.state.as_str(), "failed" | "error")
                    && selected.iter().any(|selector| {
                        selector == &case.class_name
                            || selector.split_once('#').is_some_and(|(class, method)| {
                                class == case.class_name && method == case.name
                            })
                    })
            });
            if !failures.is_empty() {
                different_filters |= failures != selected;
                projects.insert(module.to_path_buf(), failures.join(","));
            }
        }
        if !qualified {
            return if shared_filter_would_run_other_cases {
                Err("A failed selection also matches tests in another report directory without confirmed Maven module ownership. Rerun from the individual Maven module.".into())
            } else {
                Ok(None)
            };
        }
        if restrict || shared_filter_would_run_other_cases || (projects.len() > 1 && different_filters) {
            return Ok(Some(projects));
        }
        Ok(None)
    }

    pub(super) fn maven_rerun_projects(&self) -> Result<Option<RerunProjects>, String> {
        self.maven_rerun_projects.clone()
    }

    pub(super) fn maven_failed_debug_projects(&self, selections: &[String]) -> Result<Option<RerunProjects>, String> {
        if self.build_tool != "maven" {
            return Ok(None);
        }
        let mut failing_module = None;
        for suite in self.suites.iter().filter(|suite| {
            suite.cases.iter().any(|case| matches!(case.state.as_str(), "failed" | "error"))
        }) {
            let module = suite.maven_module.as_deref().ok_or(
                "The failed reports do not identify a Maven module for debugging. Run the tests from the individual module.",
            )?;
            if failing_module.is_some_and(|previous| previous != module) {
                return Err("Debug failed tests from one Maven module at a time.".into());
            }
            failing_module = Some(module);
        }
        let Some(module) = failing_module else {
            return Ok(None);
        };
        if module.as_os_str().is_empty()
            && self.suites.iter().all(|suite| suite.maven_module.as_deref() == Some(module))
        {
            return Ok(None);
        }
        Ok(Some(BTreeMap::from([(module.to_path_buf(), selections.join(","))])))
    }

    fn refresh_rerun(&mut self) {
        self.can_rerun_failed = false;
        self.rerun_selections.clear();
        match self.failed_selections() {
            Ok(selections) => {
                self.rerun_selections = selections
                    .into_iter()
                    .map(|selector| {
                        let (class_name, method_name) = match selector.split_once('#') {
                            Some((class, method)) => (class.to_owned(), Some(method.to_owned())),
                            None => (selector, None),
                        };
                        RerunSelection {
                            class_name,
                            method_name,
                        }
                    })
                    .collect();
                self.can_rerun_failed = true;
                self.rerun_reason = None;
            }
            Err(reason) => self.rerun_reason = Some(reason),
        }
    }
    pub(super) fn record_test_jvm_options_error(&mut self, error: String) {
        self.test_jvm_options_error = Some(error);
        self.refresh_rerun();
    }
    pub fn failed_selections(&self) -> Result<Vec<String>, String> {
        if self.test_jvm_options_error.is_some() {
            return Err(
                "Fix the test JVM configuration and run tests again before rerunning failures."
                    .into(),
            );
        }
        if self.status != "ready" || self.summary.failed + self.summary.error == 0 {
            return Err("A complete fresh report with failing tests is required for rerun.".into());
        }
        self.maven_rerun_projects.as_ref().map_err(Clone::clone)?;
        self.select_failures(self.suites.iter().flat_map(|suite| &suite.cases))
    }

    fn select_failures<'a>(&self, cases: impl Iterator<Item = &'a Case>) -> Result<Vec<String>, String> {
        let mut selections = BTreeSet::new();
        for case in cases.filter(|case| matches!(case.state.as_str(), "failed" | "error")) {
            if !super::main_class(&case.class_name) {
                return Err(
                    "A failed test has no usable Java class name; select it manually.".into(),
                );
            }
            // A display/parameterized name is not a Java method identity. Rerun its class.
            let method = self
                .rerun_methods
                .get(&case.id)
                .map(|method| method.as_deref())
                .unwrap_or_else(|| identifier(&case.name).then_some(case.name.as_str()));
            let selector = if let Some(method) = method {
                format!("{}#{method}", case.class_name)
            } else {
                case.class_name.clone()
            };
            if selector.len() > 512 {
                return Err("A failed test selection is too long.".into());
            }
            selections.insert(selector);
        }
        // A whole-class selection already covers its method selections.
        let classes: BTreeSet<_> = selections
            .iter()
            .filter(|value| !value.contains('#'))
            .cloned()
            .collect();
        selections.retain(|value| {
            value
                .split_once('#')
                .is_none_or(|(class, _)| !classes.contains(class))
        });
        if selections.len() > 256 {
            return Err(
                "Too many failing selections; run a selected class or the whole test task.".into(),
            );
        }
        Ok(selections.into_iter().collect())
    }
}
fn maven_report_module<'a>(report: &'a Path, reactor: &Path) -> Option<&'a Path> {
    let report = report.strip_prefix(reactor).ok()?;
    let reports = report.parent()?;
    let name = report.file_name()?.to_str()?;
    if !name.starts_with("TEST-") || !name.ends_with(".xml")
        || !matches!(reports.file_name()?.to_str()?, "surefire-reports" | "failsafe-reports")
    {
        return None;
    }
    let target = reports.parent()?;
    if target.file_name()? != "target" {
        return None;
    }
    target.parent()
}

fn custom_maven_report_module<'a>(
    report: &Path,
    project: &Path,
    basedir: &'a ReportBasedir,
) -> Option<&'a Path> {
    let ReportBasedir::Present(module) = basedir else {
        return None;
    };
    if !module.is_absolute() || !module.starts_with(project) || !report.starts_with(module) {
        return None;
    }

    // A custom report must agree with the nearest descriptor on its real path.
    let directory = report.parent()?.ancestors().take_while(|directory| directory.starts_with(module))
        .find(|directory| directory.join("pom.xml").symlink_metadata().is_ok())?;
    let pom = directory.join("pom.xml");
    (directory == module && pom.is_file() && pom.canonicalize().ok().as_ref() == Some(&pom))
        .then_some(module)
}

fn identifier(value: &str) -> bool {
    super::java_names::identifier(value)
}

#[derive(PartialEq, Eq)]
struct Fingerprint {
    modified: SystemTime,
    length: u64,
    digest: String,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}
fn fingerprint(metadata: &Metadata, bytes: &[u8]) -> Result<Fingerprint, String> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Ok(Fingerprint {
        modified: metadata
            .modified()
            .map_err(|_| "Cannot establish report modification time.")?,
        length: metadata.len(),
        digest: format!("{:x}", Sha256::digest(bytes)),
        #[cfg(unix)]
        identity: (
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec(),
        ),
    })
}
fn read_report(workspace: &Path, path: &Path) -> Result<(Vec<u8>, Fingerprint), String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "A test report is unavailable.")?;
    if canonical != path || !canonical.starts_with(workspace) {
        return Err("Test report paths must remain inside the workspace without symlinks.".into());
    }
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(&canonical)
        .map_err(|_| "A test report is unreadable.")?;
    let before = file
        .metadata()
        .map_err(|_| "A test report is unavailable.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.nlink() != 1 {
            return Err("Hard-linked test reports are unavailable.".into());
        }
    }
    if !before.is_file() || before.len() as usize > MAX_FILE {
        return Err("A test report is not a regular file or exceeds 2 MiB.".into());
    }
    let mut bytes = Vec::new();
    (&file)
        .take((MAX_FILE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "A test report is unreadable.")?;
    let after = file
        .metadata()
        .map_err(|_| "A test report changed while being read.")?;
    if bytes.len() > MAX_FILE
        || before.len() != bytes.len() as u64
        || fingerprint(&before, &bytes)? != fingerprint(&after, &bytes)?
    {
        return Err("A test report changed while being read or exceeded its limit.".into());
    }
    let fingerprint = fingerprint(&after, &bytes)?;
    Ok((bytes, fingerprint))
}

pub struct Tracker {
    workspace: PathBuf,
    project: PathBuf,
    custom: Vec<PathBuf>,
    build_tool: String,
    integration_tests: bool,
    baseline: Result<BTreeMap<PathBuf, Fingerprint>, String>,
}
impl Tracker {
    #[cfg(test)]
    pub fn prepare(workspace: &Path, project: &Path, build_tool: &str, paths: &[String]) -> Self {
        Self::prepare_for_operation(workspace, project, build_tool, paths, "test")
    }
    pub fn prepare_for_operation(
        workspace: &Path,
        project: &Path,
        build_tool: &str,
        paths: &[String],
        operation: &str,
    ) -> Self {
        let mut tracker = Self {
            workspace: workspace.into(),
            project: project.into(),
            build_tool: build_tool.into(),
            custom: paths.iter().map(|path| workspace.join(path)).collect(),
            integration_tests: ["integration-test", "integration-coverage"].contains(&operation),
            baseline: Ok(BTreeMap::new()),
        };
        tracker.baseline = tracker.inventory().map(|reports| {
            reports
                .into_iter()
                .map(|(path, (_, fp))| (path, fp))
                .collect()
        });
        tracker
    }
    fn inventory(&self) -> Result<BTreeMap<PathBuf, (Vec<u8>, Fingerprint)>, String> {
        let mut paths = BTreeSet::new();
        let mut scanned = 0;
        let deadline = Instant::now() + Duration::from_secs(2);
        if self.custom.is_empty() {
            self.walk(&self.project, false, 0, &mut scanned, deadline, &mut paths)?;
        } else {
            for directory in &self.custom {
                self.walk(directory, true, 0, &mut scanned, deadline, &mut paths)?;
            }
        }
        let mut bytes = 0;
        paths
            .into_iter()
            .map(|path| {
                if Instant::now() >= deadline {
                    return Err("Test report inspection exceeded its time limit.".into());
                }
                let value = read_report(&self.workspace, &path)?;
                bytes += value.0.len();
                if bytes > MAX_BYTES {
                    return Err("Test reports exceed the 8 MiB aggregate limit.".into());
                }
                Ok((path, value))
            })
            .collect()
    }
    fn walk(
        &self,
        directory: &Path,
        reports: bool,
        depth: usize,
        scanned: &mut usize,
        deadline: Instant,
        paths: &mut BTreeSet<PathBuf>,
    ) -> Result<(), String> {
        if depth > 32 || *scanned > 20_000 || Instant::now() >= deadline {
            return Err("Test report discovery exceeded its traversal limit.".into());
        }
        let metadata = match fs::symlink_metadata(directory) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err("A test report directory is inaccessible.".into()),
        };
        if !metadata.is_dir() || metadata.is_symlink() {
            return Err(
                "Test report directories must be regular directories without symlinks.".into(),
            );
        }
        let canonical = directory
            .canonicalize()
            .map_err(|_| "A test report directory is unavailable.")?;
        if canonical != directory || !canonical.starts_with(&self.workspace) {
            return Err(
                "A test report directory escapes the workspace or contains a symlink.".into(),
            );
        }
        for entry in
            fs::read_dir(directory).map_err(|_| "A test report directory is unreadable.")?
        {
            *scanned += 1;
            if *scanned > 20_000 || Instant::now() >= deadline {
                return Err("Test report traversal limit exceeded.".into());
            }
            let entry = entry.map_err(|_| "Cannot inspect a test report directory.")?;
            let kind = entry
                .file_type()
                .map_err(|_| "Cannot inspect a test report path.")?;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if kind.is_symlink() {
                if reports {
                    return Err("Symlinked test reports are unavailable.".into());
                }
                continue;
            }
            if kind.is_dir() {
                // Surefire owns XML files directly in each report directory. TestNG's
                // nested junitreports are additional copies, without Surefire properties.
                if reports && self.build_tool == "maven" {
                    continue;
                }
                if !reports && name == "target" {
                    if self.build_tool == "maven" {
                        let report_directory = if self.integration_tests {
                            "failsafe-reports"
                        } else {
                            "surefire-reports"
                        };
                        self.walk(
                            &path.join(report_directory),
                            true,
                            depth + 1,
                            scanned,
                            deadline,
                            paths,
                        )?;
                    }
                } else if !reports && name == "build" {
                    if self.build_tool == "gradle" {
                        self.walk(
                            &path.join("test-results"),
                            true,
                            depth + 1,
                            scanned,
                            deadline,
                            paths,
                        )?;
                    }
                } else if reports
                    || ![
                        ".git",
                        ".ide",
                        ".refactorkit",
                        "node_modules",
                        "dist",
                        ".gradle",
                        ".mvn",
                    ]
                    .contains(&name.as_ref())
                {
                    self.walk(&path, reports, depth + 1, scanned, deadline, paths)?;
                }
            } else if reports && name.starts_with("TEST-") && name.ends_with(".xml") {
                if !kind.is_file() {
                    return Err("A test report is not a regular file.".into());
                }
                paths.insert(path);
                if paths.len() > MAX_REPORTS {
                    return Err("Too many JUnit XML reports (limit 512).".into());
                }
            }
        }
        Ok(())
    }
    #[cfg(test)]
    pub fn finish(&self, project_path: &str) -> TestResults {
        self.finish_with_jvm_options(project_path, None)
    }
    pub fn finish_with_jvm_options(
        &self,
        project_path: &str,
        expected_marker: Option<&str>,
    ) -> TestResults {
        self.finish_reports(project_path, expected_marker, true)
    }

    pub(super) fn verify_optional_test_jvm_options(&self, marker: &str) -> Option<String> {
        self.finish_reports("", Some(marker), false).test_jvm_options_error
    }

    fn finish_reports(
        &self,
        project_path: &str,
        expected_marker: Option<&str>,
        require_populated_reports: bool,
    ) -> TestResults {
        let mut result = TestResults::collecting(project_path, &self.build_tool);
        let report_tool = if self.integration_tests {
            "Failsafe"
        } else {
            "Surefire"
        };
        result.test_jvm_options_error = expected_marker.map(|_| format!("The requested test JVM options were not confirmed in every fresh {report_tool} report. The project may override argLine, run tests without a fork, skip tests, or omit report properties. The displayed exit code belongs to the build tool; these results do not confirm the requested configuration."));
        let baseline = match &self.baseline {
            Ok(value) => value,
            Err(error) => {
                result.unavailable(&format!(
                    "Report freshness could not be established: {error}"
                ));
                return result;
            }
        };
        let reports = match self.inventory() {
            Ok(value) => value,
            Err(error) => {
                result.unavailable(&error);
                return result;
            }
        };
        let mut refused = 0;
        let mut unconfirmed = 0;
        for (path, (bytes, fp)) in reports {
            if baseline.get(&path) == Some(&fp) {
                result.unchanged_reports += 1;
                continue;
            }
            let relative = path
                .strip_prefix(&self.workspace)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            match parse_report(&bytes, &relative) {
                Ok(mut suites)
                    if result.suites.len() + suites.len() <= 2048
                        && result.summary.total
                            + suites.iter().map(|suite| suite.cases.len()).sum::<usize>()
                            <= MAX_CASES =>
                {
                    if let Some(marker) = expected_marker {
                        if suites.iter().any(|suite| !suite.cases.is_empty())
                            && !report_confirms_jvm_options(&bytes, marker)
                        {
                            unconfirmed += 1;
                        }
                    }
                    for case in suites.iter().flat_map(|suite| &suite.cases) {
                        result.summary.add(case);
                    }
                    if self.build_tool == "maven" {
                        for suite in &mut suites {
                            if self.custom.is_empty() {
                                suite.maven_module = maven_report_module(&path, &self.project)
                                    .map(Path::to_path_buf);
                            } else if let Some(module) = custom_maven_report_module(&path, &self.project, &suite.reported_basedir) {
                                suite.maven_module = module.strip_prefix(&self.project).ok().map(Path::to_path_buf);
                                suite.maven_report_module_path = module.strip_prefix(&self.workspace).ok()
                                    .and_then(Path::to_str)
                                    .map(|path| path.replace('\\', "/"));
                            }
                            suite.reported_basedir = ReportBasedir::Missing;
                        }
                    }
                    result.suites.extend(suites);
                }
                _ => refused += 1,
            }
        }
        result.status = if refused > 0 && result.summary.total > 0 {
            "partial"
        } else if result.summary.total > 0 {
            "ready"
        } else {
            "unavailable"
        }
        .into();
        result.message = if refused > 0 {
            Some(format!("{refused} fresh reports could not be read as bounded JUnit XML. Displayed results are incomplete."))
        } else if result.summary.total == 0 {
            Some("No fresh test cases were reported. The build may have failed before testing, skipped tests, or reused up-to-date/cached reports. Check the console or configured report directories.".into())
        } else if result.unchanged_reports > 0 {
            Some(format!(
                "{} unchanged reports were omitted; they belong to an earlier test execution.",
                result.unchanged_reports
            ))
        } else {
            None
        };
        if result.summary.total == 0 {
            result.suites.clear();
        }
        if (!require_populated_reports || result.summary.total > 0)
            && refused == 0
            && unconfirmed == 0
        {
            result.test_jvm_options_error = None;
        }
        result.refresh_rerun();
        if serde_json::to_vec(&result).map_or(true, |bytes| bytes.len() > MAX_BYTES) {
            result.unavailable("Structured test results exceed the 8 MiB presentation limit.");
        }
        result
    }
}

/// Inspect only properties belonging to a populated suite in already-validated, bounded XML.
fn report_confirms_jvm_options(bytes: &[u8], expected: &str) -> bool {
    let mut reader = Reader::from_reader(bytes);
    let mut stack: Vec<String> = vec![];
    let mut suites: Vec<(usize, usize, bool)> = vec![];
    let mut populated = 0;
    loop {
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(_) => return false,
        };
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(ref event) | Event::Empty(ref event) => {
                let name = match std::str::from_utf8(event.name().as_ref()) {
                    Ok(name) => name.to_owned(),
                    Err(_) => return false,
                };
                if name == "testsuite" {
                    suites.push((stack.len(), 0, false));
                } else if name == "testcase" {
                    if let Some(suite) = suites.last_mut() {
                        suite.1 += 1;
                    }
                } else if name == "property"
                    && stack.last().is_some_and(|name| name == "properties")
                {
                    if let Some(suite) = suites.last_mut() {
                        if stack.len() == suite.0 + 2 {
                            if let Ok(attrs) = attributes(&reader, event) {
                                if attrs
                                    .get("name")
                                    .is_some_and(|name| name == "ide.test.jvm.options")
                                {
                                    if suite.2
                                        || attrs.get("value").is_none_or(|value| value != expected)
                                    {
                                        return false;
                                    }
                                    suite.2 = true;
                                }
                            } else {
                                return false;
                            }
                        }
                    }
                }
                if empty {
                    if name == "testsuite" {
                        suites.pop();
                    }
                } else {
                    stack.push(name);
                }
            }
            Event::End(event) => {
                let name = match std::str::from_utf8(event.name().as_ref()) {
                    Ok(name) => name.to_owned(),
                    Err(_) => return false,
                };
                if name == "testsuite" {
                    let Some((_, cases, confirmed)) = suites.pop() else {
                        return false;
                    };
                    if cases > 0 {
                        populated += 1;
                        if !confirmed {
                            return false;
                        }
                    }
                }
                stack.pop();
            }
            Event::Eof => return populated > 0,
            _ => (),
        }
    }
}

fn attributes(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    for attr in event.attributes() {
        let attr = attr.map_err(|_| "Invalid XML attributes.")?;
        let key = std::str::from_utf8(attr.key.as_ref()).map_err(|_| "Non-UTF-8 XML name.")?;
        let value = attr
            .decode_and_unescape_value(reader.decoder())
            .map_err(|_| "Invalid XML entity or encoding.")?;
        if key.len() > 128 || values.len() >= 128 || value.len() > MAX_FILE {
            return Err("XML attribute limit exceeded.".into());
        }
        values.insert(key.to_string(), value.into_owned());
    }
    Ok(values)
}
fn label(value: Option<&String>, fallback: &str) -> Result<String, String> {
    let value = value.map(String::as_str).unwrap_or(fallback);
    if value.is_empty() || value.len() > 4096 || value.contains('\0') {
        return Err("Invalid test name.".into());
    }
    Ok(value.into())
}
fn append(case: &mut Case, text: &str) {
    let available = MAX_DETAIL.saturating_sub(case.detail.len());
    let mut end = text.len().min(available);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    case.detail.push_str(&text[..end]);
    case.detail_truncated |= end < text.len();
}
struct Tag {
    name: String,
    suite: Option<usize>,
    case: Option<usize>,
    detail: bool,
    counts: BTreeMap<String, usize>,
    start: Summary,
}
pub(super) fn parse_report(bytes: &[u8], path: &str) -> Result<Vec<Suite>, String> {
    if bytes.len() > MAX_FILE {
        return Err("Oversized XML report.".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "JUnit reports must use UTF-8.")?;
    let mut reader = Reader::from_str(text);
    reader.config_mut().check_comments = true;
    let mut stack: Vec<Tag> = Vec::new();
    let mut suites: Vec<Suite> = Vec::new();
    let mut summary = Summary::default();
    let mut root = false;
    let mut events = 0;
    let prefix = format!("{:x}", Sha256::digest(path.as_bytes()));
    loop {
        events += 1;
        if events > 200_000 {
            return Err("XML event limit exceeded.".into());
        }
        let event = reader
            .read_event()
            .map_err(|_| "Malformed JUnit XML report.")?;
        match event {
            Event::DocType(_) | Event::PI(_) => {
                return Err(
                    "DTD and processing instructions are not supported in JUnit XML.".into(),
                )
            }
            Event::Start(ref e) | Event::Empty(ref e) => {
                let name = std::str::from_utf8(e.name().as_ref())
                    .map_err(|_| "Invalid XML element.")?
                    .to_string();
                if stack.len() >= 32 || name.len() > 128 {
                    return Err("XML nesting limit exceeded.".into());
                }
                let attrs = attributes(&reader, e)?;
                if stack.is_empty() {
                    if root || !["testsuite", "testsuites"].contains(&name.as_str()) {
                        return Err("Expected one JUnit XML root.".into());
                    }
                    root = true;
                }
                let parent = stack.last();
                let mut tag = Tag {
                    name: name.clone(),
                    suite: parent.and_then(|tag| tag.suite),
                    case: parent.and_then(|tag| tag.case),
                    detail: parent.is_some_and(|tag| tag.detail),
                    counts: BTreeMap::new(),
                    start: summary.clone(),
                };
                if ["testsuite", "testsuites"].contains(&name.as_str()) {
                    if parent.is_some_and(|tag| {
                        !["testsuite", "testsuites"].contains(&tag.name.as_str())
                    }) {
                        return Err("Invalid test suite nesting.".into());
                    }
                    for key in ["tests", "failures", "errors", "skipped"] {
                        if let Some(value) = attrs.get(key) {
                            let count = value
                                .parse::<usize>()
                                .map_err(|_| "Invalid test suite counts.")?;
                            if count > MAX_CASES {
                                return Err("Too many test cases.".into());
                            }
                            tag.counts.insert(key.into(), count);
                        }
                    }
                    if name == "testsuite" {
                        if suites.len() >= 2048 {
                            return Err("Too many test suites.".into());
                        }
                        let index = suites.len();
                        suites.push(Suite {
                            report_path: path.into(),
                            maven_module: None,
                            maven_report_module_path: None,
                            reported_basedir: ReportBasedir::Missing,
                            name: label(attrs.get("name"), "Test suite")?,
                            cases: vec![],
                        });
                        tag.suite = Some(index);
                        tag.case = None;
                    }
                } else if name == "property"
                    && attrs.get("name").is_some_and(|name| name == "basedir")
                    && parent.is_some_and(|tag| tag.name == "properties")
                    && stack.iter().rev().nth(1).is_some_and(|tag| tag.name == "testsuite")
                {
                    if let Some(suite) = tag.suite {
                        suites[suite].reported_basedir.record(attrs.get("value"));
                    }
                } else if name == "testcase" {
                    if parent.is_none_or(|tag| tag.name != "testsuite")
                        || summary.total >= MAX_CASES
                    {
                        return Err("Invalid test case position or case limit.".into());
                    }
                    let suite = tag.suite.ok_or("Test case has no suite.")?;
                    let duration = attrs
                        .get("time")
                        .map(|value| value.parse::<f64>().map(|seconds| seconds * 1000.0))
                        .transpose()
                        .map_err(|_| "Invalid test duration.")?;
                    if duration
                        .is_some_and(|value| !value.is_finite() || !(0.0..=1e12).contains(&value))
                    {
                        return Err("Invalid test duration.".into());
                    }
                    let class = attrs.get("classname").cloned().unwrap_or_default();
                    if class.len() > 512 || class.contains('\0') {
                        return Err("Invalid test class name.".into());
                    }
                    tag.case = Some(suites[suite].cases.len());
                    suites[suite].cases.push(Case {
                        id: format!("{}-{}", &prefix[..16], summary.total),
                        name: label(attrs.get("name"), "Unnamed test")?,
                        class_name: class,
                        state: "passed".into(),
                        duration_ms: duration,
                        detail: String::new(),
                        detail_truncated: false,
                        method_source: None,
                    });
                } else if [
                    "failure",
                    "error",
                    "skipped",
                    "flakyFailure",
                    "flakyError",
                    "rerunFailure",
                    "rerunError",
                ]
                .contains(&name.as_str())
                {
                    if parent.is_none_or(|tag| tag.name != "testcase") {
                        return Err("Test outcome has no test case.".into());
                    }
                    let case = &mut suites[tag.suite.unwrap()].cases[tag.case.unwrap()];
                    let state = match name.as_str() {
                        "failure" | "rerunFailure" => "failed",
                        "error" | "rerunError" => "error",
                        "skipped" => "skipped",
                        _ => "flaky",
                    };
                    if case.state == "passed"
                        || state == "error"
                        || (case.state == "flaky" && state == "failed")
                    {
                        case.state = state.into();
                    }
                    for key in ["type", "message"] {
                        if let Some(value) = attrs.get(key) {
                            append(case, value);
                            append(case, "\n");
                        }
                    }
                    tag.detail = true;
                } else if ["system-out", "system-err"].contains(&name.as_str())
                    && tag.case.is_some()
                {
                    tag.detail = true;
                }
                let empty = matches!(event, Event::Empty(_));
                stack.push(tag);
                if empty {
                    close_tag(&mut stack, &suites, &mut summary)?;
                }
            }
            Event::End(_) => close_tag(&mut stack, &suites, &mut summary)?,
            Event::Text(e) => {
                let text = e.xml_content().map_err(|_| "Invalid report text.")?;
                append_text(&stack, &mut suites, &text)?;
            }
            Event::CData(e) => append_text(
                &stack,
                &mut suites,
                &e.xml_content().map_err(|_| "Invalid report text.")?,
            )?,
            Event::GeneralRef(e) => {
                let value = e.decode().map_err(|_| "Invalid XML reference.")?;
                let escaped = format!("&{value};");
                let value =
                    quick_xml::escape::unescape(&escaped).map_err(|_| "Unsupported XML entity.")?;
                append_text(&stack, &mut suites, &value)?;
            }
            Event::Decl(e) => {
                if root
                    || e.encoding().is_some_and(|encoding| {
                        encoding.is_err() || !encoding.unwrap().eq_ignore_ascii_case(b"UTF-8")
                    })
                {
                    return Err("Only UTF-8 XML declarations are supported.".into());
                }
            }
            Event::Eof => break,
            Event::Comment(_) => {}
        }
    }
    if !root || !stack.is_empty() || suites.is_empty() {
        return Err("Incomplete JUnit XML report.".into());
    }
    Ok(suites)
}
fn append_text(stack: &[Tag], suites: &mut [Suite], text: &str) -> Result<(), String> {
    if let Some(tag) = stack.last() {
        if tag.detail {
            if let (Some(suite), Some(case)) = (tag.suite, tag.case) {
                append(&mut suites[suite].cases[case], text);
            }
        }
    } else if !text.trim().is_empty() {
        return Err("Text outside the XML root.".into());
    }
    Ok(())
}
fn close_tag(stack: &mut Vec<Tag>, suites: &[Suite], summary: &mut Summary) -> Result<(), String> {
    let tag = stack.pop().ok_or("Unexpected XML closing element.")?;
    if tag.name == "testcase" {
        summary.add(&suites[tag.suite.unwrap()].cases[tag.case.unwrap()]);
    }
    for (key, expected) in tag.counts {
        let actual = match key.as_str() {
            "tests" => summary.total - tag.start.total,
            "failures" => summary.failed - tag.start.failed,
            "errors" => summary.error - tag.start.error,
            _ => summary.skipped - tag.start.skipped,
        };
        if actual != expected {
            return Err("JUnit suite counts do not match reported test cases.".into());
        }
    }
    Ok(())
}
