//! JaCoCo measurements belong to an owned test execution; older reports cannot satisfy it.
use super::{launch_settings::LaunchFile, Job};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};
#[path = "coverage/xml.rs"]
mod xml;
pub(super) const VERSION: &str = "0.8.15";
const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_REPORTS: usize = 128;
const MAX_FILES: usize = 2000;
const MAX_LINES: usize = 100_000;
#[derive(Clone, Debug, Default, Serialize)]
pub struct Counter {
    missed: u32,
    covered: u32,
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct Counters {
    instructions: Counter,
    branches: Counter,
    lines: Counter,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageLine {
    number: u32,
    missed_instructions: u32,
    covered_instructions: u32,
    missed_branches: u32,
    covered_branches: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageFile {
    id: String,
    report_path: String,
    module_root: Option<String>,
    package_name: String,
    name: String,
    counters: Counters,
    lines: Vec<CoverageLine>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TestSelection {
    source_set: Option<String>,
    selector_count: usize,
    selectors: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageResults {
    pub status: String,
    provider: String,
    version: String,
    project_path: String,
    build_tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    test_selection: Option<TestSelection>,
    counters: Counters,
    files: Vec<CoverageFile>,
    reports: usize,
    pub message: Option<String>,
}
impl CoverageResults {
    pub fn collecting(project: &str, tool: &str) -> Self {
        Self {
            status: "collecting".into(),
            provider: "jacoco".into(),
            version: VERSION.into(),
            project_path: project.into(),
            build_tool: tool.into(),
            test_selection: None,
            counters: Counters::default(),
            files: vec![],
            reports: 0,
            message: None,
        }
    }
    pub fn unavailable(&mut self, message: &str) {
        self.status = "unavailable".into();
        self.message = Some(message.into());
        self.files.clear();
        self.counters = Counters::default();
        self.reports = 0;
    }
}
#[derive(Debug)]
pub(super) struct CoverageArtifact {
    pub settings: LaunchFile,
    pub token: String,
    workspace: PathBuf,
    project: PathBuf,
    pub tool: String,
    project_path: String,
    test_selection: TestSelection,
    gradle_task: Option<String>,
    gradle_report_task: Option<String>,
    integration_test_coverage: bool,
}
impl CoverageArtifact {
    pub(super) fn create(
        workspace: &Path,
        project: &Path,
        project_path: &str,
        tool: &str,
        source_set: Option<&str>,
        test_jvm_options: &[String],
        selectors: &[String],
        integration_test_coverage: bool,
        project_module_root: Option<&Path>,
    ) -> Result<Self, String> {
        if tool == "maven" && integration_test_coverage {
            reset_maven_integration_data(project)?;
        }
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Cannot identify the coverage execution.")?;
        let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let mut settings = LaunchFile::create("coverage.init.gradle", b"")?;
        let output = settings
            .path
            .parent()
            .ok_or("Coverage storage is unavailable.")?
            .join("reports");
        let gradle_task = (tool == "gradle" && source_set.is_some())
            .then(|| format!("ideCoverageJavaSourceSetTest{token}"));
        let gradle_report_task = (tool == "gradle" && project_module_root.is_some())
            .then(|| format!("ideCoverageReports{token}"));
        let module_root = project_module_root
            .map(|path| path.to_str().ok_or("Coverage module path must be UTF-8."))
            .transpose()?;
        let data = serde_json::to_vec(&serde_json::json!({
            "root":project.to_str().ok_or("Coverage project path must be UTF-8.")?,
            "workspace":workspace.to_str().ok_or("Coverage workspace path must be UTF-8.")?,
            "moduleRoot":module_root,
            "output":output.to_str().ok_or("Coverage storage path must be UTF-8.")?,
            "session":token,
            "version":VERSION,
            "sourceSet":source_set,
            "task":gradle_task,
            "reportTask":gradle_report_task,
            "testJvmOptions":test_jvm_options,
            "selectors":selectors
        }))
        .map_err(|_| "Cannot encode coverage settings.")?;
        let encoded = STANDARD.encode(data);
        let script = format!(
            r#"def ideCoverage = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{encoded}'), 'UTF-8'))
gradle.projectsEvaluated {{
    def currentBuildPath = gradle.buildPath
    def selectedRoot = new File(ideCoverage.root).canonicalFile.toPath()
    def workspaceRoot = new File(ideCoverage.workspace).canonicalFile.toPath()
    def selectedProject = null
    def selectedTestSourceSet = null
    def selectedRuntimeConfiguration = null
    def selectedJacocoClasspath = null
    def selectedTests = null
    def dependencyManifest = new File(ideCoverage.output, 'dependencies.json')
    def classpathManifest = new File(ideCoverage.output, 'jacoco-classpath.json')
    def projects
    if (ideCoverage.moduleRoot != null) {{
        def moduleRoot = new File(ideCoverage.moduleRoot).canonicalFile.toPath()
        selectedProject = gradle.rootProject.allprojects.find {{ p -> p.projectDir.canonicalFile.toPath() == moduleRoot }}
        projects = gradle.rootProject.allprojects.findAll {{ p -> p.plugins.hasPlugin('java') }}
        if (selectedProject != null) {{
            if (!selectedProject.plugins.hasPlugin('java')) throw new org.gradle.api.GradleException('The selected Java module is unavailable for coverage.')
            selectedProject.pluginManager.apply('jacoco')
            selectedProject.extensions.getByType(org.gradle.testing.jacoco.plugins.JacocoPluginExtension).toolVersion = ideCoverage.version
            selectedJacocoClasspath = selectedProject.configurations.getByName('jacocoAnt')
            def sourceSets = selectedProject.extensions.findByType(org.gradle.api.tasks.SourceSetContainer)
            selectedTestSourceSet = sourceSets == null ? null : sourceSets.findByName(ideCoverage.sourceSet == null ? 'test' : ideCoverage.sourceSet)
            if (selectedTestSourceSet == null) throw new org.gradle.api.GradleException('The selected Java test source set is unavailable for coverage.')
            selectedRuntimeConfiguration = selectedProject.configurations.findByName(selectedTestSourceSet.runtimeClasspathConfigurationName)
            if (selectedRuntimeConfiguration == null) throw new org.gradle.api.GradleException('The selected Java test runtime classpath is unavailable for coverage.')
        }}
    }} else {{
        projects = gradle.rootProject.allprojects.findAll {{ p -> p.projectDir.canonicalFile.toPath().startsWith(selectedRoot) && p.plugins.hasPlugin('java') }}
    }}
    if (projects.size() > 128) throw new org.gradle.api.GradleException('Coverage supports at most 128 Java projects in each Gradle build.')
    if (ideCoverage.moduleRoot == null && projects.size() == 0) return
    if (ideCoverage.moduleRoot != null && selectedProject != null && !projects.contains(selectedProject)) throw new org.gradle.api.GradleException('The selected Java module is unavailable for coverage.')
    if (ideCoverage.moduleRoot == null && ideCoverage.sourceSet != null) {{
        projects = projects.findAll {{ p -> p.projectDir.canonicalFile.toPath() == selectedRoot }}
        if (projects.size() != 1) throw new org.gradle.api.GradleException('The selected Java module is unavailable for coverage.')
    }}
    def reportTasks = []
    projects.sort {{ it.path }}.each {{ p ->
        p.pluginManager.apply('jacoco')
        p.extensions.getByType(org.gradle.testing.jacoco.plugins.JacocoPluginExtension).toolVersion = ideCoverage.version
        def selectedSourceSet = null
        def tests = null
        if (ideCoverage.moduleRoot != null && selectedProject != null && p == selectedProject) {{
            selectedSourceSet = selectedTestSourceSet
            if (ideCoverage.sourceSet != null) {{
                def expectedClasses = selectedSourceSet.output.classesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
                if (expectedClasses.isEmpty()) throw new org.gradle.api.GradleException('The selected source set has no compiled test classes.')
                def candidates = p.tasks.withType(org.gradle.api.tasks.testing.Test).findAll {{ candidate ->
                    def actualClasses = candidate.testClassesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
                    actualClasses == expectedClasses
                }}
                if (candidates.size() > 1) {{
                    def sourceRuntime = selectedSourceSet.runtimeClasspath
                    candidates = candidates.findAll {{ candidate -> candidate.classpath == sourceRuntime }}
                }}
                if (candidates.size() != 1) throw new org.gradle.api.GradleException('The selected source set must map to exactly one Gradle Test task with matching test classes.')
                def testTask = candidates.first()
                if (!testTask.enabled) throw new org.gradle.api.GradleException('The selected Gradle Test task is disabled.')
                tests = p.tasks.named(testTask.name, org.gradle.api.tasks.testing.Test)
                tests.configure {{ t ->
                    t.dependsOn(p.tasks.named(selectedSourceSet.classesTaskName))
                    t.outputs.upToDateWhen {{ false }}
                    t.doFirst {{
                        def expectedRuntime = selectedSourceSet.runtimeClasspath.files.collect {{ it.canonicalFile.toPath() }} as Set
                        def actualClasspath = t.classpath.files.collect {{ it.canonicalFile.toPath() }} as Set
                        if (!expectedRuntime.every {{ actualClasspath.contains(it) }}) throw new org.gradle.api.GradleException('The selected Gradle Test task does not contain the source set runtime classpath.')
                    }}
                    if (!ideCoverage.testJvmOptions.isEmpty()) t.jvmArgs(ideCoverage.testJvmOptions)
                    if (!ideCoverage.selectors.isEmpty()) t.filter {{ ideCoverage.selectors.each {{ includeTestsMatching(it.replace('#', '.')) }} }}
                }}
                p.tasks.register(ideCoverage.task) {{ dependsOn(tests) }}
            }} else {{
                tests = p.tasks.named('test', org.gradle.api.tasks.testing.Test)
            }}
            selectedTests = tests
            tests.configure {{ t ->
                t.doFirst {{
                    def resolution = selectedRuntimeConfiguration.incoming.resolutionResult
                    def dependencyProjects = new LinkedHashSet()
                    dependencyProjects.add([buildPath: currentBuildPath, projectPath: selectedProject.path])
                    resolution.allComponents.each {{ component ->
                        if (component.id instanceof org.gradle.api.artifacts.component.ProjectComponentIdentifier) {{
                            dependencyProjects.add([buildPath: component.id.build.buildPath, projectPath: component.id.projectPath])
                        }}
                    }}
                    if (dependencyProjects.size() > 128) throw new org.gradle.api.GradleException('Coverage supports at most 128 resolved Gradle project dependencies.')
                    if (!dependencyManifest.parentFile.isDirectory() && !dependencyManifest.parentFile.mkdirs()) throw new org.gradle.api.GradleException('The coverage dependency manifest directory is unavailable.')
                    if (!classpathManifest.parentFile.isDirectory() && !classpathManifest.parentFile.mkdirs()) throw new org.gradle.api.GradleException('The coverage classpath manifest directory is unavailable.')
                    classpathManifest.setText(groovy.json.JsonOutput.toJson(selectedJacocoClasspath.files.collect {{ it.canonicalPath }}), 'UTF-8')
                    dependencyManifest.setText(groovy.json.JsonOutput.toJson(dependencyProjects), 'UTF-8')
                }}
            }}
        }} else if (ideCoverage.moduleRoot == null && ideCoverage.sourceSet != null) {{
            def sets = p.extensions.findByName('sourceSets')
            selectedSourceSet = sets == null ? null : sets.findByName(ideCoverage.sourceSet)
            if (selectedSourceSet == null) throw new org.gradle.api.GradleException('The selected Java source set is unavailable for coverage.')
            def expectedClasses = selectedSourceSet.output.classesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
            if (expectedClasses.isEmpty()) throw new org.gradle.api.GradleException('The selected source set has no compiled test classes.')
            def candidates = p.tasks.withType(org.gradle.api.tasks.testing.Test).findAll {{ candidate ->
                def actualClasses = candidate.testClassesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
                actualClasses == expectedClasses
            }}
            if (candidates.size() > 1) {{
                def sourceRuntime = selectedSourceSet.runtimeClasspath
                candidates = candidates.findAll {{ candidate -> candidate.classpath == sourceRuntime }}
            }}
            if (candidates.size() != 1) throw new org.gradle.api.GradleException('The selected source set must map to exactly one Gradle Test task with matching test classes.')
            def testTask = candidates.first()
            if (!testTask.enabled) throw new org.gradle.api.GradleException('The selected Gradle Test task is disabled.')
            tests = p.tasks.named(testTask.name, org.gradle.api.tasks.testing.Test)
            tests.configure {{ t ->
                t.dependsOn(p.tasks.named(selectedSourceSet.classesTaskName))
                t.outputs.upToDateWhen {{ false }}
                t.doFirst {{
                    def expectedRuntime = selectedSourceSet.runtimeClasspath.files.collect {{ it.canonicalFile.toPath() }} as Set
                    def actualClasspath = t.classpath.files.collect {{ it.canonicalFile.toPath() }} as Set
                    if (!expectedRuntime.every {{ actualClasspath.contains(it) }}) throw new org.gradle.api.GradleException('The selected Gradle Test task does not contain the source set runtime classpath.')
                }}
                if (!ideCoverage.testJvmOptions.isEmpty()) t.jvmArgs(ideCoverage.testJvmOptions)
                if (!ideCoverage.selectors.isEmpty()) t.filter {{ ideCoverage.selectors.each {{ includeTestsMatching(it.replace('#', '.')) }} }}
            }}
            p.tasks.register(ideCoverage.task) {{ dependsOn(tests) }}
        }} else if (ideCoverage.moduleRoot == null) {{
            tests = p.tasks.named('test', org.gradle.api.tasks.testing.Test)
        }}
        def reportProject = p
        def reportProjectDirectory = reportProject.projectDir.canonicalFile.toPath()
        def reportModuleRoot = reportProjectDirectory.startsWith(workspaceRoot)
            ? workspaceRoot.relativize(reportProjectDirectory).toString().replace(File.separator, '/')
            : null
        def reportIdentity = currentBuildPath + '\n' + reportProject.path
        def reportKey = new BigInteger(1, java.security.MessageDigest.getInstance('SHA-256').digest(reportIdentity.getBytes('UTF-8'))).toString(16).padLeft(64, '0')
        def reportDirectory = new File(ideCoverage.output, reportKey)
        if (!reportDirectory.isDirectory() && !reportDirectory.mkdirs() && !reportDirectory.isDirectory()) throw new org.gradle.api.GradleException('The private coverage report directory is unavailable.')
        def destination = ideCoverage.moduleRoot == null
            ? new File(reportDirectory, 'jacoco.exec')
            : new File(ideCoverage.output, 'project-dependencies/jacoco.exec')
        if (!destination.parentFile.isDirectory() && !destination.parentFile.mkdirs() && !destination.parentFile.isDirectory()) throw new org.gradle.api.GradleException('The private coverage execution-data directory is unavailable.')
        if (tests != null) tests.configure {{ t ->
            def agent = t.extensions.getByType(org.gradle.testing.jacoco.plugins.JacocoTaskExtension)
            agent.enabled = true
            agent.destinationFile = destination
            agent.sessionId = ideCoverage.session
            agent.dumpOnExit = true
            agent.output = org.gradle.testing.jacoco.plugins.JacocoTaskExtension.Output.FILE
        }}
        def report = p.tasks.register('ideCoverage' + ideCoverage.session, org.gradle.testing.jacoco.tasks.JacocoReport) {{ r ->
            executionData(destination)
            if (ideCoverage.moduleRoot != null) {{
                r.jacocoClasspath = p.files()
                doFirst {{
                    if (!classpathManifest.isFile()) throw new org.gradle.api.GradleException('The selected build did not produce a JaCoCo classpath manifest.')
                    r.jacocoClasspath = p.files(new groovy.json.JsonSlurper().parse(classpathManifest).collect {{ new File(it) }})
                }}
            }}
            // The selected source set chooses the Test task above. Coverage reports describe the
            // module's production Java code, even when that task is a custom integration-test set.
            def production = reportProject.extensions.getByType(org.gradle.api.tasks.SourceSetContainer).findByName('main')
            if (production == null) throw new org.gradle.api.GradleException('The selected Java module has no main source set for coverage.')
            sourceSets(production)
            reports {{ xml.required = true; xml.outputLocation = new File(reportDirectory, 'jacoco.xml'); html.required = false; csv.required = false }}
            if (ideCoverage.moduleRoot != null) onlyIf {{
                if (!dependencyManifest.isFile()) throw new org.gradle.api.GradleException('The selected test did not produce a coverage dependency manifest.')
                def dependencyProjects = new groovy.json.JsonSlurper().parse(dependencyManifest)
                def matched = dependencyProjects.any {{ dependency -> dependency.buildPath == currentBuildPath && dependency.projectPath == reportProject.path }}
                matched
            }}
            outputs.upToDateWhen {{ false }}
            doLast {{
                def metadata = new File(reportDirectory, 'module.json')
                if (!metadata.parentFile.isDirectory() && !metadata.parentFile.mkdirs()) throw new org.gradle.api.GradleException('The coverage report metadata directory is unavailable.')
                metadata.setText(groovy.json.JsonOutput.toJson([moduleRoot: reportModuleRoot]), 'UTF-8')
            }}
        }}
        if (ideCoverage.moduleRoot == null && tests != null) tests.configure {{ finalizedBy(report) }}
        reportTasks.add(report)
    }}
    if (ideCoverage.moduleRoot != null) {{
        def aggregate = gradle.rootProject.tasks.register(ideCoverage.reportTask) {{ dependsOn(reportTasks) }}
        gradle.includedBuilds.each {{ includedBuild -> aggregate.configure {{ dependsOn(includedBuild.task(':ideCoverageReports' + ideCoverage.session)) }} }}
        if (selectedProject != null) {{
            if (selectedTests == null) throw new org.gradle.api.GradleException('The selected Java Test task is unavailable for coverage.')
        }}
    }}
}}
"#
        );
        fs::write(&settings.path, script).map_err(|_| "Cannot write private coverage settings.")?;
        settings.test_jvm_marker = None;
        Ok(Self {
            settings,
            token,
            workspace: workspace.to_owned(),
            project: project.to_owned(),
            tool: tool.into(),
            project_path: project_path.into(),
            test_selection: TestSelection {
                source_set: source_set
                    .filter(|name| {
                        !name.is_empty() && name.len() <= 512 && !name.chars().any(char::is_control)
                    })
                    .map(str::to_owned),
                selector_count: selectors.len(),
                selectors: selectors.iter().take(3).cloned().collect(),
            },
            gradle_task,
            gradle_report_task,
            integration_test_coverage,
        })
    }
    pub(super) fn gradle_task(&self) -> Option<&str> {
        self.gradle_task.as_deref()
    }
    pub(super) fn gradle_report_task(&self) -> Option<&str> {
        self.gradle_report_task.as_deref()
    }
    pub(super) fn execution_data(&self) -> PathBuf {
        if self.integration_test_coverage && self.tool == "maven" {
            self.project.join("target/jacoco-it.exec")
        } else {
            self.settings.path.parent().unwrap().join("jacoco.exec")
        }
    }
    pub(super) fn maven_properties(&self, custom_options: bool) -> Vec<String> {
        let mut args = vec![
            format!("-Djacoco.destFile={}", self.execution_data().display()),
            format!("-Djacoco.dataFile={}", self.execution_data().display()),
            format!("-Djacoco.sessionId={}", self.token),
            "-Djacoco.append=true".into(),
            "-Djacoco.output=file".into(),
            "-Djacoco.dumpOnExit=true".into(),
            "-Djacoco.skip=false".into(),
        ];
        if custom_options {
            args.push("-Djacoco.propertyName=ide.coverage.agent".into());
        }
        args
    }
    pub(super) fn maven_prepare_goal(&self) -> &'static str {
        if self.integration_test_coverage {
            "prepare-agent-integration"
        } else {
            "prepare-agent"
        }
    }
    pub(super) fn maven_report_goal(&self) -> &'static str {
        if self.integration_test_coverage {
            "report-integration"
        } else {
            "report"
        }
    }
    pub(super) fn finish(&self, job: &Arc<Job>, report_error: Option<&str>) -> CoverageResults {
        let mut result = CoverageResults::collecting(&self.project_path, &self.tool);
        result.test_selection = Some(self.test_selection.clone());
        let directory = if self.tool == "gradle" {
            self.settings.path.parent().unwrap().join("reports")
        } else {
            self.project.clone()
        };
        let paths = match reports(
            &directory,
            self.tool == "maven",
            self.integration_test_coverage,
        ) {
            Ok(paths) => paths,
            Err(error) => {
                result.unavailable(&error);
                return result;
            }
        };
        let mut errors = Vec::new();
        let mut bytes = 0;
        let mut lines = 0;
        for path in paths {
            if job.cancelled.load(std::sync::atomic::Ordering::SeqCst)
                || !super::current_workspace_binding_is_current(&job.binding)
            {
                result.unavailable("Coverage stopped or the workspace changed.");
                return result;
            }
            let report_path = if self.tool == "gradle" {
                format!(
                    "coverage-report/{}/jacoco.xml",
                    path.parent()
                        .and_then(|p| p.file_name())
                        .unwrap_or_default()
                        .to_string_lossy()
                )
            } else {
                path.strip_prefix(&self.workspace)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/")
            };
            let parsed = read_report(&directory, &path).and_then(|data| {
                if report_path.len() > 4096 || report_path.chars().any(char::is_control) {
                    return Err("Coverage report path exceeds its presentation bounds.".into());
                }
                bytes += data.len();
                if bytes > MAX_BYTES {
                    return Err("Coverage reports exceed the 32 MiB import limit.".into());
                }
                xml::parse(&data, &report_path, &self.token)
            });
            match parsed {
                Ok((counters, mut files)) => {
                    let module_root = if self.tool == "gradle" {
                        gradle_report_module_root(&directory, &path)
                    } else {
                        None
                    };
                    for file in &mut files {
                        file.module_root = module_root.clone();
                    }
                    lines += files.iter().map(|file| file.lines.len()).sum::<usize>();
                    if result.files.len() + files.len() > MAX_FILES || lines > MAX_LINES {
                        errors.push(
                            "Coverage files or lines exceed their presentation limit.".into(),
                        );
                        break;
                    }
                    if let Err(error) = result.counters.add(&counters) {
                        errors.push(error);
                        break;
                    }
                    result.files.extend(files);
                    result.reports += 1;
                }
                Err(error) => errors.push(error),
            }
        }
        if let Some(error) = report_error {
            errors.push(error.into());
        }
        if result.reports == 0 {
            result.unavailable(errors.first().map(String::as_str).unwrap_or("No JaCoCo report from this execution was produced. Check test forking, agent settings and Java debug information."));
        } else {
            result.status = if errors.is_empty() {
                "ready"
            } else {
                "partial"
            }
            .into();
            if !errors.is_empty() {
                result.message = Some(format!(
                    "{} report(s) were refused. {}",
                    errors.len(),
                    errors[0]
                ));
            }
        }
        if serde_json::to_vec(&result).map_or(true, |bytes| bytes.len() > MAX_BYTES) {
            result.unavailable("Coverage presentation exceeds its 32 MiB limit.");
        }
        result
    }
}

#[cfg(test)]
#[path = "coverage/tests.rs"]
mod tests;
impl Counters {
    fn add(&mut self, other: &Self) -> Result<(), String> {
        let mut total = self.clone();
        for (left, right) in [
            (&mut total.instructions, &other.instructions),
            (&mut total.branches, &other.branches),
            (&mut total.lines, &other.lines),
        ] {
            left.missed = left
                .missed
                .checked_add(right.missed)
                .filter(|n| *n <= 1_000_000_000)
                .ok_or("Coverage totals exceed their bound.")?;
            left.covered = left
                .covered
                .checked_add(right.covered)
                .filter(|n| *n <= 1_000_000_000)
                .ok_or("Coverage totals exceed their bound.")?;
        }
        *self = total;
        Ok(())
    }
}
fn reset_maven_integration_data(project: &Path) -> Result<(), String> {
    let target = project.join("target");
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("Maven's target directory must be a regular project directory for integration coverage.".into());
            }
            let canonical = target
                .canonicalize()
                .map_err(|_| "Cannot resolve Maven's target directory for integration coverage.")?;
            if canonical != target || !canonical.starts_with(project) {
                return Err("Maven's target directory escaped the selected project.".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err("Cannot inspect Maven's target directory for integration coverage.".into())
        }
    }
    let data = target.join("jacoco-it.exec");
    match fs::symlink_metadata(&data) {
        Ok(metadata) if metadata.is_file() || metadata.file_type().is_symlink() => {
            fs::remove_file(data)
                .map_err(|_| "Cannot reset Maven's JaCoCo integration execution data.")?;
        }
        Ok(_) => {
            return Err(
                "Maven's JaCoCo integration execution data path is not a regular file.".into(),
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Cannot inspect Maven's JaCoCo integration execution data.".into()),
    }
    Ok(())
}
fn reports(
    root: &Path,
    maven: bool,
    integration_test_coverage: bool,
) -> Result<Vec<PathBuf>, String> {
    fn walk(
        root: &Path,
        dir: &Path,
        maven: bool,
        integration_test_coverage: bool,
        depth: usize,
        entries: &mut usize,
        found: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("Coverage report directories exceed their depth limit.".into());
        }
        if !dir.exists() {
            return Ok(());
        }
        if fs::symlink_metadata(dir)
            .map_err(|_| "Cannot inspect coverage directory.")?
            .file_type()
            .is_symlink()
        {
            return Ok(());
        }
        let canonical = dir
            .canonicalize()
            .map_err(|_| "Cannot resolve coverage directory.")?;
        if canonical != dir || !canonical.starts_with(root) {
            return Err("Coverage directory escaped its authorized root.".into());
        }
        for entry in fs::read_dir(dir).map_err(|_| "Cannot inspect coverage report directories.")? {
            *entries += 1;
            if *entries > 20_000 {
                return Err("Coverage report discovery exceeds its entry limit.".into());
            }
            let entry = entry.map_err(|_| "Cannot inspect a coverage report entry.")?;
            let path = entry.path();
            let kind = entry
                .file_type()
                .map_err(|_| "Cannot inspect coverage entry type.")?;
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if kind.is_file()
                && name == "jacoco.xml"
                && (!maven
                    || !integration_test_coverage
                    || dir.file_name().is_some_and(|part| part == "jacoco-it"))
            {
                if found.len() >= MAX_REPORTS {
                    return Err("Too many JaCoCo reports.".into());
                }
                found.push(path);
            } else if kind.is_dir() {
                if maven && name == "target" {
                    walk(
                        root,
                        &path.join("site"),
                        maven,
                        integration_test_coverage,
                        depth + 1,
                        entries,
                        found,
                    )?;
                } else if ![
                    ".git",
                    ".ide",
                    ".gradle",
                    ".m2",
                    "node_modules",
                    "build",
                    "classes",
                    "test-classes",
                ]
                .contains(&name.as_ref())
                {
                    walk(
                        root,
                        &path,
                        maven,
                        integration_test_coverage,
                        depth + 1,
                        entries,
                        found,
                    )?;
                }
            }
        }
        Ok(())
    }
    let mut found = Vec::new();
    walk(
        root,
        root,
        maven,
        integration_test_coverage,
        0,
        &mut 0,
        &mut found,
    )?;
    found.sort();
    Ok(found)
}
fn read_report(root: &Path, path: &Path) -> Result<Vec<u8>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Coverage report is unavailable.")?;
    if canonical != path || !canonical.starts_with(root) {
        return Err("Symlinked or escaped coverage reports are refused.".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|_| "Cannot read coverage report.")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect coverage report.")?;
    if !metadata.is_file() || metadata.len() > MAX_FILE as u64 {
        return Err(
            "Coverage report exceeds its 8 MiB file limit or is not a regular file.".into(),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("Hard-linked coverage reports are refused.".into());
        }
    }
    let mut bytes = Vec::new();
    (&file)
        .take((MAX_FILE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read coverage report bytes.")?;
    let current = file
        .metadata()
        .map_err(|_| "Cannot inspect completed coverage read.")?;
    let path_metadata =
        fs::metadata(path).map_err(|_| "Coverage report disappeared while reading.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.dev() != path_metadata.dev() || metadata.ino() != path_metadata.ino() {
            return Err("Coverage report was replaced while reading.".into());
        }
    }
    if metadata.len() != current.len()
        || metadata.modified().ok() != current.modified().ok()
        || current.len() != path_metadata.len()
        || current.modified().ok() != path_metadata.modified().ok()
    {
        return Err("Coverage report changed while reading.".into());
    }
    if bytes.len() > MAX_FILE || path.canonicalize().ok().as_ref() != Some(&canonical) {
        return Err("Coverage report changed while being read.".into());
    }
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GradleCoverageReportMetadata {
    module_root: Option<String>,
}

fn gradle_report_module_root(root: &Path, report: &Path) -> Option<String> {
    let metadata_path = report.parent()?.join("module.json");
    let bytes = read_report(root, &metadata_path).ok()?;
    let metadata: GradleCoverageReportMetadata = serde_json::from_slice(&bytes).ok()?;
    let module_root = metadata.module_root?;
    let safe_relative = module_root.len() <= 4096
        && !module_root.chars().any(char::is_control)
        && !module_root.contains(['\\', ':', '\0'])
        && !Path::new(&module_root).is_absolute()
        && (module_root.is_empty()
            || module_root
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."));
    safe_relative.then_some(module_root)
}
