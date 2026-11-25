//! Execution consumes provider-owned source sets; build tools still own compilation and test tasks.
use super::*;
use crate::commands::refactorkit_daemon::{MavenTestJvmSelection, ResolvedProject};
use serde_json::Value;

fn select_gradle_runtime_home(
    steps: &mut [Invocation],
    project: &ResolvedProject,
) -> Result<(), String> {
    if project.build_tool != "gradle" {
        return Ok(());
    }
    let runtime_home = project
        .gradle_runtime_home
        .as_ref()
        .unwrap_or(&project.sdk_home);
    let project_sdk = gradle_project_sdk_argument(runtime_home, &project.sdk_home)?;
    for step in steps {
        step.java_home = runtime_home.clone();
        if let Some(project_sdk) = &project_sdk {
            step.arguments.insert(0, project_sdk.clone());
        }
    }
    Ok(())
}

pub(super) fn gradle_project_sdk_argument(
    runtime_home: &Path,
    project_sdk: &Path,
) -> Result<Option<String>, String> {
    // A separately selected Gradle runtime does not make the project JDK visible to toolchains.
    if runtime_home != project_sdk {
        let path = project_sdk
            .to_str()
            .ok_or("The selected project JDK path cannot be represented for Gradle.")?;
        if path.contains(',') {
            return Err("The selected project JDK path cannot be represented for Gradle.".into());
        }
        Ok(Some(format!("-Dorg.gradle.java.installations.paths={path}")))
    } else {
        Ok(None)
    }
}

pub(super) fn plan(
    job: &Arc<Job>,
    provider: &JavaExecutionProjectContext,
    selection: &JavaExecutionProjectSelection,
    selections: &[String],
    rerun: bool,
) -> Result<Vec<Invocation>, String> {
    if job.cancelled.load(Ordering::SeqCst) {
        return Err("Java project launch was stopped.".into());
    }
    let runtime = ["run", "debug"].contains(&job.request.operation.as_str());
    let initial_application_directory = if runtime {
        let module = execution_root(&job.binding.canonical_root, &job.request.configuration.project_path)?;
        Some(application_directory(&job.binding.canonical_root, &module, &job.request.configuration)?)
    } else { None };
    let launch_as_module = runtime && job.request.configuration.launch_as_module;
    let operation = super::debug_test::test_operation(&job.request.operation);
    let qualify_test_jvm = !job.request.configuration.test_jvm_options.is_empty()
        && matches!(operation, "test" | "coverage" | "integration-test" | "integration-coverage");
    let initial = provider.resolve_for_launch(
        &job.binding, job.request.generation, selection, rerun, launch_as_module, qualify_test_jvm,
    )?;
    // Project-mode launch stores the selected module directory in the request configuration,
    // while the provider context retains the enclosing build root. Compare like with like.
    let selected_module_root = execution_root(
        &job.binding.canonical_root,
        &job.request.configuration.project_path,
    )?;
    if selected_module_root
        != initial
            .module_root
            .canonicalize()
            .map_err(|_| "The selected Java module directory is unavailable before execution.")?
    {
        return Err("The selected Java module changed before execution.".into());
    }
    if selected_jdk(&job.request.configuration.jdk_home)? != initial.sdk_home {
        return Err("The selected JDK changed before execution.".into());
    }
    if job.request.configuration.build_tool != initial.build_tool {
        return Err("The selected build tool changed before execution.".into());
    }
    let rebuild = job.request.operation == "rebuild";
    if rebuild && !["maven", "gradle"].contains(&initial.build_tool.as_str()) {
        return Err("Rebuild requires a Maven or Gradle project.".into());
    }
    let effective_operation = if rebuild { "build" } else { operation };
    let source_set_support = source_set_execution_support(
        &initial.build_tool,
        &initial.source_set_kind,
        &selection.source_set_id,
        effective_operation,
        initial.maven_failsafe.as_ref(),
    )?;
    let maven_forks = if qualify_test_jvm {
        let forks = maven_test_fork_launchers(&initial, operation)?;
        validate_maven_test_jvm_options(
            &initial.project_context_schema_version,
            &initial.build_tool,
            initial.maven_test_jvm_modules.as_deref(),
            &selection.module_id,
            &selection.source_set_id,
            operation,
            !forks.is_empty(),
        )?;
        forks
    } else {
        Vec::new()
    };
    let mut request = job.request.clone();
    request.operation = effective_operation.into();
    if super::debug_test::is_debug(&job.request.operation) {
        *job.debugger_source_roots.lock().map_err(|_| "Debugger source-root state is unavailable.")? = Some(initial.debugger_source_roots.clone());
    }
    let custom_gradle_test = source_set_support.custom_gradle && request.operation == "test";
    let custom_gradle_discovery =
        source_set_support.custom_gradle && request.operation == "discover";
    let custom_gradle_coverage =
        source_set_support.custom_gradle && request.operation == "coverage";
    let wants_profile = request.profile;
    if wants_profile && !source_set_support.standard_main {
        return Err("Java Flight Recorder profiling requires the selected main source set.".into());
    }
    if launch_as_module && !source_set_support.standard_main {
        return Err(
            "Named-module launch is supported only for the synchronized main source set.".into(),
        );
    }
    let maven_discovery = request.operation == "discover" && initial.build_tool == "maven";
    if runtime && !main_class(&request.configuration.main_class) {
        return Err("Enter a fully qualified Java main class.".into());
    }
    if runtime || maven_discovery {
        request.operation = "build".into();
        request.profile = false;
    }
    let mut invocation_request = request.clone();
    if custom_gradle_test {
        // The mapped Test task receives these options through its private source-set script.
        invocation_request.configuration.test_jvm_options.clear();
    }
    let settings = serde_json::to_value(selection)
        .map_err(|_| "Invalid project launch settings.")?["context"].clone();
    let gradle = if initial.build_tool == "gradle" {
        Some(selected_gradle(initial.gradle_invocation_root(),
            &job.binding.canonical_root, settings["gradle"]["executable"].as_str())?)
    } else { None };
    let mut steps = invocation_selected_with_settings(
        &job.binding.canonical_root,
        &invocation_request,
        selections,
        rerun,
        (custom_gradle_discovery || custom_gradle_coverage)
            .then_some(selection.source_set_id.as_str()),
        Some(initial.module_root.as_path()),
        InvocationSettings {
            maven_fork_launcher: !maven_forks.is_empty(),
            build_tool_executable: gradle.as_deref(),
            gradle_target_build_root: initial.gradle_build_root.as_deref(),
            declared_jdk: initial.declared_jdk.as_ref(),
            declared_jdk_runtime_classpath: initial.declared_jdk.as_ref().map(|_| initial.runtime_classpath.as_slice()),
            ..InvocationSettings::default()
        },
    )?;
    select_gradle_runtime_home(&mut steps, &initial)?;
    if custom_gradle_discovery || custom_gradle_coverage {
        for step in &mut steps {
            let task = if custom_gradle_discovery {
                step.discovery
                    .as_ref()
                    .and_then(|artifact| artifact.gradle_task())
                    .ok_or("Gradle custom test discovery did not create a mapped task.")?
            } else {
                step.coverage
                    .as_ref()
                    .and_then(|artifact| artifact.gradle_task())
                    .ok_or("Gradle custom coverage did not create a mapped task.")?
            };
            let task_index = step
                .arguments
                .iter()
                .position(|argument| argument == "test")
                .ok_or("Missing Gradle test task selector.")?;
            step.arguments[task_index] = task.into();
            if custom_gradle_coverage {
                let mut filtered = Vec::with_capacity(step.arguments.len());
                let mut index = 0;
                while index < step.arguments.len() {
                    if step.arguments[index] == "--tests" {
                        if index + 1 >= step.arguments.len() {
                            return Err("Gradle coverage selector is incomplete.".into());
                        }
                        index += 2;
                    } else {
                        filtered.push(step.arguments[index].clone());
                        index += 1;
                    }
                }
                step.arguments = filtered;
            }
        }
    }
    // Select the test compilation task before configure_build qualifies Gradle task paths.
    if (runtime || maven_discovery || request.operation == "build")
        && source_set_support.standard_test
    {
        for step in &mut steps {
            for argument in &mut step.arguments {
                if initial.build_tool == "maven" && argument == "compile" {
                    *argument = "test-compile".into();
                }
                if initial.build_tool == "gradle" && argument == "classes" {
                    *argument = "testClasses".into();
                }
            }
        }
    }
    if custom_gradle_test {
        let test_selectors = if selections.is_empty() {
            if request.configuration.test_filter.is_empty() {
                Vec::new()
            } else {
                vec![request.configuration.test_filter.clone()]
            }
        } else {
            selections.to_vec()
        };
        prepare_gradle_test_task(
            &mut steps,
            &initial.module_root,
            &selection.source_set_id,
            &job.request.configuration.test_jvm_options,
            &test_selectors,
            initial.gradle_build_root.as_deref(),
        )?;
    }
    configure_build(
        &mut steps,
        &initial,
        &settings,
        !selections.is_empty() || !request.configuration.test_filter.is_empty(),
        &job.binding.canonical_root,
    )?;
    let reactor_tests = (initial.build_tool == "maven"
        && initial.root != initial.module_root
        && (super::debug_test::is_debug(&job.request.operation)
            || (cfg!(unix) && matches!(operation, "test" | "coverage" | "integration-test" | "integration-coverage"))))
        .then_some(maven_test_forks::ReactorTestSelection {
            root: &initial.root, module: &initial.module_root, operation,
        });
    if !maven_forks.is_empty() || reactor_tests.is_some() {
        let [step] = steps.as_mut_slice() else {
            return Err("Maven test launcher requires one reactor invocation.".into());
        };
        maven_test_forks::configure(
            step, &maven_forks, &request.configuration.test_jvm_options, reactor_tests,
        )?;
    }
    if let Some(failsafe) = initial.maven_failsafe.as_ref() {
        map_maven_failsafe_report_directory(&mut steps, failsafe)?;
    }
    let custom_gradle_build = source_set_support.custom_gradle && request.operation == "build";
    if initial.build_tool == "gradle" && (runtime || custom_gradle_build) {
        prepare_gradle_source_set(
            &mut steps,
            &initial.module_root,
            &selection.source_set_id,
            runtime,
            initial.gradle_task_project_path(),
            initial.gradle_build_root.as_deref(),
        )?;
    }
    if !runtime && !maven_discovery {
        if rebuild { prepend_clean_to_build(&mut steps, &initial.build_tool, initial.gradle_task_project_path())?; }
        return Ok(steps);
    }
    for step in steps {
        if job.cancelled.load(Ordering::SeqCst) {
            return Err("Java project launch was stopped.".into());
        }
        let code = execute(job, step)?;
        if code != 0 {
            if let Ok(mut snapshot) = job.snapshot.lock() {
                snapshot.exit_code = Some(code);
            }
            return Err("Project compilation failed; the application was not launched.".into());
        }
    }
    if job.cancelled.load(Ordering::SeqCst) {
        return Err("Java project launch was stopped.".into());
    }
    let resolved = provider.resolve(
        &job.binding,
        job.request.generation,
        selection,
        true,
        launch_as_module,
    )?;
    if resolved.root != initial.root
        || resolved.module_root != initial.module_root
        || resolved.gradle_build_root != initial.gradle_build_root
        || resolved.gradle_project_path != initial.gradle_project_path
        || resolved.gradle_build_tree_project_path != initial.gradle_build_tree_project_path
        || resolved.sdk_home != initial.sdk_home
        || resolved.gradle_runtime_home != initial.gradle_runtime_home
        || resolved.build_tool != initial.build_tool
        || resolved.declared_jdk != initial.declared_jdk
        || resolved.source_set_kind != initial.source_set_kind
        || resolved.module_name != initial.module_name
        || resolved.module_descriptor_hash != initial.module_descriptor_hash
        || resolved.module_path_identity != initial.module_path_identity
    {
        return Err("The selected project or source set changed during compilation.".into());
    }
    if maven_discovery {
        return maven_discovery_invocations(job, &resolved);
    }
    if job.request.operation == "debug" {
        *job.debugger_source_roots
            .lock()
            .map_err(|_| "Debugger source-root state is unavailable.")? =
            Some(resolved.debugger_source_roots);
        *job.debugger_class_output_roots
            .lock()
            .map_err(|_| "Debugger class-output state is unavailable.")? = Some(
            class_output_roots(&job.binding.canonical_root, &resolved.runtime_classpath),
        );
    }
    let mut paths = if launch_as_module {
        resolved.module_path
    } else {
        resolved.runtime_classpath
    };
    for extra in &job.request.configuration.class_path {
        let path = resolve_existing_path_in_root(&job.binding.canonical_root, extra)?;
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    let launch_path = std::env::join_paths(paths)
        .map_err(|_| "The runtime classpath cannot be represented on this platform.")?
        .to_string_lossy()
        .into_owned();
    let module_launch = if launch_as_module {
        Some((
            launch_path.clone(),
            resolved
                .module_name
                .ok_or("The synchronized project has no attested JPMS module name.")?,
        ))
    } else {
        None
    };
    let application_directory = application_directory(&job.binding.canonical_root, &resolved.module_root, &job.request.configuration)?;
    if initial_application_directory.as_ref() != Some(&application_directory) {
        return Err("The application working directory changed during compilation.".into());
    }
    let profile = if wants_profile {
        if !flight_recording::available(&resolved.sdk_home) {
            return Err(
                "Run with JFR requires JDK 11 or later with Flight Recorder support.".into(),
            );
        }
        Some(flight_recording::FlightRecording::create(
            &job.binding.canonical_root,
            &resolved.module_root,
            &job.request.configuration.project_path,
            &application_directory,
        )?)
    } else {
        None
    };
    let mut launch = job.request.clone();
    if let Some(input) = &job.application_input { launch.configuration.jvm_options.push(input.option().into()); }
    if let Some(recording) = &profile {
        if launch
            .configuration
            .jvm_options
            .iter()
            .any(|option| option.starts_with("-XX:StartFlightRecording"))
        {
            return Err(
                "Remove the custom StartFlightRecording option before using Run with JFR.".into(),
            );
        }
        launch
            .configuration
            .jvm_options
            .push(recording.jvm_option.clone());
    }
    let module_launch = module_launch
        .as_ref()
        .map(|(path, name)| (path.as_str(), name.as_str()));
    let classpath = module_launch.map_or(launch_path.as_str(), |_| "");
    let mut invocations = runtime_invocations(
        application_directory,
        resolved.sdk_home,
        classpath,
        module_launch,
        &launch,
    )?;
    invocations.last_mut().ok_or("The Java application launch is unavailable.")?
        .profile_path = profile.map(|recording| recording.workspace_path);
    Ok(invocations)
}

/// Capture only materialized workspace directories present on this source set's runtime classpath.
/// JARs and external directories cannot serve as user-selected workspace `.class` files.
pub(super) fn class_output_roots(
    workspace_root: &Path,
    runtime_classpath: &[PathBuf],
) -> Vec<PathBuf> {
    let mut roots = runtime_classpath
        .iter()
        .filter_map(|path| {
            let canonical = path.canonicalize().ok()?;
            (canonical.is_dir()
                && canonical != workspace_root
                && canonical.starts_with(workspace_root))
            .then_some(canonical)
        })
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    roots
}

#[cfg(test)]
mod class_output_roots_tests {
    use super::class_output_roots;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn captures_only_materialized_workspace_directories() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temporary = std::env::temp_dir().join(format!(
            "ide-class-output-roots-{}-{nonce}",
            std::process::id()
        ));
        let workspace = temporary.join("workspace");
        let output = workspace.join("module/build/classes/java/main");
        let external = temporary.join("external/classes");
        fs::create_dir_all(&output).unwrap();
        fs::create_dir_all(&external).unwrap();
        let workspace = workspace.canonicalize().unwrap();
        let expected = output.canonicalize().unwrap();
        let roots = class_output_roots(
            &workspace,
            &[
                external,
                output,
                workspace.clone(),
                workspace.join("not-yet-created/classes"),
            ],
        );
        assert_eq!(roots, [PathBuf::from(expected)]);
        fs::remove_dir_all(temporary).unwrap();
    }
}

#[cfg(test)]
mod named_module_runtime_tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::sync::mpsc;
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};

    #[test]
    #[ignore = "requires an installed full JDK"]
    fn runtime_invocation_runs_a_real_named_module() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let temporary = std::env::temp_dir().join(format!(
            "ide-project-jpms-runtime-{}-{}",
            std::process::id(),
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let source = temporary.join("src/example.app");
        let output = temporary.join("out");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&output).unwrap();
        fs::write(
            source.join("module-info.java"),
            "module example.app { exports example.app; }\n",
        )
        .unwrap();
        fs::write(
            source.join("Main.java"),
            "package example.app; public class Main { public static void main(String[] args) { System.out.println(\"JPMS_RUNTIME_OK:\" + String.join(\"|\", args)); } }\n",
        )
        .unwrap();

        let java = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|directory| directory.join(executable_name("java")))
            .find(|candidate| candidate.is_file())
            .expect("the ignored fixture requires java on PATH")
            .canonicalize()
            .unwrap();
        let home = java.parent().and_then(Path::parent).unwrap().to_path_buf();
        let javac = home.join("bin").join(executable_name("javac"));
        let compile = Command::new(javac)
            .arg("-d")
            .arg(&output)
            .arg(source.join("module-info.java"))
            .arg(source.join("Main.java"))
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "javac failed: {}",
            String::from_utf8_lossy(&compile.stderr)
        );

        let module_path = output.to_str().unwrap();
        let request: Request = serde_json::from_value(serde_json::json!({
            "workspaceId":"jpms-test", "generation":1, "operation":"run", "trusted":true,
            "configuration":{
                "buildTool":"maven", "mainClass":"example.app.Main", "classPath":[],
                "launchAsModule":true, "projectPath":"app", "programArguments":["two words", ""],
                "jvmOptions":[], "testJvmOptions":[], "environment":[], "jdkHome":"",
                "debuggerMode":"jdb"
            }
        }))
        .unwrap();
        let invocation = runtime_invocation(
            temporary.clone(),
            home,
            "",
            Some((module_path, "example.app")),
            &request,
        )
        .unwrap();
        let run = Command::new(&invocation.executable)
            .args(&invocation.arguments)
            .output()
            .unwrap();
        assert!(
            run.status.success(),
            "java failed: {}",
            String::from_utf8_lossy(&run.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&run.stdout).trim(),
            "JPMS_RUNTIME_OK:two words|"
        );
        drop(invocation);
        fs::remove_dir_all(temporary).unwrap();
    }

    #[test]
    #[ignore = "requires a full JDK with JDI, debugger transport and process ownership"]
    fn jdi_runtime_invocation_debugs_a_real_named_module() {
        use super::super::structured_debugger::{self, Action, Status};

        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let temporary = std::env::temp_dir().join(format!(
            "ide-project-jpms-jdi-{}-{}",
            std::process::id(),
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let source = temporary.join("src/example.app");
        let output = temporary.join("out");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&output).unwrap();
        fs::write(
            source.join("module-info.java"),
            "module example.app { exports example.app; }\n",
        )
        .unwrap();
        fs::write(
            source.join("Main.java"),
            "package example.app; public class Main { public static void main(String[] args) { System.out.println(\"JPMS_JDI_OK:\" + String.join(\"|\", args)); } }\n",
        )
        .unwrap();

        let java = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|directory| directory.join(executable_name("java")))
            .find(|candidate| candidate.is_file())
            .expect("the ignored fixture requires java on PATH")
            .canonicalize()
            .unwrap();
        let home = java.parent().and_then(Path::parent).unwrap().to_path_buf();
        assert!(
            structured_debugger::available(&home),
            "the ignored fixture requires a full JDK with JDI"
        );
        let compile = Command::new(home.join("bin").join(executable_name("javac")))
            .arg("-d")
            .arg(&output)
            .arg(source.join("module-info.java"))
            .arg(source.join("Main.java"))
            .output()
            .unwrap();
        assert!(
            compile.status.success(),
            "javac failed: {}",
            String::from_utf8_lossy(&compile.stderr)
        );

        let registry = temporary.join("registry.json");
        super::super::super::workspace_registry::ensure_workspace_at(&temporary, &registry)
            .unwrap();
        let binding = super::super::super::workspace_registry::current_workspace_binding_at(
            &temporary, &registry,
        )
        .unwrap();
        let request: Request = serde_json::from_value(serde_json::json!({
            "workspaceId": binding.workspace_id,
            "generation": 1,
            "operation": "debug",
            "trusted": true,
            "configuration": {
                "buildTool": "maven",
                "mainClass": "example.app.Main",
                "classPath": [],
                "launchAsModule": true,
                "projectPath": "app",
                "programArguments": ["two words", ""],
                "jvmOptions": [],
                "debuggerMode": "jdi"
            }
        }))
        .unwrap();
        let invocation = runtime_invocation(
            temporary.clone(),
            home,
            "",
            Some((output.to_str().unwrap(), "example.app")),
            &request,
        )
        .unwrap();
        let workspace_id = request.workspace_id.clone();
        let generation = request.generation;
        let job = Arc::new(Job {
            binding,
            request,
            test_selections: Vec::new(),
            maven_test_projects: None,
            project_context: None,
            snapshot: Mutex::new(Snapshot {
                workspace_id,
                generation,
                session_id: "jpms-jdi-test".into(),
                operation: "debug".into(),
                state: "starting".into(),
                output: String::new(),
                output_truncated: false,
                exit_code: None,
                profile_path: None,
                test_results: None,
                coverage: None,
                test_jvm_options_error: None,
                test_discovery: None,
                debugger_state: None,
                class_reload: None,
                application_input: None,
                can_debug_failed_tests: false,
                compiler_diagnostics: compiler_diagnostics::Report::default(),
            }),
            child: Mutex::new(None),
            test_tool_child: Mutex::new(None),
            test_listener_port: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            sources: Mutex::new(None),
            debugger_source_roots: Mutex::new(None),
            debugger_class_output_roots: Mutex::new(None),
            class_reload: Mutex::new(None),
            application_input: None,
        });
        struct StopOnDrop(Arc<Job>);
        impl Drop for StopOnDrop {
            fn drop(&mut self) {
                self.0.stop();
            }
        }
        let _stop_on_drop = StopOnDrop(job.clone());
        let (finished_tx, finished_rx) = mpsc::channel();
        let worker_job = job.clone();
        let worker: JoinHandle<()> = std::thread::spawn(move || {
            let _ = finished_tx.send(execute(&worker_job, invocation));
        });

        let wait_for = |predicate: &dyn Fn(&Snapshot) -> bool| {
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let snapshot = job.read().unwrap();
                assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
                if predicate(&snapshot) {
                    return snapshot;
                }
                assert!(
                    !worker.is_finished(),
                    "the JDI process exited before the expected state: state={}, debugger={:?}, output={}",
                    snapshot.state,
                    snapshot.debugger_state,
                    snapshot.output
                );
                assert!(
                    Instant::now() < deadline,
                    "the JDI process timed out: state={}, debugger={:?}, output={}",
                    snapshot.state,
                    snapshot.debugger_state,
                    snapshot.output
                );
                std::thread::sleep(Duration::from_millis(30));
            }
        };
        let entry = wait_for(&|snapshot| {
            snapshot
                .debugger_state
                .as_ref()
                .is_some_and(|state| state.reason.as_deref() == Some("entry"))
        });
        let entry_state = entry.debugger_state.unwrap();
        assert_eq!(entry_state.status, Status::Suspended);
        assert!(!entry.output.contains("JPMS_JDI_OK:"));
        structured_debugger::send(
            &job,
            &Action::Continue {
                stop_id: entry_state.stop_id.unwrap(),
            },
        )
        .unwrap();
        let completed = wait_for(&|snapshot| snapshot.output.contains("JPMS_JDI_OK:two words|"));
        assert!(completed.output.contains("JPMS_JDI_OK:two words|"));
        assert_eq!(
            finished_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("the JDI bridge did not exit after the module completed")
                .unwrap(),
            0
        );
        worker.join().unwrap();
        fs::remove_dir_all(temporary).unwrap();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SourceSetExecutionSupport {
    standard_main: bool,
    standard_test: bool,
    custom_gradle: bool,
}

fn source_set_execution_support(
    build_tool: &str,
    source_set_kind: &str,
    source_set_id: &str,
    operation: &str,
    maven_failsafe: Option<&super::super::refactorkit_daemon::MavenFailsafeExecution>,
) -> Result<SourceSetExecutionSupport, String> {
    let standard_main = source_set_kind == "main" && (source_set_id == "main" || build_tool == "jdk");
    let standard_test = source_set_kind == "test" && (source_set_id == "test" || build_tool == "jdk");
    let maven_integration_test = build_tool == "maven" && source_set_kind == "integration-test";
    let custom_gradle = build_tool == "gradle" && !standard_main && !standard_test;
    if operation == "clean" && ["maven", "gradle"].contains(&build_tool) {
        return Ok(SourceSetExecutionSupport { standard_main, standard_test, custom_gradle });
    }
    if !standard_main && !standard_test && !custom_gradle && !maven_integration_test {
        return Err(
            "This source set requires a qualified build-tool task mapping before execution.".into(),
        );
    }
    if maven_integration_test && !["integration-test", "integration-coverage"].contains(&operation)
    {
        return Err(
            "This Maven integration-test source set is mapped only to Failsafe integration tests and integration coverage.".into(),
        );
    }
    if maven_integration_test {
        let failsafe = maven_failsafe
            .ok_or("Maven integration tests require complete RefactorKit Failsafe metadata.")?;
        if failsafe.plugin_version.is_empty()
            || failsafe.execution_id.is_empty()
            || failsafe.phase != "integration-test"
            || !failsafe.goals.iter().any(|goal| goal == "integration-test")
            || !failsafe.goals.iter().any(|goal| goal == "verify")
            || failsafe.report_directory.is_empty()
        {
            return Err(
                "The selected Maven Failsafe execution has no supported verify mapping.".into(),
            );
        }
    }
    if custom_gradle
        && !["build", "run", "debug", "test", "discover", "coverage"].contains(&operation)
    {
        return Err(
            "This Gradle source set has no qualified operation mapping. Build, Run, Debug, uniquely mapped Test execution, discovery and coverage are available."
                .into(),
        );
    }
    Ok(SourceSetExecutionSupport {
        standard_main,
        standard_test,
        custom_gradle,
    })
}

fn maven_test_fork_launchers(
    project: &ResolvedProject,
    operation: &str,
) -> Result<Vec<maven_test_forks::Fork>, String> {
    let Some(selections) = project.maven_test_jvm_selections.as_ref() else {
        return Ok(Vec::new());
    };
    let modules = project.maven_test_jvm_modules.as_ref()
        .ok_or("Cannot establish the Maven reactor scope for test JVM selection.")?;
    let includes_failsafe = matches!(operation, "integration-test" | "integration-coverage");
    let mut needs_fork_launcher = false;
    let mut qualified = Vec::new();
    for module in modules {
        for source_set in &module.source_sets {
            let (goal, plugin_name) = match source_set.kind.as_str() {
                "test" => ("test", "Surefire"),
                "integration-test" if includes_failsafe => ("integration-test", "Failsafe"),
                _ => continue,
            };
            let facts = selections.get(&(module.module_id.clone(), source_set.id.clone()))
                .ok_or("Missing execution-bound Maven test JVM selections.")?;
            let executions = source_set.test_jvm["executions"].as_array()
                .filter(|executions| executions.len() == facts.len())
                .ok_or("Maven test JVM selections do not match the attested executions.")?;
            for (execution, selection) in executions.iter().zip(facts) {
                let jvm = maven_fork_jvm(selection, &project.sdk_home)
                    .map_err(|reason| format!(
                        "Cannot apply Maven test JVM options to {plugin_name} in module {}: {reason}. Clear Test JVM options to use the project's defaults.",
                        module.module_id,
                    ))?;
                needs_fork_launcher |= match &jvm {
                    maven_test_forks::Jvm::Toolchain(_) | maven_test_forks::Jvm::BuildContextToolchain => true,
                    maven_test_forks::Jvm::Fixed { major, .. } =>
                        *major == 8 || (cfg!(unix) && maven_execution_has_argline(execution)),
                };
                qualified.push((module, execution, goal, jvm));
            }
        }
    }
    if !needs_fork_launcher {
        return Ok(Vec::new());
    }
    qualified.into_iter().map(|(module, execution, goal, jvm)| {
        let field = |name: &str| execution[name].as_str().filter(|value| !value.is_empty())
            .map(str::to_owned).ok_or("Missing identity for a Maven test fork.");
        let module = module.root.as_ref().and_then(|root| root.canonicalize().ok())
            .filter(|root| root.is_dir() && root.starts_with(&project.root))
            .ok_or("The Maven test fork's module directory is unavailable.")?;
        Ok(maven_test_forks::Fork {
            module, jvm, goal,
            plugin: field("pluginId")?,
            version: field("pluginVersion")?,
            execution: field("executionId")?,
        })
    }).collect()
}

fn maven_fork_jvm(
    selection: &MavenTestJvmSelection,
    sdk: &Path,
) -> Result<maven_test_forks::Jvm, &'static str> {
    let (java, inherited) = match selection {
        MavenTestJvmSelection::BuildJvm => (sdk.join("bin").join(executable_name("java")), true),
        MavenTestJvmSelection::ExplicitExecutable(executable) => (executable.clone(), false),
        MavenTestJvmSelection::ToolchainRequirements(requirements) => {
            return Ok(maven_test_forks::Jvm::Toolchain(requirements.clone()));
        }
        MavenTestJvmSelection::BuildContextToolchain => return Ok(maven_test_forks::Jvm::BuildContextToolchain),
        MavenTestJvmSelection::Unavailable => return Err("the effective test JVM is unqualified"),
    };
    let real_java = java.canonicalize().ok().filter(|java| java.is_file())
        .ok_or("the selected test JVM executable is unavailable")?;
    let major = [java.as_path(), real_java.as_path()].into_iter()
        .filter_map(|path| path.parent().and_then(Path::parent))
        .find_map(|home| launch_settings::java_launcher_major(home).or_else(|| {
            if home.file_name().is_some_and(|name| name == "jre") {
                home.parent().and_then(launch_settings::java_launcher_major)
            } else {
                None
            }
        }))
        .filter(|major| *major >= 8)
        .ok_or("the selected test JVM version could not be established")?;
    Ok(maven_test_forks::Jvm::Fixed { java: real_java, major, inherited })
}

fn validate_maven_test_jvm_options(
    schema_version: &str,
    build_tool: &str,
    modules: Option<&[super::super::refactorkit_daemon::MavenTestJvmModuleFacts]>,
    selected_module_id: &str,
    selected_source_set_id: &str,
    operation: &str,
    preserves_argline: bool,
) -> Result<(), String> {
    if schema_version != "java-project-context-v7" || build_tool != "maven" {
        return Ok(());
    }
    let includes_failsafe = match operation {
        "test" | "coverage" => false,
        // Maven integration-test runs `verify`, which also runs the Surefire
        // `test` phase. The injected -DargLine is a Maven user property and
        // can affect either plugin in every project Maven builds in the reactor.
        "integration-test" | "integration-coverage" => true,
        // Discovery launches the test engine directly and does not delegate to Surefire/Failsafe.
        "discover" => return Ok(()),
        _ => return Ok(()),
    };
    let modules = modules.ok_or(
        "Cannot apply Maven test JVM options: RefactorKit did not provide complete reactor and module-dependency facts.",
    )?;
    let selected_modules = modules
        .iter()
        .filter(|module| module.module_id == selected_module_id)
        .collect::<Vec<_>>();
    if selected_modules.len() != 1 {
        return Err(
            "Cannot apply Maven test JVM options: the selected module is absent from reactor facts."
                .into(),
        );
    }
    let mut selected_source_set_has_failsafe = false;
    for module in modules {
        let test_source_sets = module
            .source_sets
            .iter()
            .filter(|source_set| source_set.kind == "test")
            .collect::<Vec<_>>();
        if test_source_sets.is_empty() {
            return Err(format!(
                "Cannot apply Maven test JVM options: RefactorKit provided no Surefire scope for reactor module {}.",
                module.module_id
            ));
        }
        for source_set in test_source_sets {
            validate_maven_plugin_jvm_fact(
                &module.module_id,
                "Surefire",
                "org.apache.maven.plugins:maven-surefire-plugin",
                "test",
                &source_set.test_jvm,
                preserves_argline,
            )?;
        }
        if !includes_failsafe {
            continue;
        }
        for source_set in &module.source_sets {
            if source_set.kind != "integration-test" {
                continue;
            }
            let failsafe_executions = source_set.failsafe["executions"].as_array();
            let failsafe_availability = source_set.failsafe["availability"].as_str();
            if failsafe_executions.is_some_and(Vec::is_empty)
                && matches!(
                    failsafe_availability,
                    Some("not-declared" | "not-applicable")
                )
                && source_set.failsafe["refusalCode"].is_null()
            {
                if module.module_id == selected_module_id && source_set.id == selected_source_set_id
                {
                    return Err("Cannot apply Maven test JVM options: the selected Failsafe execution is unavailable.".into());
                }
                continue;
            }
            if failsafe_availability != Some("complete")
                || !failsafe_executions.is_some_and(|items| !items.is_empty())
            {
                return Err(format!(
                    "Cannot apply Maven test JVM options: RefactorKit did not completely qualify Failsafe for reactor module {}.",
                    module.module_id
                ));
            }
            validate_maven_plugin_jvm_fact(
                &module.module_id,
                "Failsafe",
                "org.apache.maven.plugins:maven-failsafe-plugin",
                "integration-test",
                &source_set.test_jvm,
                preserves_argline,
            )?;
            if module.module_id == selected_module_id && source_set.id == selected_source_set_id {
                selected_source_set_has_failsafe = true;
            }
        }
    }
    if includes_failsafe && !selected_source_set_has_failsafe {
        return Err(
            "Cannot apply Maven test JVM options: RefactorKit did not provide complete JVM facts for the selected Failsafe source set.".into(),
        );
    }
    Ok(())
}

fn validate_maven_plugin_jvm_fact(
    module_id: &str,
    plugin_name: &str,
    expected_plugin: &str,
    kind: &str,
    fact: &Value,
    preserves_argline: bool,
) -> Result<(), String> {
    let Some(executions) = fact["executions"]
        .as_array()
        .filter(|items| !items.is_empty())
    else {
        if matches!(
            fact["availability"].as_str(),
            Some("not-applicable" | "not-declared")
        ) && fact["refusalCode"].is_null()
        {
            return Ok(());
        }
        return Err(format!(
            "Cannot apply Maven test JVM options: RefactorKit found no complete {plugin_name} execution for reactor module {module_id}."
        ));
    };
    if fact["availability"] != "complete"
        || fact["mode"] != "forked"
        || !fact["refusalCode"].is_null()
        || executions.iter().any(|execution| {
            execution["pluginId"] != expected_plugin
                || execution["mode"] != "forked"
                || execution["availability"] != "complete"
                || !execution["refusalCode"].is_null()
                || !execution["goals"].as_array().is_some_and(|goals| {
                    if kind == "test" {
                        goals.iter().any(|goal| goal == "test")
                    } else {
                        goals.iter().any(|goal| goal == "integration-test")
                            && goals.iter().any(|goal| goal == "verify")
                    }
                })
        })
    {
        return Err(format!(
            "Cannot apply Maven test JVM options: the {plugin_name} execution is in-process, incomplete or ambiguous in reactor module {module_id}."
        ));
    }
    for execution in executions {
        for field in ["forkSettings", "argLineLayers"] {
            let Some(settings) = execution[field].as_array() else {
                return Err("Cannot apply Maven test JVM options: RefactorKit returned invalid JVM setting provenance.".into());
            };
            if settings.iter().any(|setting| {
                setting["redacted"] != false
                    || !matches!(
                        setting["availability"].as_str(),
                        Some("complete" | "not-declared" | "not-applicable")
                    )
            }) {
                return Err(format!(
                    "Cannot apply Maven test JVM options: the {kind} plugin has incomplete or redacted JVM settings in reactor module {module_id}."
                ));
            }
        }
        if !preserves_argline && maven_execution_has_argline(execution)
        {
            return Err(format!(
                "Cannot safely add test JVM options while the Maven {kind} plugin defines argLine in reactor module {module_id}. Reconcile the project agent options first."
            ));
        }
    }
    Ok(())
}

fn maven_execution_has_argline(execution: &Value) -> bool {
    execution["argLineLayers"].as_array().is_some_and(|settings| {
        settings.iter().any(|setting| {
            setting["name"] == "argLine"
                && setting["value"].as_str().is_some_and(|value| !value.trim().is_empty())
        })
    }) || execution["effectiveArgLineTemplate"]
        .as_str()
        .is_some_and(|template| !template.trim().is_empty())
}

fn map_maven_failsafe_report_directory(
    steps: &mut [Invocation],
    failsafe: &super::super::refactorkit_daemon::MavenFailsafeExecution,
) -> Result<(), String> {
    for step in steps {
        if !step.arguments.iter().any(|argument| argument == "verify") {
            return Err(format!(
                "The declared Maven Failsafe execution {} does not map to the verify lifecycle.",
                failsafe.execution_id
            ));
        }
        step.test_report_path = Some(failsafe.report_directory.clone());
    }
    Ok(())
}

fn maven_discovery_invocations(
    job: &Arc<Job>,
    resolved: &super::super::refactorkit_daemon::ResolvedProject,
) -> Result<Vec<Invocation>, String> {
    let artifact = Arc::new(DiscoveryArtifact::create(
        &job.binding.canonical_root,
        &resolved.module_root,
        &job.request.configuration.project_path,
        "maven",
        &job.request.configuration.test_jvm_options,
        None,
        None,
    )?);
    let mut arguments = artifact.arguments(&job.binding.canonical_root)?;
    arguments.extend(
        resolved
            .output_directories
            .iter()
            .filter(|path| path.is_dir())
            .map(|path| {
                path.to_str()
                    .map(str::to_owned)
                    .ok_or("Test output paths must be UTF-8.")
            })
            .collect::<Result<Vec<_>, _>>()?,
    );
    if arguments.len() == 3 {
        return Err("No compiled outputs exist for the selected test source set.".into());
    }
    artifact.direct_invocations(
        &resolved.module_root,
        &resolved.sdk_home,
        &resolved.runtime_classpath,
        &job.request.configuration.test_jvm_options,
        &arguments,
    )
}

fn prepare_gradle_source_set(
    steps: &mut [Invocation],
    module: &Path,
    source_set: &str,
    include_runtime_classpath: bool,
    gradle_project_path: Option<&str>,
    build_root: Option<&Path>,
) -> Result<(), String> {
    use base64::Engine;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Cannot identify the project runtime preparation.")?;
    let task = format!(
        "idePrepareJavaSourceSet{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let task_selector = gradle_project_path
        .map(|project_path| qualify_gradle_task(project_path, &task))
        .unwrap_or_else(|| task.clone());
    let data = serde_json::to_vec(&serde_json::json!({
        "module":module,
        "buildRoot": build_root,
        "sourceSet":source_set,
        "task":task,
        "includeRuntimeClasspath":include_runtime_classpath,
    }))
    .map_err(|_| "Invalid Gradle runtime selection.")?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    let script = format!(
        r#"def ideRuntime = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{encoded}'), 'UTF-8'))
gradle.projectsEvaluated {{
    if (ideRuntime.buildRoot != null && gradle.rootProject.projectDir.canonicalPath != ideRuntime.buildRoot) return
    def selected = gradle.rootProject.allprojects.find {{ it.projectDir.canonicalPath == ideRuntime.module }}
    if (selected == null && gradle.parent != null && ideRuntime.buildRoot == null) return
    if (selected == null) throw new org.gradle.api.GradleException('Selected Java module is unavailable')
    def sets = selected.extensions.findByName('sourceSets')
    def source = sets == null ? null : sets.findByName(ideRuntime.sourceSet)
    if (source == null) throw new org.gradle.api.GradleException('Selected Java source set is unavailable')
    selected.tasks.register(ideRuntime.task) {{
        dependsOn(selected.tasks.named(source.classesTaskName))
        if (ideRuntime.includeRuntimeClasspath) dependsOn(source.runtimeClasspath)
    }}
}}
"#
    );
    for step in steps {
        let file = LaunchFile::create("project-runtime.init.gradle", script.as_bytes())?;
        let index = step
            .arguments
            .iter()
            .position(|arg| {
                ["classes", "testClasses"].contains(&arg.as_str())
                    || arg.ends_with(":classes")
                    || arg.ends_with(":testClasses")
            })
            .ok_or("Missing Gradle source-set compilation task.")?;
        step.arguments[index] = task_selector.clone();
        step.arguments.extend([
            "--init-script".into(),
            file.path
                .to_str()
                .ok_or("Launch paths must be UTF-8.")?
                .into(),
        ]);
        step.auxiliary_files.push(file);
    }
    Ok(())
}

fn prepare_gradle_test_task(
    steps: &mut [Invocation],
    module: &Path,
    source_set: &str,
    test_jvm_options: &[String],
    selectors: &[String],
    build_root: Option<&Path>,
) -> Result<(), String> {
    use base64::Engine;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Cannot identify the project test mapping.")?;
    let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let task = format!("ideRunJavaSourceSetTest{suffix}");
    let data = serde_json::to_vec(&serde_json::json!({
        "module": module.to_str().ok_or("Gradle module paths must be UTF-8.")?,
        "buildRoot": build_root,
        "sourceSet": source_set,
        "task": task,
        "options": test_jvm_options,
        "selectors": selectors,
    }))
    .map_err(|_| "Invalid Gradle test-task selection.")?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    let script = format!(
        r#"def ideTest = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{encoded}'), 'UTF-8'))
gradle.projectsEvaluated {{
    if (ideTest.buildRoot != null && gradle.rootProject.projectDir.canonicalPath != ideTest.buildRoot) return
    def selected = gradle.rootProject.allprojects.find {{ it.projectDir.canonicalPath == ideTest.module }}
    if (selected == null && gradle.parent != null && ideTest.buildRoot == null) return
    if (selected == null) throw new org.gradle.api.GradleException('The selected Java module is unavailable')
    def sets = selected.extensions.findByName('sourceSets')
    def source = sets == null ? null : sets.findByName(ideTest.sourceSet)
    if (source == null) throw new org.gradle.api.GradleException('The selected Java source set is unavailable')
    def expectedClasses = source.output.classesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
    if (expectedClasses.isEmpty()) throw new org.gradle.api.GradleException('The selected source set has no compiled test classes')
    def candidates = selected.tasks.withType(org.gradle.api.tasks.testing.Test).findAll {{ candidate ->
        def actualClasses = candidate.testClassesDirs.files.collect {{ it.canonicalFile.toPath() }} as Set
        actualClasses == expectedClasses
    }}
    if (candidates.size() > 1) {{
        def sourceRuntime = source.runtimeClasspath
        candidates = candidates.findAll {{ candidate -> candidate.classpath == sourceRuntime }}
    }}
    if (candidates.size() != 1) throw new org.gradle.api.GradleException('The selected source set must map to exactly one Gradle Test task with matching test classes')
    def testTask = candidates.first()
    if (!testTask.enabled) throw new org.gradle.api.GradleException('The selected Gradle Test task is disabled')
    testTask.dependsOn(selected.tasks.named(source.classesTaskName))
    testTask.outputs.upToDateWhen {{ false }}
    testTask.doFirst {{
        def expectedRuntime = source.runtimeClasspath.files.collect {{ it.canonicalFile.toPath() }} as Set
        def actualClasspath = testTask.classpath.files.collect {{ it.canonicalFile.toPath() }} as Set
    if (!expectedRuntime.every {{ actualClasspath.contains(it) }}) throw new org.gradle.api.GradleException('The selected Gradle Test task does not contain the source set runtime classpath')
    }}
    if (!ideTest.selectors.isEmpty()) testTask.filter {{ ideTest.selectors.each {{ includeTestsMatching(it.replace('#', '.')) }} }}
    if (!ideTest.options.isEmpty()) testTask.jvmArgs(ideTest.options)
    selected.tasks.register(ideTest.task) {{ dependsOn(testTask) }}
}}
"#
    );
    for step in steps {
        let task_index = step
            .arguments
            .iter()
            .position(|argument| argument == "test")
            .ok_or("Missing Gradle test task selector.")?;
        step.arguments[task_index] = task.clone();
        let mut filtered_arguments = Vec::with_capacity(step.arguments.len());
        let mut argument_index = 0;
        while argument_index < step.arguments.len() {
            if step.arguments[argument_index] == "--tests" {
                if argument_index + 1 >= step.arguments.len() {
                    return Err("Gradle test selector is incomplete.".into());
                }
                argument_index += 2;
            } else {
                filtered_arguments.push(step.arguments[argument_index].clone());
                argument_index += 1;
            }
        }
        step.arguments = filtered_arguments;
        let file = LaunchFile::create("project-test.init.gradle", script.as_bytes())?;
        step.arguments.extend([
            "--init-script".into(),
            file.path
                .to_str()
                .ok_or("Gradle test script paths must be UTF-8.")?
                .into(),
        ]);
        step.auxiliary_files.push(file);
    }
    Ok(())
}

fn configure_build(
    steps: &mut [Invocation],
    project: &super::super::refactorkit_daemon::ResolvedProject,
    settings: &Value,
    filtered: bool,
    workspace: &Path,
) -> Result<(), String> {
    for step in steps {
        if project.build_tool == "maven" {
            step.directory = project.root.clone();
            step.executable = project.maven_launcher.clone()
                .or_else(|| build_tool(&project.root, &project.root, "mvn"))
                .ok_or("Maven is unavailable.")?;
            let relative = project
                .module_root
                .strip_prefix(&project.root)
                .map_err(|_| "The module moved outside its project.")?;
            if !relative.as_os_str().is_empty() {
                let path = relative.to_str().ok_or("Module paths must be UTF-8.")?;
                if path.starts_with('-') || path.contains(',') {
                    return Err(
                        "The module path cannot be passed safely to Maven's project selector."
                            .into(),
                    );
                }
                step.arguments
                    .extend(["--projects".into(), path.into(), "--also-make".into()]);
                if filtered {
                    step.arguments
                        .push("-Dsurefire.failIfNoSpecifiedTests=false".into());
                }
                // Reactor dependencies may have no tests. Fresh reports from the selected
                // module still determine whether the requested tests actually executed.
                step.arguments.push("-DfailIfNoTests=false".into());
            }
            append_maven_settings(&mut step.arguments, settings)?;
        } else {
            let build_root = project.gradle_invocation_root();
            step.directory = build_root.to_path_buf();
            if let Some(executable) = configured_gradle(build_root, workspace, settings["gradle"]["executable"].as_str())? {
                step.executable = executable;
            }
            if let Some(home) = settings["gradle"]["userHome"]
                .as_str()
                .filter(|v| !v.is_empty())
            {
                step.arguments
                    .extend(["--gradle-user-home".into(), home.into()]);
            }
            if let Some(properties) = settings["gradle"]["projectProperties"].as_object() {
                for (key, value) in properties {
                    step.arguments.push(format!(
                        "-P{key}={}",
                        value.as_str().ok_or("Invalid Gradle project property.")?
                    ));
                }
            }
            if let Some(project_path) = project.gradle_task_project_path() {
                let task_index = step
                    .arguments
                    .iter()
                    .position(|argument| !argument.starts_with('-'))
                    .ok_or("Missing Gradle task selector.")?;
                let task = &step.arguments[task_index];
                if !task.starts_with(':') {
                    step.arguments[task_index] = qualify_gradle_task(project_path, task);
                }
            }
        }
    }
    Ok(())
}

fn qualify_gradle_task(project_path: &str, task: &str) -> String {
    if project_path == ":" {
        format!(":{task}")
    } else {
        format!("{project_path}:{task}")
    }
}

pub(super) fn append_maven_settings(arguments: &mut Vec<String>, settings: &Value) -> Result<(), String> {
    if let Some(repository) = settings["mavenRepository"]
        .as_str()
        .filter(|v| !v.is_empty())
    {
        arguments.push(format!("-Dmaven.repo.local={repository}"));
    }
    let mut profiles = Vec::new();
    for (name, inactive) in [
        ("activeMavenProfiles", false),
        ("inactiveMavenProfiles", true),
    ] {
        for profile in settings[name].as_array().ok_or("Missing Maven profiles.")? {
            let profile = profile
                .as_str()
                .filter(|v| {
                    !v.is_empty()
                        && !v.contains([',', '\0', '\n', '\r'])
                        && !v.starts_with(['!', '-', '+', '?'])
                })
                .ok_or("The selected Maven profile cannot be represented safely.")?;
            profiles.push(format!("{}{profile}", if inactive { "!" } else { "+" }));
        }
    }
    if !profiles.is_empty() {
        arguments.push(format!("-P{}", profiles.join(",")));
    }
    Ok(())
}

pub(super) fn configure_report(
    step: &mut Invocation,
    workspace: &Path,
    selection: &JavaExecutionProjectSelection,
    maven_launcher: Option<PathBuf>,
) -> Result<(), String> {
    let settings = serde_json::to_value(selection)
        .map_err(|_| "Invalid coverage project settings.")?["context"]
        .clone();
    let project = execution_root(
        workspace,
        settings["projectPath"]
            .as_str()
            .ok_or("Missing coverage project root.")?,
    )?;
    if !step.directory.starts_with(&project) {
        return Err("The coverage module moved outside its project.".into());
    }
    step.executable = maven_launcher.or_else(|| build_tool(&project, &project, "mvn"))
        .ok_or("The selected project Maven executable is unavailable.")?;
    append_maven_settings(&mut step.arguments, &settings)
}

pub(super) fn runtime_invocations(
    directory: PathBuf,
    home: PathBuf,
    classpath: &str,
    module: Option<(&str, &str)>,
    request: &Request,
) -> Result<Vec<Invocation>, String> {
    if request.operation == "debug" && request.configuration.debugger_mode == "jdb" && java8_launcher(&home) {
        if module.is_some() {
            return Err("Named Java modules require JDK 9 or later.".into());
        }
        return super::launch_settings::java8_console_debugger(
            directory, home, classpath, &request.configuration,
        );
    }
    Ok(vec![runtime_invocation(directory, home, classpath, module, request)?])
}

fn runtime_invocation(
    directory: PathBuf,
    home: PathBuf,
    classpath: &str,
    module: Option<(&str, &str)>,
    request: &Request,
) -> Result<Invocation, String> {
    let config = &request.configuration;
    let debugging = request.operation == "debug";
    if debugging && config.debugger_mode == "jdi" {
        return structured_application_invocation(directory, home, classpath, module, config);
    }
    let legacy_launcher = java8_launcher(&home);
    let file = if let Some((module_path, module_name)) = module {
        Some(java_module_argument_file(
            &config.jvm_options,
            module_path,
            module_name,
            &config.main_class,
            &config.program_arguments,
        )?)
    } else if legacy_launcher {
        None
    } else {
        Some(java_argument_file(
            &config.jvm_options,
            &config.main_class,
            &config.program_arguments,
            Some(classpath),
        )?)
    };
    let java = home.join("bin").join(executable_name("java"));
    let (executable, arguments, auxiliary_files) = match file.as_ref() {
        Some(file) if debugging => {
            let reference = file.argument_reference()?;
            if reference.contains([',', '\n', '\r', '\'', '"']) {
                return Err(
                    "The debugger launch path contains unsupported connector characters.".into(),
                );
            }
            (
                home.join("bin").join(executable_name("jdb")),
                vec!["-launch".into(), reference],
                vec![],
            )
        }
        Some(file) => (java, vec![file.argument_reference()?], vec![]),
        None => (
            java,
            java_arguments(
                &config.jvm_options,
                &config.main_class,
                &config.program_arguments,
                Some(classpath),
            ),
            vec![],
        ),
    };
    if !executable.is_file() {
        return Err("The selected JDK runtime or debugger is unavailable.".into());
    }
    Ok(Invocation {
        directory,
        executable,
        arguments,
        interactive: debugging,
        java_home: home,
        launch_file: file,
        discovery: None,
        coverage: None,
        auxiliary_files,
        profile_path: None,
        test_report_path: None,
    })
}

fn structured_application_invocation(
    directory: PathBuf,
    home: PathBuf,
    classpath: &str,
    module: Option<(&str, &str)>,
    config: &Configuration,
) -> Result<Invocation, String> {
    let host = structured_debugger::launch_home(&home).ok_or(
        "Structured application debugging requires a full JDK 17 or later. Configure IDE_JAVA_DEBUGGER_HOME when the project uses an older JDK.",
    )?;
    let bridge = LaunchFile::create("IdeJavaDebugger.java", structured_debugger::SOURCE)?;
    let mut arguments = vec![
        "--add-modules=jdk.jdi".into(),
        bridge.path.to_str().ok_or("Debugger paths must be UTF-8.")?.into(),
    ];
    let launch = if host != home {
        use super::launch_settings::{direct_java_launch, java_module_arguments};
        let target_arguments = if let Some((module_path, module_name)) = module {
            java_module_arguments(
                &config.jvm_options, module_path, module_name, &config.main_class, &config.program_arguments,
            )?
        } else {
            java_arguments(
                &config.jvm_options, &config.main_class, &config.program_arguments, Some(classpath),
            )
        };
        arguments.push("--launch-direct".into());
        direct_java_launch(&home.join("bin").join(executable_name("java")), &target_arguments)?
    } else if let Some((module_path, module_name)) = module {
        java_module_argument_file(
            &config.jvm_options, module_path, module_name, &config.main_class, &config.program_arguments,
        )?
    } else {
        java_argument_file(
            &config.jvm_options, &config.main_class, &config.program_arguments, Some(classpath),
        )?
    };
    arguments.push(launch.path.to_str().ok_or("Launch paths must be UTF-8.")?.into());
    let executable = host.join("bin").join(executable_name("java"));
    if !executable.is_file() {
        return Err("The structured debugger runtime is unavailable.".into());
    }
    Ok(Invocation {
        directory,
        executable,
        arguments,
        interactive: true,
        java_home: home,
        launch_file: Some(launch),
        discovery: None,
        coverage: None,
        auxiliary_files: vec![bridge],
        profile_path: None,
        test_report_path: None,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        configure_build, java8_launcher, map_maven_failsafe_report_directory, prepare_gradle_source_set,
        qualify_gradle_task, select_gradle_runtime_home, source_set_execution_support,
        runtime_invocation, validate_maven_test_jvm_options, LaunchFile, Request,
        SourceSetExecutionSupport,
    };
    use crate::commands::java_execution::{Invocation, prepend_clean_to_build};
    use crate::commands::refactorkit_daemon::{
        MavenFailsafeExecution, MavenTestJvmModuleFacts, MavenTestJvmSourceSetFacts,
        ResolvedProject,
    };
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    #[ignore = "requires a full Java 8 JDK selected with IDE_JAVA_CONTEXT_TEST_JDK"]
    fn real_java8_synchronized_launcher_preserves_literal_arguments() {
        let home = PathBuf::from(std::env::var_os("IDE_JAVA_CONTEXT_TEST_JDK").unwrap());
        assert!(java8_launcher(&home));
        let source = LaunchFile::create("Main.java", br#"
public class Main {
    public static void main(String[] args) {
        System.out.println(System.getProperty("launch.literal"));
        for (String arg : args) System.out.println("[" + arg + "]");
    }
}
"#).unwrap();
        let root = source.path.parent().unwrap();
        let compiled = std::process::Command::new(home.join("bin").join(super::executable_name("javac")))
            .arg(&source.path)
            .output().unwrap();
        assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
        let request: Request = serde_json::from_value(json!({
            "workspaceId":"one","generation":1,"operation":"run","trusted":true,
            "configuration":{"buildTool":"maven","mainClass":"Main","classPath":[],
                "jvmOptions":["-Dlaunch.literal=value with spaces"],
                "programArguments":["","a b","@literal","both'\"quotes"]}
        })).unwrap();
        let invocation = runtime_invocation(root.to_owned(), home, root.to_str().unwrap(), None, &request)
            .unwrap();
        assert!(invocation.launch_file.is_none());
        let output = std::process::Command::new(invocation.executable)
            .args(invocation.arguments)
            .current_dir(invocation.directory)
            .output().unwrap();
        fs::remove_file(root.join("Main.class")).unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().lines().collect::<Vec<_>>(),
            ["value with spaces", "[]", "[a b]", "[@literal]", "[both'\"quotes]"],
        );
    }

    fn maven_test_jvm_fact(kind: &str) -> serde_json::Value {
        let (plugin_id, goals) = if kind == "test" {
            (
                "org.apache.maven.plugins:maven-surefire-plugin",
                json!(["test"]),
            )
        } else {
            (
                "org.apache.maven.plugins:maven-failsafe-plugin",
                json!(["integration-test", "verify"]),
            )
        };
        json!({
            "availability":"complete","mode":"forked","refusalCode":null,
            "executions":[{
                "pluginId":plugin_id,"pluginVersion":"3.5.3","executionId":"default-test",
                "goals":goals,"phase":if kind == "test" { "test" } else { "integration-test" },
                "mode":"forked","availability":"complete","refusalCode":null,
                "forkSettings":[{"name":"forkCount","value":"1","origin":"plugin-default",
                    "availability":"complete","redacted":false}],
                "argLineLayers":[],"effectiveArgLineTemplate":null
            }]
        })
    }

    fn maven_module_facts(
        module_id: &str,
        source_sets: &[(&str, &str, serde_json::Value)],
    ) -> MavenTestJvmModuleFacts {
        MavenTestJvmModuleFacts {
            module_id: module_id.into(),
            root: None,
            source_sets: source_sets
                .iter()
                .map(|(id, kind, test_jvm)| MavenTestJvmSourceSetFacts {
                    id: (*id).into(),
                    kind: (*kind).into(),
                    test_jvm: test_jvm.clone(),
                    failsafe: if *kind == "integration-test" {
                        json!({"availability":"complete","refusalCode":null,"executions":[{
                            "pluginId":"org.apache.maven.plugins:maven-failsafe-plugin",
                            "pluginVersion":"3.5.3","executionId":"default-test",
                            "goals":["integration-test","verify"],"phase":"integration-test",
                            "availability":"complete","refusalCode":null
                        }]})
                    } else {
                        serde_json::Value::Null
                    },
                })
                .collect(),
        }
    }

    #[test]
    fn maven_test_options_require_complete_forked_v7_facts_and_do_not_overwrite_argline() {
        let test = maven_test_jvm_fact("test");
        let mut facts = vec![maven_module_facts(
            "app",
            &[
                ("test", "test", test.clone()),
                (
                    "integrationTest",
                    "integration-test",
                    maven_test_jvm_fact("integration-test"),
                ),
            ],
        )];
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&facts),
            "app",
            "test",
            "test",
            false,
        )
        .is_ok());
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&facts),
            "app",
            "integrationTest",
            "integration-test",
            false,
        )
        .is_ok());

        let mut incomplete_surefire = maven_test_jvm_fact("test");
        incomplete_surefire["executions"] = json!([]);
        let incomplete_facts = vec![maven_module_facts(
            "app",
            &[
                ("test", "test", incomplete_surefire),
                (
                    "integrationTest",
                    "integration-test",
                    maven_test_jvm_fact("integration-test"),
                ),
            ],
        )];
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&incomplete_facts),
            "app",
            "integrationTest",
            "integration-test",
            false,
        )
        .unwrap_err()
        .contains("Surefire"));
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&incomplete_facts),
            "app",
            "integrationTest",
            "integration-coverage",
            false,
        )
        .unwrap_err()
        .contains("Surefire"));
        assert_eq!(
            validate_maven_test_jvm_options(
                "java-project-context-v7",
                "maven",
                Some(&incomplete_facts),
                "app",
                "test",
                "coverage",
                false,
            )
            .unwrap_err(),
            "Cannot apply Maven test JVM options: RefactorKit found no complete Surefire execution for reactor module app."
        );

        let mut in_process = test.clone();
        in_process["mode"] = json!("in-process");
        facts[0].source_sets[0].test_jvm = in_process;
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&facts),
            "app",
            "test",
            "test",
            false,
        )
        .is_err());

        facts[0].source_sets[0].test_jvm = test.clone();
        facts[0].source_sets[0].test_jvm["executions"][0]["argLineLayers"] = json!([{
            "name":"argLine","value":"@{argLine} -javaagent:coverage.jar",
            "origin":"pom.xml","availability":"complete","redacted":false
        }]);
        facts[0].source_sets[0].test_jvm["executions"][0]["effectiveArgLineTemplate"] =
            json!("@{argLine} -javaagent:coverage.jar");
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&facts),
            "app",
            "test",
            "test",
            false,
        )
        .is_err());
        assert!(validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&facts),
            "app",
            "integrationTest",
            "integration-test",
            false,
        )
        .is_err());

        assert!(validate_maven_test_jvm_options(
            "java-project-context-v6",
            "maven",
            None,
            "app",
            "test",
            "test",
            false,
        )
        .is_ok());
    }

    #[test]
    fn maven_global_argline_requires_complete_facts_for_every_reactor_dependency() {
        let complete_test = maven_test_jvm_fact("test");
        let app = maven_module_facts(
            "app",
            &[
                ("test", "test", complete_test.clone()),
                (
                    "integrationTest",
                    "integration-test",
                    maven_test_jvm_fact("integration-test"),
                ),
            ],
        );
        let library = maven_module_facts(
            "library",
            &[("test", "test", {
                let mut partial = complete_test;
                partial["availability"] = json!("partial");
                partial
            })],
        );
        let closure = vec![app, library];
        let error = validate_maven_test_jvm_options(
            "java-project-context-v7",
            "maven",
            Some(&closure),
            "app",
            "integrationTest",
            "integration-test",
            false,
        )
        .unwrap_err();
        assert!(error.contains("Surefire"), "{error}");
        assert!(error.contains("library"), "{error}");
    }

    #[test]
    fn gradle_tasks_are_qualified_with_the_selected_build_project_path() {
        assert_eq!(qualify_gradle_task(":", "test"), ":test");
        assert_eq!(qualify_gradle_task(":lib", "classes"), ":lib:classes");
    }

    #[test]
    fn composite_gradle_execution_uses_the_build_root_and_qualified_task() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let workspace = std::env::temp_dir().join(format!(
            "ide-composite-gradle-execution-{}",
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let build_root = workspace.join("included-build");
        fs::create_dir_all(&build_root).unwrap();
        fs::write(build_root.join("gradlew"), "#!/bin/sh\nexit 0\n").unwrap();

        let mut project = ResolvedProject {
            project_context_schema_version: "java-project-context-v5".into(),
            root: workspace.join("selected-project"),
            module_root: workspace.join("custom-project-dir"),
            gradle_build_root: Some(build_root.clone()),
            gradle_project_path: Some(":lib".into()),
            gradle_build_tree_project_path: None,
            sdk_home: PathBuf::from("/sdk"),
            gradle_runtime_home: Some(PathBuf::from("/jdk-21")),
            build_tool: "gradle".into(),
            maven_launcher: None,
            declared_jdk: None,
            source_set_kind: "test".into(),
            runtime_classpath: Vec::new(),
            debugger_source_roots: Vec::new(),
            output_directories: Vec::new(),
            module_name: None,
            module_descriptor_hash: None,
            module_path_identity: None,
            module_path: Vec::new(),
            maven_failsafe: None,
            maven_test_jvm_modules: None,
            maven_test_jvm_selections: None,
        };
        let mut steps = vec![Invocation {
            directory: workspace.clone(),
            executable: PathBuf::new(),
            arguments: vec![
                "--no-daemon".into(),
                "--console=plain".into(),
                "test".into(),
            ],
            interactive: false,
            java_home: PathBuf::from("/sdk"),
            launch_file: None,
            discovery: None,
            coverage: None,
            auxiliary_files: Vec::new(),
            profile_path: None,
            test_report_path: None,
        }];

        select_gradle_runtime_home(&mut steps, &project).unwrap();
        assert_eq!(steps[0].java_home, PathBuf::from("/jdk-21"));
        assert_eq!(
            steps[0].arguments[0],
            "-Dorg.gradle.java.installations.paths=/sdk"
        );

        configure_build(
            &mut steps,
            &project,
            &json!({"gradle":{"userHome":"","projectProperties":{}}}),
            false,
            &workspace,
        )
        .unwrap();

        assert_eq!(steps[0].directory, build_root);
        assert_eq!(steps[0].executable, build_root.join("gradlew"));
        assert!(steps[0].arguments.contains(&":lib:test".into()));
        let task = steps[0].arguments.iter().position(|arg| arg == ":lib:test").unwrap();
        steps[0].arguments[task] = "clean".into();
        configure_build(&mut steps, &project, &json!({"gradle":{"userHome":"","projectProperties":{}}}), false, &workspace).unwrap();
        assert!(steps[0].arguments.contains(&":lib:clean".into()));
        assert_eq!(steps[0].directory, build_root);
        let task = steps[0].arguments.iter().position(|arg| arg == ":lib:clean").unwrap();
        steps[0].arguments[task] = ":lib:classes".into();
        prepend_clean_to_build(&mut steps, "gradle", Some(":lib")).unwrap();
        assert!(steps[0].arguments.windows(2).any(|args| args == [":lib:clean", ":lib:classes"]));
        assert_eq!(steps[0].directory, build_root);

        project.gradle_runtime_home = None;
        select_gradle_runtime_home(&mut steps, &project).unwrap();
        assert_eq!(steps[0].java_home, PathBuf::from("/sdk"));
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn composite_gradle_runtime_preparation_qualifies_the_selected_project_task() {
        let mut steps = vec![Invocation {
            directory: PathBuf::from("/workspace/gradle/included-build"),
            executable: PathBuf::from("/gradle"),
            arguments: vec!["--no-daemon".into(), ":app:classes".into()],
            interactive: false,
            java_home: PathBuf::from("/jdk"),
            launch_file: None,
            discovery: None,
            coverage: None,
            auxiliary_files: Vec::new(),
            profile_path: None,
            test_report_path: None,
        }];

        prepare_gradle_source_set(
            &mut steps,
            PathBuf::from("/workspace/gradle/app").as_path(),
            "main",
            true,
            Some(":app"),
            None,
        )
        .unwrap();

        assert!(steps[0].arguments[1].starts_with(":app:idePrepareJavaSourceSet"));
        assert!(steps[0]
            .arguments
            .windows(2)
            .any(|args| args[0] == "--init-script"));
    }

    #[test]
    fn standard_source_sets_keep_their_existing_operation_support() {
        assert_eq!(
            source_set_execution_support("gradle", "main", "main", "run", None).unwrap(),
            SourceSetExecutionSupport {
                standard_main: true,
                standard_test: false,
                custom_gradle: false,
            }
        );
        assert_eq!(
            source_set_execution_support("maven", "test", "test", "coverage", None).unwrap(),
            SourceSetExecutionSupport {
                standard_main: false,
                standard_test: true,
                custom_gradle: false,
            }
        );
        assert_eq!(
            source_set_execution_support("maven", "test", "test", "integration-coverage", None)
                .unwrap(),
            SourceSetExecutionSupport {
                standard_main: false,
                standard_test: true,
                custom_gradle: false,
            }
        );
    }

    #[test]
    fn maven_integration_source_sets_map_only_to_failsafe_operations() {
        let failsafe = MavenFailsafeExecution {
            execution_id: "run-tests".into(),
            plugin_version: "3.5.2".into(),
            phase: "integration-test".into(),
            goals: vec!["integration-test".into(), "verify".into()],
            report_directory: "app/target/failsafe-reports".into(),
        };
        for operation in ["integration-test", "integration-coverage"] {
            assert_eq!(
                source_set_execution_support(
                    "maven",
                    "integration-test",
                    "integrationTest",
                    operation,
                    Some(&failsafe)
                )
                .unwrap(),
                SourceSetExecutionSupport {
                    standard_main: false,
                    standard_test: false,
                    custom_gradle: false,
                }
            );
        }
        for operation in ["build", "run", "test", "coverage", "discover", "debug"] {
            assert!(source_set_execution_support(
                "maven",
                "integration-test",
                "integrationTest",
                operation,
                None
            )
            .is_err());
        }
        assert!(
            source_set_execution_support("maven", "custom", "smoke", "integration-test", None)
                .is_err()
        );
    }

    #[test]
    fn maven_failsafe_report_collection_uses_the_declared_directory() {
        let failsafe = MavenFailsafeExecution {
            execution_id: "run-tests".into(),
            plugin_version: "3.5.2".into(),
            phase: "integration-test".into(),
            goals: vec!["integration-test".into(), "verify".into()],
            report_directory: "app/target/failsafe-reports".into(),
        };
        let mut steps = vec![Invocation {
            directory: PathBuf::from("/workspace"),
            executable: PathBuf::from("/workspace/mvn"),
            arguments: vec!["verify".into()],
            interactive: false,
            java_home: PathBuf::from("/jdk"),
            launch_file: None,
            discovery: None,
            coverage: None,
            auxiliary_files: Vec::new(),
            profile_path: None,
            test_report_path: None,
        }];

        map_maven_failsafe_report_directory(&mut steps, &failsafe).unwrap();

        assert_eq!(
            steps[0].test_report_path.as_deref(),
            Some("app/target/failsafe-reports")
        );
    }

    #[test]
    fn additional_gradle_source_sets_enable_operations_with_qualified_task_mappings() {
        for operation in ["build", "run", "debug", "test", "discover", "coverage"] {
            assert_eq!(
                source_set_execution_support("gradle", "custom", "smoke", operation, None).unwrap(),
                SourceSetExecutionSupport {
                    standard_main: false,
                    standard_test: false,
                    custom_gradle: true,
                }
            );
        }
    }

    #[test]
    fn additional_maven_source_sets_remain_refused_without_a_task_mapping() {
        assert!(
            source_set_execution_support("maven", "custom", "smoke", "build", None)
                .unwrap_err()
                .contains("qualified build-tool task mapping")
        );
    }
}
