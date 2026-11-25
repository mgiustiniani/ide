//! Test identities provided by compiled JUnit/TestNG runners or Gradle's public dry-run API.
use super::{
    executable_name,
    launch_settings::{java_test_arguments, LaunchFile},
    main_class, Invocation,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const LIMIT: usize = 10_000;
const BYTE_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiscoveredTest {
    pub id: String,
    pub kind: String,
    pub class_name: String,
    pub method_name: Option<String>,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_names: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name_count: Option<usize>,
    #[serde(skip)]
    pub testng: bool,
}
impl DiscoveredTest {
    pub fn selection(&self) -> String {
        self.method_name.as_ref().map_or_else(
            || self.class_name.clone(),
            |name| format!("{}#{name}", self.class_name),
        )
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TestDiscovery {
    pub status: String,
    pub project_path: String,
    pub build_tool: String,
    pub scope: String,
    pub tests: Vec<DiscoveredTest>,
    pub message: Option<String>,
}
impl TestDiscovery {
    pub fn collecting(project: &str, tool: &str) -> Self {
        Self {
            status: "collecting".into(),
            project_path: project.into(),
            build_tool: tool.into(),
            scope: if tool == "gradle" {
                "test-task"
            } else {
                "engines"
            }
            .into(),
            tests: vec![],
            message: None,
        }
    }
    pub fn unavailable(&mut self, message: &str) {
        self.status = "unavailable".into();
        self.tests.clear();
        self.message = Some(message.into());
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawDiscovery {
    version: u32,
    request_id: String,
    scope: String,
    tests: Vec<RawTest>,
    #[serde(default)]
    unsupported_entries: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawTest {
    class_name: String,
    method_name: Option<String>,
    label: String,
    #[serde(default)]
    testng: bool,
}

fn parse(bytes: &[u8], identity: &str, project: &str, tool: &str) -> Result<TestDiscovery, String> {
    if bytes.len() > BYTE_LIMIT {
        return Err("Test discovery exceeds the 2 MiB limit.".into());
    }
    let raw: RawDiscovery = serde_json::from_slice(bytes)
        .map_err(|_| "The test runner did not provide valid discovery data.")?;
    let mut result = TestDiscovery::collecting(project, tool);
    if raw.unsupported_entries > LIMIT
        || raw.version != 1
        || raw.request_id != identity
        || raw.scope != result.scope
        || raw.tests.len() > LIMIT
    {
        return Err("Test discovery is stale, unsupported or oversized.".into());
    }
    let mut entries = BTreeMap::new();
    let mut unsupported = raw.unsupported_entries;
    let mut class_only = false;
    for test in raw.tests {
        if test.label.len() > 4096
            || test.label.contains('\0')
            || test.class_name.len() > 512
            || test
                .method_name
                .as_ref()
                .is_some_and(|name| name.len() > 512 || name.contains('\0'))
        {
            return Err("Test discovery contains invalid or oversized names.".into());
        }
        if !main_class(&test.class_name) {
            unsupported += 1;
            continue;
        }
        if test.testng && !["maven", "jdk"].contains(&tool) {
            return Err(
                "The runner's test framework does not match the build-tool discovery scope.".into(),
            );
        }
        entries
            .entry((test.class_name.clone(), None, test.testng))
            .or_insert_with(|| {
                BTreeSet::from([if test.testng {
                    format!("{} (TestNG)", test.class_name)
                } else {
                    test.class_name.clone()
                }])
            });
        if let Some(method) = test.method_name {
            if main_class(&method) && !method.contains('.') {
                entries
                    .entry((test.class_name, Some(method), test.testng))
                    .or_insert_with(BTreeSet::new)
                    .insert(test.label);
            } else {
                class_only = true;
            }
        }
        if entries.len() > LIMIT {
            return Err("Too many selectable test classes or methods.".into());
        }
    }
    result.tests = entries
        .into_iter()
        .map(|((class_name, method_name, testng), labels)| {
            let count = labels.len();
            let grouped = method_name.is_some() && count > 1;
            let label = labels
                .first()
                .cloned()
                .unwrap_or_else(|| class_name.clone());
            let display_names = grouped.then(|| labels.into_iter().take(32).collect());
            let key = format!(
                "{class_name}#{}:{testng}",
                method_name.as_deref().unwrap_or_default()
            );
            DiscoveredTest {
                id: format!("test-{:x}", Sha256::digest(key.as_bytes())),
                kind: if method_name.is_some() {
                    "method"
                } else {
                    "class"
                }
                .into(),
                class_name,
                method_name,
                label,
                display_names,
                display_name_count: grouped.then_some(count),
                testng,
            }
        })
        .collect();
    result.status = if unsupported == 0 { "ready" } else { "partial" }.into();
    result.message = if unsupported > 0 {
        Some(format!("{unsupported} runner entries have names this release cannot select; discovery is incomplete."))
    } else if class_only {
        Some("Some runner entries support class selection only; individual parameterized cases are not selectable.".into())
    } else {
        None
    };
    Ok(result)
}

#[derive(Debug)]
pub(super) struct DiscoveryArtifact {
    pub source: LaunchFile,
    output: PathBuf,
    identity: String,
    gradle_task: Option<String>,
    project: String,
    tool: String,
}
impl DiscoveryArtifact {
    pub fn create(
        workspace: &Path,
        project: &Path,
        project_path: &str,
        tool: &str,
        options: &[String],
        source_set: Option<&str>,
        build_root: Option<&Path>,
    ) -> Result<Self, String> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Cannot identify test discovery.")?;
        let identity: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let source = LaunchFile::create(
            if tool != "gradle" {
                "IdeTestDiscovery.java"
            } else {
                "discovery.init.gradle"
            },
            b"",
        )?;
        let gradle_task = (tool == "gradle" && source_set.is_some())
            .then(|| format!("ideDiscoverJavaSourceSetTest{identity}"));
        let artifact = Self {
            output: source.path.with_file_name("discovery.json"),
            source,
            identity,
            gradle_task,
            project: project_path.into(),
            tool: tool.into(),
        };
        let mut open = fs::OpenOptions::new();
        open.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open.mode(0o600);
        }
        open.open(&artifact.output)
            .map_err(|_| "Cannot allocate private test discovery output.")?;
        let contents = if tool != "gradle" {
            include_str!("IdeTestDiscovery.java").to_owned()
        } else {
            let class_name = format!("IdeTestNgDiscoveryListener_{}", artifact.identity);
            let source = artifact
                .source
                .path
                .with_file_name(format!("{class_name}.java"));
            let methods = artifact.source.path.with_file_name("testng-methods.jsonl");
            let classes = artifact.source.path.with_file_name("testng-classes");
            let java = include_str!("TestNgDiscoveryListener.java")
                .replace("IDE_CLASS_NAME", &class_name)
                .replace("IDE_DISCOVERY_ID", &artifact.identity)
                .replace(
                    "IDE_OUTPUT_JSON",
                    &serde_json::to_string(&methods)
                        .map_err(|_| "Cannot encode discovery output path.")?,
                );
            write_private(&source, java.as_bytes())?;
            write_private(&methods, b"")?;
            let mut directory = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                directory.mode(0o700);
            }
            directory
                .create(&classes)
                .map_err(|_| "Cannot allocate private discovery classes.")?;
            let data = serde_json::to_vec(&serde_json::json!({"projectPath": project, "buildRoot":build_root, "output": artifact.output, "requestId": artifact.identity, "options":options, "testngSource":source, "testngMethods":methods, "testngClasses":classes, "testngClassName":class_name, "sourceSet":source_set, "task":artifact.gradle_task})).map_err(|_| "Cannot encode test discovery settings.")?;
            let encoded = base64::engine::general_purpose::STANDARD.encode(data);
            format!(
                r#"def ideDiscovery = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{encoded}'), 'UTF-8'))
gradle.projectsEvaluated {{
    if (ideDiscovery.buildRoot != null && gradle.rootProject.projectDir.canonicalPath != ideDiscovery.buildRoot) return
    def selected = gradle.rootProject.allprojects.find {{ it.projectDir.canonicalPath == ideDiscovery.projectPath }}
    if (selected == null && gradle.parent != null && ideDiscovery.buildRoot == null) return
    if (selected == null) throw new org.gradle.api.GradleException('The selected test project was not found.')
    def testTaskProvider
    def ideSourceSet = null
    if (ideDiscovery.sourceSet != null) {{
        def sets = selected.extensions.findByName('sourceSets')
        ideSourceSet = sets == null ? null : sets.findByName(ideDiscovery.sourceSet)
        if (ideSourceSet == null) throw new org.gradle.api.GradleException('The selected Java source set is unavailable')
        def expectedClasses = ideSourceSet.output.classesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
        if (expectedClasses.isEmpty()) throw new org.gradle.api.GradleException('The selected source set has no compiled test classes')
        def candidates = selected.tasks.withType(org.gradle.api.tasks.testing.Test).findAll {{ candidate ->
            def actualClasses = candidate.testClassesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
            actualClasses == expectedClasses
        }}
        if (candidates.size() > 1) {{
            def sourceRuntime = ideSourceSet.runtimeClasspath
            candidates = candidates.findAll {{ candidate -> candidate.classpath == sourceRuntime }}
        }}
        if (candidates.size() != 1) throw new org.gradle.api.GradleException('The selected source set must map to exactly one Gradle Test task with matching test classes')
        testTaskProvider = selected.tasks.named(candidates.first().name, org.gradle.api.tasks.testing.Test)
        testTaskProvider.configure {{
            dependsOn(selected.tasks.named(ideSourceSet.classesTaskName))
            outputs.upToDateWhen {{ false }}
            doFirst {{
                def expectedRuntime = ideSourceSet.runtimeClasspath.files.collect {{ it.canonicalFile.toPath() }} as Set
                def actualClasspath = classpath.files.collect {{ it.canonicalFile.toPath() }} as Set
                if (!expectedRuntime.every {{ actualClasspath.contains(it) }}) throw new org.gradle.api.GradleException('The selected Gradle Test task does not contain the source set runtime classpath')
            }}
        }}
        selected.tasks.register(ideDiscovery.task) {{ dependsOn(testTaskProvider) }}
    }} else {{
        testTaskProvider = selected.tasks.named('test', org.gradle.api.tasks.testing.Test)
    }}
    def testTask = testTaskProvider.get()
    def isTestNg = testTask.getOptions() instanceof org.gradle.api.tasks.testing.testng.TestNGOptions
    def compiled = null
    if (isTestNg) {{
        def testClasspath = testTask.classpath
        compiled = selected.tasks.register('ideTestDiscovery_' + ideDiscovery.requestId, org.gradle.api.tasks.compile.JavaCompile) {{
            source(ideDiscovery.testngSource)
            classpath = testClasspath
            destinationDirectory.set(new File(ideDiscovery.testngClasses))
            options.release.set(8)
            options.encoding = 'UTF-8'
            options.compilerArgs.add('-proc:none')
        }}
    }}
    testTaskProvider.configure {{
        def discovered = java.util.Collections.synchronizedList(new ArrayList())
        def unsupported = new java.util.concurrent.atomic.AtomicInteger()
        if (isTestNg) {{
            dependsOn(compiled)
            classpath += selected.files(ideDiscovery.testngClasses)
            getOptions().listeners.add(ideDiscovery.testngClassName)
        }}
        def sourceAccessor = org.gradle.api.tasks.testing.TestDescriptor.methods.find {{ it.name == 'getSource' && it.parameterCount == 0 }}
        def methodSource = sourceAccessor == null ? null : org.gradle.api.tasks.testing.TestDescriptor.classLoader.loadClass('org.gradle.api.tasks.testing.source.MethodSource')
        getDryRun().set(true)
        gradle.taskGraph.whenReady {{ getDryRun().finalizeValue() }}
        jvmArgs(ideDiscovery.options)
        afterTest {{ descriptor, result ->
            if (isTestNg) return
            def className = descriptor.className
            def methodName = descriptor.name
            def source = sourceAccessor == null ? null : sourceAccessor.invoke(descriptor)
            if (methodSource != null && methodSource.isInstance(source)) {{
                className = methodSource.getMethod('getClassName').invoke(source)
                methodName = methodSource.getMethod('getMethodName').invoke(source)
            }}
            if (className != null) {{
                synchronized(discovered) {{
                    if (discovered.size() >= 10000) throw new org.gradle.api.GradleException('Test discovery limit exceeded.')
                    discovered.add([className: className, methodName: methodName, label: descriptor.displayName])
                }}
            }} else {{ unsupported.incrementAndGet() }}
        }}
        doFirst {{
            if (!getDryRun().get()) throw new org.gradle.api.GradleException('The project disabled test discovery dry-run.')
        }}
        doLast {{
            if (isTestNg) {{
                def file = new File(ideDiscovery.testngMethods)
                if (file.length() > 2*1024*1024) throw new org.gradle.api.GradleException('TestNG discovery output limit exceeded.')
                file.eachLine('UTF-8') {{ line ->
                    def method = new groovy.json.JsonSlurper().parseText(line)
                    if (method.requestId != ideDiscovery.requestId || method.error != null) throw new org.gradle.api.GradleException('TestNG discovery metadata was unavailable or refused.')
                    if (discovered.size() >= 10000) throw new org.gradle.api.GradleException('Test discovery limit exceeded.')
                    discovered.add([className:method.className,methodName:method.methodName,label:method.label])
                }}
            }}
            def json = groovy.json.JsonOutput.toJson([version: 1, requestId: ideDiscovery.requestId, scope: 'test-task', unsupportedEntries: unsupported.get(), tests: discovered])
            if (json.getBytes('UTF-8').length > 2*1024*1024) throw new org.gradle.api.GradleException('Test discovery output exceeds 2 MiB.')
            new File(ideDiscovery.output).setText(json, 'UTF-8')
        }}
    }}
}}
"#
            )
        };
        fs::write(&artifact.source.path, contents)
            .map_err(|_| "Cannot write private discovery helper.")?;
        // Resolve the workspace now, before a build can change path bindings.
        workspace
            .canonicalize()
            .map_err(|_| "The discovery workspace is unavailable.")?;
        Ok(artifact)
    }
    pub fn gradle_task(&self) -> Option<&str> {
        self.gradle_task.as_deref()
    }
    pub fn arguments(&self, workspace: &Path) -> Result<Vec<String>, String> {
        [&self.output, workspace]
            .into_iter()
            .map(|path| {
                path.to_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "Test discovery paths must be UTF-8.".to_owned())
            })
            .chain(std::iter::once(Ok(self.identity.clone())))
            .collect()
    }

    pub(super) fn direct_invocations(
        self: std::sync::Arc<Self>,
        directory: &Path,
        home: &Path,
        classpath: &[PathBuf],
        options: &[String],
        arguments: &[String],
    ) -> Result<Vec<Invocation>, String> {
        let (compile, classes) = self.compile_invocation(directory, home)?;
        let classpath = std::env::join_paths(std::iter::once(&classes).chain(classpath.iter()))
            .map_err(|_| "The test discovery classpath cannot be represented.")?
            .into_string()
            .map_err(|_| "The test discovery classpath must be UTF-8.")?;
        let (arguments, launch_file) =
            java_test_arguments(home, options, "IdeTestDiscovery", arguments, &classpath)?;
        let discover = Invocation {
            directory: directory.to_path_buf(),
            executable: home.join("bin").join(executable_name("java")),
            arguments,
            interactive: false,
            java_home: home.to_path_buf(),
            launch_file,
            discovery: Some(self),
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: None,
        };
        Ok(vec![compile, discover])
    }

    pub(super) fn compile_invocation(&self, directory: &Path, home: &Path) -> Result<(Invocation, PathBuf), String> {
        let classes = self.source.path.with_file_name("discovery-classes");
        fs::create_dir(&classes).map_err(|_| "Cannot allocate private discovery classes.")?;
        let classes_argument = classes.to_str().ok_or("Discovery class paths must be UTF-8.")?;
        let source = self.source.path.to_str().ok_or("Test discovery paths must be UTF-8.")?;
        let compile = Invocation {
            directory: directory.to_path_buf(),
            executable: home.join("bin").join(executable_name("javac")),
            arguments: [
                "-encoding", "UTF-8", "-proc:none", "-classpath", classes_argument,
                "-sourcepath", classes_argument, "-d", classes_argument, source,
            ].into_iter().map(str::to_owned).collect(),
            interactive: false,
            java_home: home.to_path_buf(),
            launch_file: None,
            discovery: None,
            coverage: None,
            auxiliary_files: vec![],
            profile_path: None,
            test_report_path: None,
        };
        Ok((compile, classes))
    }
    pub fn finish(&self, exit_code: i32) -> TestDiscovery {
        let mut result = TestDiscovery::collecting(&self.project, &self.tool);
        if exit_code != 0 {
            result
                .unavailable("The build or test runner failed during discovery. See the console.");
            return result;
        }
        match self.read() {
            Ok(discovery) => discovery,
            Err(error) => {
                result.unavailable(&error);
                result
            }
        }
    }
    fn read(&self) -> Result<TestDiscovery, String> {
        let metadata = fs::symlink_metadata(&self.output)
            .map_err(|_| "The test runner did not write discovery output.")?;
        if !metadata.is_file() || metadata.len() > BYTE_LIMIT as u64 {
            return Err("Test discovery output is not a bounded regular file.".into());
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            options.custom_flags(libc::O_NOFOLLOW);
            if metadata.nlink() != 1 {
                return Err("Linked test discovery output is refused.".into());
            }
        }
        let file = options
            .open(&self.output)
            .map_err(|_| "Cannot read test discovery output.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let opened = file
                .metadata()
                .map_err(|_| "Cannot inspect discovery output.")?;
            if opened.dev() != metadata.dev()
                || opened.ino() != metadata.ino()
                || opened.nlink() != 1
            {
                return Err("Test discovery output changed while reading.".into());
            }
        }
        let mut bytes = Vec::new();
        file.take(BYTE_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read test discovery output.")?;
        parse(&bytes, &self.identity, &self.project, &self.tool)
    }
}
impl Drop for DiscoveryArtifact {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.output);
        let _ = fs::remove_dir_all(self.output.with_file_name("junit-engine-output"));
        let _ = fs::remove_dir_all(self.output.with_file_name("discovery-classes"));
        if self.tool == "gradle" {
            let class_name = format!("IdeTestNgDiscoveryListener_{}", self.identity);
            let _ = fs::remove_file(
                self.source
                    .path
                    .with_file_name(format!("{class_name}.java")),
            );
            let _ = fs::remove_file(self.source.path.with_file_name("testng-methods.jsonl"));
            let classes = self.source.path.with_file_name("testng-classes");
            let _ = fs::remove_file(classes.join(format!("{class_name}.class")));
            let _ = fs::remove_dir(classes);
        }
    }
}
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut open = fs::OpenOptions::new();
    open.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open.mode(0o600);
    }
    open.open(path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|_| "Cannot allocate private TestNG discovery metadata.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_correlated_runner_identities_and_class_fallback() {
        let raw = serde_json::json!({"version":1,"requestId":"one","scope":"test-task","tests":[{"className":"p.ExampleTest","methodName":"works","label":"works 😀"},{"className":"p.ExampleTest","methodName":"works","label":"duplicate"},{"className":"p.ExampleTest","methodName":"parameterized[0]","label":"parameterized[0]"}]});
        let bytes = serde_json::to_vec(&raw).unwrap();
        let result = parse(&bytes, "one", "module", "gradle").unwrap();
        assert_eq!(result.status, "ready");
        assert_eq!(result.tests.len(), 2);
        assert!(result.message.unwrap().contains("class selection only"));
        assert_eq!(result.tests[0].selection(), "p.ExampleTest");
        assert_eq!(result.tests[1].selection(), "p.ExampleTest#works");
        assert_eq!(result.tests[1].display_name_count, Some(2));
        assert_eq!(
            result.tests[1].display_names.as_ref().unwrap(),
            &vec!["duplicate", "works 😀"]
        );
        assert!(parse(&bytes, "two", "module", "gradle").is_err());
        assert!(parse(&bytes, "one", "module", "maven").is_err());
        assert!(parse(&vec![b' '; BYTE_LIMIT + 1], "one", "", "gradle").is_err());
        let partial = serde_json::json!({"version":1,"requestId":"one","scope":"test-task","unsupportedEntries":1,"tests":[]});
        assert_eq!(
            parse(&serde_json::to_vec(&partial).unwrap(), "one", "", "gradle")
                .unwrap()
                .status,
            "partial"
        );
    }
    #[test]
    fn method_groups_keep_bounded_distinct_labels_and_stable_selection_identity() {
        let tests = (0..40)
            .map(|index| {
                serde_json::json!({
                    "className":"p.ExampleTest", "methodName":"same",
                    "label":format!("same({index:02})")
                })
            })
            .collect::<Vec<_>>();
        let raw =
            serde_json::json!({"version":1,"requestId":"group","scope":"engines","tests":tests});
        let result = parse(&serde_json::to_vec(&raw).unwrap(), "group", "", "maven").unwrap();
        let group = result
            .tests
            .iter()
            .find(|test| test.method_name.is_some())
            .unwrap();
        assert_eq!(group.display_name_count, Some(40));
        assert_eq!(group.display_names.as_ref().unwrap().len(), 32);
        assert_eq!(group.selection(), "p.ExampleTest#same");
        let mut reversed = raw.clone();
        reversed["tests"].as_array_mut().unwrap().reverse();
        let second = parse(
            &serde_json::to_vec(&reversed).unwrap(),
            "group",
            "",
            "maven",
        )
        .unwrap();
        let other = second
            .tests
            .iter()
            .find(|test| test.method_name.is_some())
            .unwrap();
        assert_eq!(group.id, other.id);
        assert_eq!(group.label, other.label);
        assert_eq!(group.display_names, other.display_names);
    }
    #[test]
    fn plain_jdk_discovery_accepts_correlated_junit_and_testng_entries() {
        let raw = serde_json::json!({
            "version": 1,
            "requestId": "jdk-run",
            "scope": "engines",
            "tests": [{
                "className": "p.ExampleTest",
                "methodName": "works",
                "label": "works()",
                "testng": false
            }]
        });
        let result = parse(&serde_json::to_vec(&raw).unwrap(), "jdk-run", "", "jdk").unwrap();
        assert_eq!(result.status, "ready");
        assert_eq!(result.build_tool, "jdk");
        assert_eq!(result.scope, "engines");
        assert_eq!(result.tests[1].selection(), "p.ExampleTest#works");

        let mut testng = raw;
        testng["tests"][0]["testng"] = serde_json::json!(true);
        let result = parse(&serde_json::to_vec(&testng).unwrap(), "jdk-run", "", "jdk").unwrap();
        assert_eq!(result.status, "ready");
        assert_eq!(result.tests.len(), 2);
        assert!(result.tests.iter().all(|test| test.testng));
        assert!(result
            .tests
            .iter()
            .any(|test| test.label.contains("TestNG")));
    }
    #[test]
    fn missing_output_is_unavailable_and_owned_files_are_removed() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let artifact = DiscoveryArtifact::create(&root, &root, "", "gradle", &[], None, None).unwrap();
        let directory = artifact.source.path.parent().unwrap().to_owned();
        let reporting = artifact.output.with_file_name("junit-engine-output");
        fs::create_dir_all(reporting.join("engine/test")).unwrap();
        fs::write(
            reporting.join("engine/test/report.txt"),
            "private engine output",
        )
        .unwrap();
        assert_eq!(artifact.finish(0).status, "unavailable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&artifact.output).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(artifact);
        assert!(!directory.exists());
    }
    #[test]
    #[cfg(unix)]
    fn discovery_cleanup_does_not_follow_redirected_directories() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let artifact = DiscoveryArtifact::create(&root, &root, "", "jdk", &[], None, None).unwrap();
        let directory = artifact.source.path.parent().unwrap().to_owned();
        let target = directory.with_extension("unrelated");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("preserve.txt"), "preserve").unwrap();
        for name in ["junit-engine-output", "discovery-classes"] {
            std::os::unix::fs::symlink(&target, artifact.output.with_file_name(name)).unwrap();
        }
        drop(artifact);
        assert!(!directory.exists());
        assert_eq!(
            fs::read_to_string(target.join("preserve.txt")).unwrap(),
            "preserve"
        );
        fs::remove_dir_all(target).unwrap();
    }
    #[test]
    fn custom_gradle_discovery_uses_a_private_mapped_test_task() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        let artifact =
            DiscoveryArtifact::create(&root, &root, "", "gradle", &[], Some("integrationTest"), None)
                .unwrap();
        assert!(artifact
            .gradle_task()
            .is_some_and(|task| task.starts_with("ideDiscoverJavaSourceSetTest")));
        let script = fs::read_to_string(&artifact.source.path).unwrap();
        for required in [
            "ideSourceSet.output.classesDirs",
            "testClassesDirs",
            "runtimeClasspath",
            "getDryRun().set(true)",
            "outputs.upToDateWhen",
        ] {
            assert!(script.contains(required), "{required}");
        }
    }
    #[test]
    #[cfg(unix)]
    fn linked_discovery_output_is_refused_without_reading_or_deleting_its_target() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().canonicalize().unwrap();
        let artifact = DiscoveryArtifact::create(&root, &root, "", "maven", &[], None, None).unwrap();
        let target = artifact.source.path.with_file_name("unrelated.txt");
        fs::write(&target, "preserve").unwrap();
        fs::remove_file(&artifact.output).unwrap();
        symlink(&target, &artifact.output).unwrap();
        assert_eq!(artifact.finish(0).status, "unavailable");
        let directory = target.parent().unwrap().to_owned();
        drop(artifact);
        assert_eq!(fs::read_to_string(&target).unwrap(), "preserve");
        fs::remove_file(target).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
