//! Literal launch settings. Build-tool argument parsing never invokes a shell.
use super::{executable_name, Configuration, Invocation};
use base64::Engine;
use std::collections::BTreeSet;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub(super) struct LaunchFile {
    directory: PathBuf,
    owns_directory_contents: bool,
    pub path: PathBuf,
    pub test_jvm_marker: Option<String>,
    pub application_directory: Option<PathBuf>,
}
impl LaunchFile {
    pub(super) fn create(name: &str, contents: &[u8]) -> Result<Self, String> {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random)
            .map_err(|_| "Cannot allocate private Java launch settings.")?;
        let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let directory = std::env::temp_dir()
            .canonicalize()
            .map_err(|_| "Java launch temporary storage is unavailable.")?
            .join(format!("ide-java-launch-{token}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|_| "Cannot create private Java launch storage.")?;
        let owned = Self {
            path: directory.join(name),
            directory,
            owns_directory_contents: false,
            test_jvm_marker: None,
            application_directory: None,
        };
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&owned.path)
            .map_err(|_| "Cannot create private Java launch settings.")?;
        file.write_all(contents)
            .map_err(|_| "Cannot write private Java launch settings.")?;
        Ok(owned)
    }
    #[cfg(unix)]
    pub(super) fn managed_directory(&mut self) -> &Path {
        self.owns_directory_contents = true;
        &self.directory
    }

    pub fn argument_reference(&self) -> Result<String, String> {
        Ok(format!(
            "@{}",
            self.path
                .to_str()
                .ok_or("Java launch storage must have a UTF-8 path.")?
        ))
    }
}
impl Drop for LaunchFile {
    fn drop(&mut self) {
        if self.owns_directory_contents {
            let _ = fs::remove_dir_all(&self.directory);
        } else {
            let _ = fs::remove_file(&self.path);
            let _ = fs::remove_dir(&self.directory);
        }
    }
}

pub(super) fn java_argument_file(
    jvm_options: &[String],
    main: &str,
    values: &[String],
    classpath: Option<&str>,
) -> Result<LaunchFile, String> {
    argument_file(&java_arguments(jvm_options, main, values, classpath))
}

pub(super) fn java_arguments(
    jvm_options: &[String],
    main: &str,
    values: &[String],
    classpath: Option<&str>,
) -> Vec<String> {
    let mut arguments = jvm_options.to_vec();
    if let Some(classpath) = classpath {
        arguments.extend(["-classpath".to_owned(), classpath.to_owned()]);
    }
    arguments.push(main.to_owned());
    arguments.extend(values.iter().cloned());
    arguments
}

pub(super) fn java_test_arguments(
    home: &Path,
    jvm_options: &[String],
    main: &str,
    values: &[String],
    classpath: &str,
) -> Result<(Vec<String>, Option<LaunchFile>), String> {
    let arguments = java_arguments(jvm_options, main, values, Some(classpath));
    if java8_launcher(home) {
        return Ok((arguments, None));
    }
    let file = argument_file(&arguments)?;
    Ok((vec![file.argument_reference()?], Some(file)))
}

pub(super) fn java8_launcher(home: &Path) -> bool {
    java_launcher_major(home) == Some(8)
}

fn java_release_metadata(home: &Path) -> Option<String> {
    let file = fs::File::open(home.join("release")).ok()?;
    let mut release = String::new();
    if file.take(16_385).read_to_string(&mut release).is_err() || release.len() > 16_384 {
        return None;
    }
    Some(release)
}

fn java_release_major(release: &str) -> Option<u16> {
    let version = release.lines().find_map(|line| line.strip_prefix("JAVA_VERSION="))?.trim_matches('"');
    version.strip_prefix("1.").unwrap_or(version).split(['.', '_', '-', '+']).next()?.parse().ok()
}

pub(super) fn java_launcher_major(home: &Path) -> Option<u16> {
    java_release_major(&java_release_metadata(home)?)
}

pub(super) fn java_runtime_has_module(home: &Path, module: &str, minimum_major: u16) -> bool {
    let Some(release) = java_release_metadata(home) else {
        return false;
    };
    if !java_release_major(&release).is_some_and(|major| major >= minimum_major) {
        return false;
    }
    match release.lines().find_map(|line| line.strip_prefix("MODULES=")) {
        Some(modules) => home.join("lib/modules").is_file()
            && modules.strip_prefix('"').and_then(|list| list.strip_suffix('"'))
                .is_some_and(|list| list.split_ascii_whitespace().any(|candidate| candidate == module)),
        None => home.join("jmods").join(format!("{module}.jmod")).is_file(),
    }
}

pub(super) fn java_module_argument_file(
    jvm_options: &[String],
    module_path: &str,
    module_name: &str,
    main: &str,
    values: &[String],
) -> Result<LaunchFile, String> {
    argument_file(&java_module_arguments(jvm_options, module_path, module_name, main, values)?)
}

pub(super) fn java_module_arguments(
    jvm_options: &[String],
    module_path: &str,
    module_name: &str,
    main: &str,
    values: &[String],
) -> Result<Vec<String>, String> {
    if !super::main_class(module_name) || !super::main_class(main) {
        return Err("The synchronized Java module launch identity is invalid.".into());
    }
    let mut arguments = jvm_options.to_vec();
    arguments.extend(["--module-path".to_owned(), module_path.to_owned()]);
    arguments.extend(["-m".to_owned(), format!("{module_name}/{main}")]);
    arguments.extend(values.iter().cloned());
    Ok(arguments)
}

pub(super) fn direct_java_launch(java: &Path, arguments: &[String]) -> Result<LaunchFile, String> {
    let java = java.to_str().ok_or("Java executable paths must be UTF-8.")?;
    let content = std::iter::once(java)
        .chain(arguments.iter().map(String::as_str))
        .map(|value| base64::engine::general_purpose::STANDARD.encode(value))
        .collect::<Vec<_>>()
        .join("\n");
    LaunchFile::create("java-arguments.txt", format!("{content}\n").as_bytes())
}

pub(super) fn maven_java_launch(
    directory: &Path,
    home: &Path,
    main: &str,
    options: &[String],
    arguments: &[String],
    extra_classpath: Option<&Path>,
    selected_maven_test_output: bool,
) -> Result<(Invocation, LaunchFile, LaunchFile, String), String> {
    let (compile, class) = compile_private_launcher(
        directory, home, "IdeMavenJavaLauncher",
        include_bytes!("IdeMavenJavaLauncher.java"),
    )?;
    let classes = class.directory.to_str().ok_or("Maven launch storage must be UTF-8.")?;
    let extra_classpath = extra_classpath.unwrap_or(Path::new(""))
        .to_str().ok_or("Maven launch classpath must be UTF-8.")?;
    let mut values = vec![main.into(), extra_classpath.into(), options.len().to_string()];
    values.extend_from_slice(options);
    values.extend_from_slice(arguments);
    let launch = direct_java_launch(&home.join("bin").join(executable_name("java")), &values)?;
    let launch_path = launch.path.to_str().ok_or("Maven launch storage must be UTF-8.")?;
    let mut exec_arguments = build_tool_arguments(&[
        "-classpath".into(),
        classes.into(),
        "IdeMavenJavaLauncher".into(),
        launch_path.into(),
        "%classpath".into(),
    ]);
    if selected_maven_test_output {
        // Maven evaluates this against the selected effective POM before exec parses the arguments.
        exec_arguments.push_str(r#" "${project.build.testOutputDirectory}""#);
    }
    Ok((compile, class, launch, exec_arguments))
}

fn compile_private_launcher(
    directory: &Path,
    home: &Path,
    name: &str,
    contents: &[u8],
) -> Result<(Invocation, LaunchFile), String> {
    let source = LaunchFile::create(&format!("{name}.java"), contents)?;
    let class = LaunchFile::create(&format!("{name}.class"), b"")?;
    let classes = class.directory.to_str().ok_or("Java launch storage must be UTF-8.")?;
    let source_path = source.path.to_str().ok_or("Java launch storage must be UTF-8.")?;
    let compile = Invocation {
        directory: directory.to_path_buf(),
        executable: home.join("bin").join(executable_name("javac")),
        arguments: [
            "-encoding", "UTF-8", "-proc:none", "-classpath", classes,
            "-sourcepath", classes, "-d", classes, source_path,
        ].into_iter().map(str::to_owned).collect(),
        interactive: false,
        java_home: home.to_path_buf(),
        launch_file: None,
        discovery: None,
        coverage: None,
        auxiliary_files: vec![source],
        profile_path: None,
        test_report_path: None,
    };
    Ok((compile, class))
}

pub(super) fn java8_console_debugger(
    directory: PathBuf,
    home: PathBuf,
    classpath: &str,
    config: &Configuration,
) -> Result<Vec<Invocation>, String> {
    if !cfg!(unix) {
        return Err("Java 8 console debugging requires Unix process ownership.".into());
    }
    let java = home.join("bin").join(executable_name("java"));
    let jdb = home.join("bin").join(executable_name("jdb"));
    if !jdb.is_file() {
        return Err("The selected JDK debugger (jdb) is unavailable.".into());
    }
    let debuggee = java_arguments(
        &config.jvm_options, &config.main_class, &config.program_arguments, Some(classpath),
    );
    let launch = direct_java_launch(&java, &debuggee)?;
    let (compile, class) = compile_private_launcher(
        &directory, &home, "IdeJdbLauncher", include_bytes!("IdeJdbLauncher.java"),
    )?;
    let debugger = Invocation {
        directory,
        executable: java,
        arguments: [
            "-classpath",
            class.directory.to_str().ok_or("Debugger paths must be UTF-8.")?,
            "IdeJdbLauncher",
            jdb.to_str().ok_or("Debugger paths must be UTF-8.")?,
            launch.path.to_str().ok_or("Debugger paths must be UTF-8.")?,
        ].into_iter().map(str::to_owned).collect(),
        interactive: true,
        java_home: home,
        launch_file: Some(launch),
        discovery: None,
        coverage: None,
        auxiliary_files: vec![class],
        profile_path: None,
        test_report_path: None,
    };
    Ok(vec![compile, debugger])
}

fn argument_file(arguments: &[String]) -> Result<LaunchFile, String> {
    LaunchFile::create("launch.args", argument_file_contents(arguments).as_bytes())
}

pub(super) fn argument_file_contents(arguments: &[String]) -> String {
    arguments
        .iter()
        .map(|value| {
            let escaped = value
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "\\r")
                .replace('\t', "\\t")
                .replace('\u{000c}', "\\f");
            format!("\"{escaped}\"\n")
        })
        .collect()
}

pub(super) fn maven_test_argument_file(options: &[String]) -> Result<LaunchFile, String> {
    let (marker, arguments) = marked_test_jvm_options(options)?;
    let mut file = argument_file(&arguments)?;
    file.test_jvm_marker = Some(marker);
    Ok(file)
}

pub(super) fn marked_test_jvm_options(options: &[String]) -> Result<(String, Vec<String>), String> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Cannot identify test JVM settings.")?;
    let marker: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut arguments = options.to_vec();
    arguments.push(format!("-Dide.test.jvm.options={marker}"));
    Ok((marker, arguments))
}

pub(super) fn argument_file_reported_as_main_class(output: &str, reference: &str) -> bool {
    // Some Java launchers render path separators as dots in the class name.
    let dotted_reference = reference.replace(['/', '\\'], ".");
    output.lines().any(|line| {
        line.trim()
            .trim_start_matches("[ERROR] ")
            .strip_prefix("Error: Could not find or load main class ")
            .is_some_and(|class| class == reference || class == dotted_reference)
    })
}
pub(super) fn maven_testng_suite_file(selections: &[String]) -> Result<LaunchFile, String> {
    let mut classes = std::collections::BTreeMap::<String, BTreeSet<String>>::new();
    for selection in selections {
        let (class, method) = selection
            .split_once('#')
            .map_or((selection.as_str(), None), |(class, method)| {
                (class, Some(method))
            });
        if !super::main_class(class)
            || method.is_some_and(|name| !super::main_class(name) || name.contains('.'))
        {
            return Err("Invalid TestNG class or method selection.".into());
        }
        classes
            .entry(class.to_owned())
            .or_default()
            .insert(method.unwrap_or_default().to_owned());
    }
    if classes.is_empty() {
        return Err("Choose a TestNG class or method before running its suite.".into());
    }
    let mut xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<suite name=\"IDE selected tests\" verbose=\"0\"><test name=\"IDE selection\"><classes>".to_owned();
    for (class, methods) in classes {
        xml.push_str(&format!("<class name=\"{class}\">"));
        if !methods.contains("") {
            xml.push_str("<methods>");
            for method in methods {
                // The validated Java identifier contains no regex operators
                // other than '$'. TestNG also escapes dollars in its public
                // XML selectors, so an explicit escape preserves literal names.
                let literal = method.replace('$', "\\$");
                xml.push_str(&format!("<include name=\"{literal}\"/>"));
            }
            xml.push_str("</methods>");
        }
        xml.push_str("</class>");
    }
    xml.push_str("</classes></test></suite>\n");
    LaunchFile::create("testng-suite.xml", xml.as_bytes())
}

pub(super) fn gradle_test_argument_file(
    project: &Path,
    options: &[String],
    build_root: Option<&Path>,
) -> Result<LaunchFile, String> {
    let data = serde_json::to_vec(&serde_json::json!({"projectPath":project.to_str().ok_or("Java project paths must be UTF-8.")?,"buildRoot":build_root,"options":options})).map_err(|_| "Cannot encode Gradle test settings.")?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    let script = format!(
        r#"def ideTests = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{encoded}'), 'UTF-8'))
gradle.projectsEvaluated {{
    if (ideTests.buildRoot != null && gradle.rootProject.projectDir.canonicalPath != ideTests.buildRoot) return
    def selected = gradle.rootProject.allprojects.find {{ it.projectDir.canonicalPath == ideTests.projectPath }}
    if (selected == null && gradle.parent != null && ideTests.buildRoot == null) return
    if (selected == null) throw new org.gradle.api.GradleException('The selected test project was not found.')
    selected.tasks.named('test', org.gradle.api.tasks.testing.Test).configure {{
        jvmArgs(ideTests.options)
    }}
}}
"#
    );
    LaunchFile::create("test.init.gradle", script.as_bytes())
}

pub(super) fn gradle_argument_file(
    project: &Path,
    values: &[String],
    jvm_options: &[String],
    working_directory: Option<(&Path, &Path)>,
) -> Result<LaunchFile, String> {
    let data = serde_json::to_vec(&serde_json::json!({"projectPath":project.to_str().ok_or("Java project paths must be UTF-8.")?,"arguments":values,"jvmOptions":jvm_options,"workingDirectory":working_directory.map(|(path, _)| path.to_str().ok_or("Application working directory must be UTF-8.")).transpose()?,"workingDirectorySelection":working_directory.map(|(_, selection)| selection.to_str().ok_or("Application directory selection must be UTF-8.")).transpose()?})).map_err(|_| "Cannot encode Gradle launch settings.")?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(data);
    let script = format!(
        r#"def ideLaunch = new groovy.json.JsonSlurper().parseText(new String(java.util.Base64.getDecoder().decode('{encoded}'), 'UTF-8'))
gradle.projectsEvaluated {{
    def selected = gradle.rootProject.allprojects.find {{ it.projectDir.canonicalPath == ideLaunch.projectPath }}
    if (selected == null && gradle.parent != null) return
    if (selected == null) throw new org.gradle.api.GradleException('The selected application project was not found.')
    selected.tasks.named('run', org.gradle.api.tasks.JavaExec).configure {{
        if (ideLaunch.workingDirectory != null) {{
            setWorkingDir(new File(ideLaunch.workingDirectory))
            doFirst {{
                if (!getWorkingDir().isDirectory() || getWorkingDir().canonicalPath != ideLaunch.workingDirectory ||
                    new File(ideLaunch.workingDirectorySelection).canonicalPath != ideLaunch.workingDirectory)
                    throw new org.gradle.api.GradleException('The application working directory changed before launch.')
            }}
        }}
        if (!ideLaunch.arguments.isEmpty()) setArgs(ideLaunch.arguments)
        if (!ideLaunch.jvmOptions.isEmpty()) {{
            def combined = new ArrayList(getJvmArguments().getOrElse([]))
            combined.addAll(ideLaunch.jvmOptions)
            getJvmArguments().set(combined)
        }}
    }}
}}
"#
    );
    let mut file = LaunchFile::create("launch.init.gradle", script.as_bytes())?;
    file.application_directory = working_directory.map(|(path, _)| path.to_path_buf());
    Ok(file)
}

pub(super) fn validate_settings(config: &Configuration, operation: &str) -> Result<(), String> {
    if !["jdb", "jdi"].contains(&config.debugger_mode.as_str()) {
        return Err("Choose an available Java debugger mode.".into());
    }
    if let Some(target) = &config.debugger_attach {
        if target.host.len() > 255
            || target.port.len() > 5
            || target.host.contains('\0')
            || target.port.contains('\0')
        {
            return Err("JDWP connection settings exceed their text limits.".into());
        }
    }
    if operation == "attach" {
        super::attach::validate(&config.debugger_attach.clone().unwrap_or_default())?;
    }
    if serde_json::to_vec(config).map_or(true, |bytes| bytes.len() > 128 * 1024) {
        return Err("Launch settings exceed the 128 KiB configuration limit.".into());
    }
    if config.working_directory.len() > 4096 || config.working_directory.contains('\0') {
        return Err("Application working directory exceeds its text limit.".into());
    }
    if ["run", "debug"].contains(&operation) && !config.working_directory.is_empty() {
        let value = config.working_directory.as_str();
        if value.contains(['\\', ':', '\n', '\r', '\t'])
            || value.chars().any(char::is_control)
            || Path::new(value).is_absolute()
            || (value != "."
                && value
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == ".."))
        {
            return Err("Use a workspace-relative application working directory.".into());
        }
    }
    if config.program_arguments.len() > 128
        || config
            .program_arguments
            .iter()
            .any(|value| value.len() > 4096 || value.contains('\0'))
        || config
            .program_arguments
            .iter()
            .map(String::len)
            .sum::<usize>()
            > 16 * 1024
    {
        return Err("Application arguments exceed their count, size or text limits.".into());
    }
    if config.environment.len() > 64 {
        return Err("Too many environment variables (limit 64).".into());
    }
    for (options, active, name) in [
        (
            &config.jvm_options,
            operation == "run" || operation == "debug",
            "Application",
        ),
        (
            &config.test_jvm_options,
            [
                "test",
                "integration-test",
                "integration-coverage",
                "coverage",
                "discover",
            ]
            .contains(&operation),
            "Test",
        ),
    ] {
        if options.len() > 128
            || options
                .iter()
                .any(|value| value.len() > 4096 || value.contains('\0'))
            || options.iter().map(String::len).sum::<usize>() > 16 * 1024
        {
            return Err(format!(
                "{name} JVM options exceed their count, size or text limits."
            ));
        }
        for option in options.iter().filter(|_| active) {
            if !option.starts_with('-') || option == "-" {
                return Err("Use one JVM option per row, with --option=value for values. Empty rows are incomplete settings.".into());
            }
            let flag = option.split('=').next().unwrap_or_default();
            if [
                "-cp",
                "-classpath",
                "--class-path",
                "-jar",
                "-m",
                "--module",
                "-p",
                "--module-path",
                "--source",
                "--",
            ]
            .contains(&flag)
            {
                return Err(
                    "Use the main class and classpath controls instead of JVM launcher selectors."
                        .into(),
                );
            }
            if name == "Test" && flag == "-Dide.test.jvm.options" {
                return Err(
                    "The ide.test.jvm.options property is reserved for test JVM verification."
                        .into(),
                );
            }
        }
    }
    let mut names = BTreeSet::new();
    let mut bytes = 0;
    for variable in &config.environment {
        let name = &variable.name;
        let mut characters = name.chars();
        if name.len() > 128
            || !characters
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            || !characters.all(|c| c.is_ascii_alphanumeric() || c == '_')
            || variable.value.len() > 4096
            || variable.value.contains('\0')
        {
            return Err(
                "Use valid environment names and bounded values without NUL characters.".into(),
            );
        }
        let key = if cfg!(windows) {
            name.to_ascii_uppercase()
        } else {
            name.clone()
        };
        if !names.insert(key) {
            return Err("Environment variable names must be unique.".into());
        }
        if name.eq_ignore_ascii_case("JAVA_HOME") || name.eq_ignore_ascii_case("IDE_JAVA_HOME") {
            return Err(
                "Choose the JDK directory instead of overriding JAVA_HOME or IDE_JAVA_HOME.".into(),
            );
        }
        bytes += name.len() + variable.value.len();
    }
    if bytes > 32 * 1024 {
        return Err("Environment overrides exceed the 32 KiB limit.".into());
    }
    Ok(())
}

/// Quotes bounded infrastructure arguments for Maven's exec plugin. Application arguments
/// use Java argument files instead because Plexus discards quoted empty strings.
pub(super) fn build_tool_arguments(values: &[String]) -> String {
    values
        .iter()
        .map(|value| format!("'{}'", value.replace('\'', "'\"'\"'")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::java_execution::EnvironmentVariable;
    fn config() -> Configuration {
        serde_json::from_value(
            serde_json::json!({"buildTool":"jdk","mainClass":"Main","classPath":[]}),
        )
        .unwrap()
    }
    #[test]
    fn launch_files_are_private_and_removed_on_drop() {
        let file =
            java_argument_file(&[], "Main", &["".into(), "both'\"quotes".into()], None).unwrap();
        let path = file.path.clone();
        let directory = path.parent().unwrap().to_owned();
        assert!(fs::read_to_string(&path).unwrap().contains("\"\"\n"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        drop(file);
        assert!(!path.exists());
        assert!(!directory.exists());
    }
    #[test]
    fn named_module_argument_file_uses_provider_selection_and_preserves_program_arguments() {
        let file = java_module_argument_file(
            &["-Dmode=local".into()],
            "/workspace/app/out:/cache/dependency.jar",
            "example.app",
            "example.app.Main",
            &["two words".into(), "".into()],
        )
        .unwrap();
        let contents = fs::read_to_string(&file.path).unwrap();
        assert_eq!(
            contents,
            "\"-Dmode=local\"\n\"--module-path\"\n\"/workspace/app/out:/cache/dependency.jar\"\n\"-m\"\n\"example.app/example.app.Main\"\n\"two words\"\n\"\"\n"
        );
        assert!(java_module_argument_file(&[], "/path", "--module", "Main", &[]).is_err());
        assert!(java_module_argument_file(&[], "", "example.app", "-m", &[]).is_err());
    }

    #[test]
    fn rejects_jvm_launcher_selectors_and_unbounded_options() {
        for option in [
            "",
            "Main",
            "@file",
            "-",
            "-cp",
            "--class-path=outside",
            "-jar",
            "--module=other",
            "-p",
            "--module-path=/outside",
            "--source=21",
            "--",
        ] {
            let mut config = config();
            config.jvm_options = vec![option.into()];
            assert!(validate_settings(&config, "run").is_err(), "{option:?}");
            assert!(validate_settings(&config, "debug").is_err(), "{option:?}");
            assert!(validate_settings(&config, "build").is_ok(), "{option:?}");
            assert!(validate_settings(&config, "test").is_ok(), "{option:?}");
        }
        for options in [
            vec!["-ea".into(); 129],
            vec!["-Dvalue=".to_owned() + &"x".repeat(4096)],
            vec!["bad\0".into()],
            vec!["-Dvalue=".to_owned() + &"x".repeat(4096 - 8); 5],
        ] {
            let mut config = config();
            config.jvm_options = options;
            assert!(validate_settings(&config, "run").is_err());
        }
        let mut config = config();
        config.jvm_options = vec![
            "-Xmx96m".into(),
            "-Dempty=".into(),
            "-Dnote=both'\"quotes\n😀".into(),
            "--add-opens=java.base/java.lang=ALL-UNNAMED".into(),
        ];
        assert!(validate_settings(&config, "run").is_ok());
    }
    #[test]
    fn test_jvm_options_are_bounded_and_only_test_consumes_their_syntax() {
        let mut config = config();
        for option in ["", "-jar", "-Dide.test.jvm.options=spoof"] {
            config.test_jvm_options = vec![option.into()];
            assert!(validate_settings(&config, "test").is_err());
            assert!(validate_settings(&config, "integration-test").is_err());
            assert!(validate_settings(&config, "coverage").is_err());
            for operation in ["build", "run", "debug"] {
                assert!(validate_settings(&config, operation).is_ok());
            }
        }
        for values in [
            vec!["bad\0".into()],
            vec!["-ea".into(); 129],
            vec!["x".repeat(4097)],
            vec!["x".repeat(4096); 5],
        ] {
            config.test_jvm_options = values;
            for operation in ["build", "run", "test", "integration-test", "debug"] {
                assert!(validate_settings(&config, operation).is_err());
            }
        }
        config.test_jvm_options = vec!["-Xmx96m".into(), "-Dliteral=both'\"quotes\n😀".into()];
        let file = maven_test_argument_file(&config.test_jvm_options).unwrap();
        assert!(file
            .test_jvm_marker
            .as_ref()
            .is_some_and(|marker| marker.len() == 32));
        let contents = fs::read_to_string(&file.path).unwrap();
        assert!(contents.contains("-Dide.test.jvm.options="));
        assert!(contents.contains("\\n😀"));
        assert_eq!(config.jvm_options.len(), 0);
    }
    #[test]
    fn refuses_invalid_or_duplicate_environment_names_and_unbounded_arguments() {
        for name in ["", "A=B", "1VALUE", "A\0B", "JAVA_HOME", "ide_java_home"] {
            let mut config = config();
            config.environment.push(EnvironmentVariable {
                name: name.into(),
                value: "value".into(),
            });
            assert!(validate_settings(&config, "run").is_err(), "{name:?}");
        }
        let mut config = config();
        config.environment = vec![
            EnvironmentVariable {
                name: "MODE".into(),
                value: "one".into(),
            },
            EnvironmentVariable {
                name: "MODE".into(),
                value: "two".into(),
            },
        ];
        assert!(validate_settings(&config, "run").is_err());
        config.environment.clear();
        for values in [
            vec!["".into(); 129],
            vec!["x".repeat(4097)],
            vec!["bad\0value".into()],
            vec!["x".repeat(4096); 5],
        ] {
            config.program_arguments = values;
            assert!(validate_settings(&config, "run").is_err());
        }
        config.program_arguments = vec![
            "".into(),
            "space value".into(),
            "both'\" quotes \\ 😀".into(),
        ];
        config.environment.push(EnvironmentVariable {
            name: "EMPTY".into(),
            value: "".into(),
        });
        assert!(validate_settings(&config, "run").is_ok());
    }
}
