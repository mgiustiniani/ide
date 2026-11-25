//! Private build-tool test debugging primitives. Session/UI admission is separate.
use super::{
    executable_name, selected_jdk, structured_debugger, Configuration, Invocation, LaunchFile,
};
use serde::Deserialize;
use std::path::Path;

pub(super) fn listener_invocation(
    root: &Path,
    config: &Configuration,
) -> Result<Invocation, String> {
    if config.debugger_mode != "jdi" {
        return Err("Debugging tests requires the structured JDI debugger.".into());
    }
    let home = selected_jdk(&config.jdk_home)?;
    let debugger = structured_debugger::launch_home(&home).ok_or(
        "Debugging tests requires a full JDK 17 or later with JDI. Configure IDE_JAVA_DEBUGGER_HOME when using an older project JDK.",
    )?;
    let bridge = LaunchFile::create("IdeJavaDebugger.java", structured_debugger::SOURCE)?;
    Ok(Invocation {
        directory: root.to_owned(),
        executable: debugger.join("bin").join(executable_name("java")),
        arguments: vec![
            "--add-modules=jdk.jdi".into(),
            bridge
                .path
                .to_str()
                .ok_or("JDI bridge path must be UTF-8.")?
                .into(),
            "--listen-test".into(),
        ],
        interactive: true,
        java_home: home,
        launch_file: None,
        discovery: None,
        coverage: None,
        auxiliary_files: vec![bridge],
        profile_path: None,
        test_report_path: None,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Listener {
    kind: String,
    port: u16,
}

pub(super) fn listener_port(frame: &[u8]) -> Result<u16, String> {
    if frame.len() > 1024 || frame.last() != Some(&b'\n') {
        return Err("Invalid private test debugger listener frame.".into());
    }
    let listener: Listener = serde_json::from_slice(frame)
        .map_err(|_| "Invalid private test debugger listener frame.")?;
    if listener.kind != "testListener" || listener.port == 0 {
        return Err("Invalid private test debugger listener endpoint.".into());
    }
    Ok(listener.port)
}

/// Changes only this owned invocation; the project's descriptors stay untouched.
pub(super) fn configure_test_invocation(
    invocation: &mut Invocation,
    tool: &str,
    integration: bool,
    port: u16,
    project_module: Option<&Path>,
) -> Result<(), String> {
    if port == 0 {
        return Err("The test debugger listener is not ready.".into());
    }
    let agent =
        format!("-agentlib:jdwp=transport=dt_socket,server=n,suspend=y,address=127.0.0.1:{port}");
    match tool {
        "jdk" if !integration => invocation.arguments.insert(0, agent),
        "maven" => invocation.arguments.push(format!(
            "-Dmaven.{}.debug={agent}",
            if integration { "failsafe" } else { "surefire" },
        )),
        "gradle" => {
            use base64::Engine;
            let module = serde_json::to_vec(&project_module)
                .map_err(|_| "Cannot encode the selected Gradle test module.")?;
            let module = base64::engine::general_purpose::STANDARD.encode(module);
            let contents = format!(
                r#"def ideTestModule = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{module}'), 'UTF-8'))
gradle.taskGraph.whenReady {{ graph ->
  if (ideTestModule != null && !gradle.rootProject.allprojects.any {{ it.projectDir.canonicalPath == ideTestModule }}) return
  def tests = graph.allTasks.findAll {{ it instanceof org.gradle.api.tasks.testing.Test }}
  if (tests.size() != 1) throw new GradleException('IDE test debugging requires exactly one Test task in the selected task graph.')
  def selected = tests[0]
  if (ideTestModule != null && selected.project.projectDir.canonicalPath != ideTestModule)
    throw new GradleException('IDE test debugging did not select the requested module.')
  selected.maxParallelForks = 1
  selected.forkEvery = 0
  selected.debugOptions {{
    enabled = true
    host = '127.0.0.1'
    port = {port}
    server = false
    suspend = true
  }}
}}
"#
            );
            let file = LaunchFile::create("debug-test.gradle", contents.as_bytes())?;
            invocation.arguments.extend([
                "--no-configuration-cache".into(),
                "--init-script".into(),
                file.path
                    .to_str()
                    .ok_or("Test debugger settings path must be UTF-8.")?
                    .into(),
            ]);
            invocation.auxiliary_files.push(file);
        }
        _ => {
            return Err("The selected tool does not support this test debugging operation.".into())
        }
    }
    Ok(())
}

pub(super) fn is_debug(operation: &str) -> bool {
    matches!(operation, "debug-test" | "debug-integration-test")
}
pub(super) fn test_operation(operation: &str) -> &str {
    match operation {
        "debug-test" => "test",
        "debug-integration-test" => "integration-test",
        other => other,
    }
}
pub(super) fn validate(request: &super::Request, selections: &[String]) -> Result<(), String> {
    let selectors = if selections.is_empty() {
        std::slice::from_ref(&request.configuration.test_filter)
    } else {
        selections
    };
    if selectors.len() > 256 {
        return Err("Select at most 256 failed methods from one test class for debugging.".into());
    }
    let mut selected_class = None;
    for selector in selectors {
        let (class, method) = selector
            .split_once('#')
            .map_or((selector.as_str(), None), |(class, method)| {
                (class, Some(method))
            });
        if selector.len() > 512
            || !super::main_class(class)
            || method.is_some_and(|method| !super::main_class(method) || method.contains('.'))
        {
            return Err("Select one concrete test class or class#method for debugging; wildcard and compound selections are unavailable.".into());
        }
        if selected_class.is_some_and(|previous| previous != class) {
            return Err("Debugging failed tests requires selections from one test class.".into());
        }
        selected_class = Some(class);
    }
    if request.configuration.debugger_mode != "jdi"
        || structured_debugger::launch_home(&selected_jdk(&request.configuration.jdk_home)?).is_none()
    {
        return Err(
            "Debugging tests requires structured JDI and a full JDK 17 or later to host the debugger."
                .into(),
        );
    }
    Ok(())
}

/// Reuse the completed test session's toolchain and test configuration.
pub(super) fn failed_request(
    original: &super::Request,
    results: &super::TestResults,
    manual_project: bool,
) -> Result<(super::Request, Vec<String>, Option<super::maven_test_forks::RerunProjects>), String> {
    let selections = results.failed_selections()?;
    if selections.is_empty() {
        return Err("A complete fresh report with failing tests is required for debugging.".into());
    }
    let operation = match original.operation.as_str() {
        "test" | "coverage" => "debug-test",
        "integration-test" | "integration-coverage" => "debug-integration-test",
        _ => {
            return Err(
                "Debug failed tests requires a completed ordinary test or coverage session.".into(),
            )
        }
    };
    let mut request = original.clone();
    request.operation = operation.into();
    request.configuration.debugger_mode = "jdi".into();
    request.source_breakpoints.clear();
    let projects = if manual_project {
        results.maven_failed_debug_projects(&selections)?
    } else {
        None
    };
    validate(&request, &selections)?;
    Ok((request, selections, projects))
}

/// Does not turn a startup or transport failure into a user cancellation.
pub(super) fn terminate_children(job: &super::Job) {
    use std::time::{Duration, Instant};
    if let Ok(mut current) = job.child.lock() {
        if let Some(child) = current.as_mut() {
            child.stdin.take();
            #[cfg(unix)]
            if child.try_wait().ok().flatten().is_none() {
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
            }
            let deadline = Instant::now() + Duration::from_secs(1);
            while child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            super::kill_owned_process(child);
        }
    }
    if let Ok(mut current) = job.test_tool_child.lock() {
        if let Some(child) = current.as_mut() {
            super::kill_owned_process(child);
        }
    }
}

pub(super) fn execute(
    job: &std::sync::Arc<super::Job>,
    mut test: Invocation,
) -> Result<i32, String> {
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};
    let listening = listener_invocation(&test.directory, &job.request.configuration)?;
    let worker = job.clone();
    let helper = std::thread::spawn(move || super::execute(&worker, listening));
    let result = (|| {
        let deadline = Instant::now() + Duration::from_secs(30);
        let port = loop {
            if job.cancelled.load(Ordering::SeqCst)
                || !super::current_workspace_binding_is_current(&job.binding)
            {
                return Err(
                    "Test debugging was stopped before the listener became ready.".to_string(),
                );
            }
            if let Some(port) = *job
                .test_listener_port
                .lock()
                .map_err(|_| "Test debugger listener is unavailable.")?
            {
                break port;
            }
            if helper.is_finished() || Instant::now() > deadline {
                return Err("The owned test debugger listener did not become ready.".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let project_module = (job.request.configuration.build_tool == "gradle"
            && job.project_context.is_some())
            .then(|| super::execution_root(&job.binding.canonical_root, &job.request.configuration.project_path))
            .transpose()?;
        configure_test_invocation(
            &mut test,
            &job.request.configuration.build_tool,
            test_operation(&job.request.operation) == "integration-test",
            port,
            project_module.as_deref(),
        )?;
        super::execute_in_slot(job, test, true)
    })();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !helper.is_finished() && Instant::now() < deadline && matches!(result, Ok(0)) {
        std::thread::sleep(Duration::from_millis(10));
    }
    if !helper.is_finished() || !matches!(result, Ok(0)) {
        terminate_children(job);
    }
    let debugged = helper
        .join()
        .map_err(|_| "The test debugger worker failed.")?;
    let code = result?;
    if job.cancelled.load(Ordering::SeqCst) {
        return Ok(code);
    }
    let helper_code = debugged?;
    if code == 0 && helper_code != 0 {
        return Err("The test debugger failed before completing its runtime session.".into());
    }
    Ok(code)
}
