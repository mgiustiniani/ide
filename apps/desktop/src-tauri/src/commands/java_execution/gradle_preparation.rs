//! Warm the selected Gradle cache through an explicit, trusted build-tool session.
use super::{
    execution_root, project_execution::gradle_project_sdk_argument, selected_jdk, Invocation,
    LaunchFile, Request,
};
use std::path::Path;

const INIT_SCRIPT: &str = r#"
import org.gradle.api.tasks.SourceSetContainer

gradle.projectsEvaluated {
    def root = gradle.rootProject
    def taskName = '__IDE_PREPARE_TASK__'
    if (root.tasks.names.contains(taskName)) {
        throw new GradleException('Gradle preparation task already exists.')
    }
    root.tasks.register(taskName) {
        // Each build exposes its own includes, even when task paths are flattened.
        // Share the discovery set from the command's root to avoid adding cycles
        // or scheduling a shared build twice.
        def buildTree = gradle
        while (buildTree.parent != null) buildTree = buildTree.parent
        def extras = buildTree.rootProject.extensions.extraProperties
        def discoveryKey = taskName + 'IncludedBuilds'
        def includedTasks
        synchronized (extras) {
            if (!extras.has(discoveryKey)) extras.set(discoveryKey, new HashSet<File>())
            def discovered = extras.get(discoveryKey)
            discovered.add(root.projectDir.canonicalFile)
            includedTasks = gradle.includedBuilds.findAll { included ->
                discovered.add(included.projectDir.canonicalFile)
            }.collect { included -> included.task(":${taskName}") }
        }
        dependsOn(includedTasks)
        doLast {
            root.allprojects.each { project ->
                def sourceSets = project.extensions.findByType(SourceSetContainer)
                sourceSets?.each { sourceSet ->
                    [
                        sourceSet.compileClasspathConfigurationName,
                        sourceSet.runtimeClasspathConfigurationName,
                        sourceSet.annotationProcessorConfigurationName
                    ].unique().each { name ->
                        def configuration = project.configurations.getByName(name)
                        if (configuration.canBeResolved) {
                            logger.lifecycle("Preparing ${project.displayName} ${name}")
                            // Resolving artifacts populates the cache, unlike a dependency report.
                            configuration.incoming.files.files
                        }
                    }
                }
            }
        }
    }
}
"#;

pub(super) fn plan(workspace: &Path, request: &Request) -> Result<Invocation, String> {
    let config = &request.configuration;
    let settings = request
        .gradle_preparation
        .as_ref()
        .filter(|settings| settings.valid())
        .ok_or("Choose a Gradle executable and valid settings in Java Project.")?;
    if config.build_tool != "gradle" || config.jdk_home.is_empty() || !config.environment.is_empty()
    {
        return Err(
            "Gradle preparation requires the project JDK and Gradle settings from Java Project."
                .into(),
        );
    }
    let directory = execution_root(workspace, &config.project_path)?;
    if ![
        "settings.gradle",
        "settings.gradle.kts",
        "build.gradle",
        "build.gradle.kts",
    ]
    .iter()
    .any(|name| directory.join(name).is_file())
    {
        return Err("Choose a Gradle project directory in Java Project.".into());
    }
    let executable = Path::new(&settings.executable)
        .canonicalize()
        .map_err(|_| "The selected Gradle executable is unavailable.")?;
    if !executable.is_file() {
        return Err("Select an existing Gradle executable.".into());
    }
    let sdk = selected_jdk(&config.jdk_home)?;
    let java_home = match settings
        .gradle_runtime_home
        .as_deref()
        .filter(|home| !home.is_empty())
    {
        Some(home) => selected_jdk(home)?,
        None => sdk.clone(),
    };
    let mut arguments = vec![
        "--no-daemon".into(),
        "--console=plain".into(),
        "--no-configuration-cache".into(),
    ];
    arguments.extend(gradle_project_sdk_argument(&java_home, &sdk)?);
    if !settings.user_home.is_empty() {
        arguments.extend(["--gradle-user-home".into(), settings.user_home.clone()]);
    }
    arguments.extend(
        settings
            .project_properties
            .iter()
            .map(|(name, value)| format!("-P{name}={value}")),
    );
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Cannot allocate a Gradle preparation task.")?;
    let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let task = format!("idePrepareJavaDependencies{token}");
    let script = INIT_SCRIPT.replace("__IDE_PREPARE_TASK__", &task);
    let launch_file = LaunchFile::create("prepare.init.gradle", script.as_bytes())?;
    arguments.extend([
        "--init-script".into(),
        launch_file
            .path
            .to_str()
            .ok_or("Gradle launch storage must have a UTF-8 path.")?
            .into(),
        format!(":{task}"),
    ]);
    Ok(Invocation {
        directory,
        executable,
        arguments,
        interactive: false,
        java_home,
        launch_file: Some(launch_file),
        discovery: None,
        coverage: None,
        auxiliary_files: Vec::new(),
        profile_path: None,
        test_report_path: None,
    })
}
