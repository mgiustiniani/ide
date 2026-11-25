//! Create explicit user settings for RefactorKit; this does not discover or execute a project.
use crate::commands::workspace_registry::{current_workspace_binding_at, with_root_activation};
use crate::{app_config::workspace_registry_path, workspace::workspace_root};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, io::Write, path::Path};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_path: String,
    sdk_home: String,
    release: u64,
    source_roots: Vec<String>,
    #[serde(default)]
    generated_source_roots: Vec<String>,
    compile_classpath: Vec<String>,
    runtime_classpath: Vec<String>,
    output_directory: String,
    test_source_set: Option<TestSourceSet>,
    #[serde(default)]
    additional_modules: Vec<AdditionalModule>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TestSourceSet {
    id: String,
    source_roots: Vec<String>,
    #[serde(default)]
    generated_source_roots: Vec<String>,
    compile_classpath: Vec<String>,
    runtime_classpath: Vec<String>,
    output_directory: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdditionalModule {
    id: String,
    root: String,
    release: u64,
    source_roots: Vec<String>,
    #[serde(default)]
    generated_source_roots: Vec<String>,
    compile_classpath: Vec<String>,
    runtime_classpath: Vec<String>,
    output_directory: String,
    test_source_set: Option<TestSourceSet>,
}
// A borrowed view of user configuration, used only for validation and serialization.
struct DeclarationModule<'a> {
    id: &'a str,
    root: &'a str,
    release: u64,
    source_roots: &'a [String],
    generated_source_roots: &'a [String],
    compile_classpath: &'a [String],
    runtime_classpath: &'a [String],
    output_directory: &'a str,
    test_source_set: Option<&'a TestSourceSet>,
}
impl Request {
    fn modules(&self) -> Vec<DeclarationModule<'_>> {
        let mut modules = vec![DeclarationModule {
            id: "app",
            root: ".",
            release: self.release,
            source_roots: &self.source_roots,
            generated_source_roots: &self.generated_source_roots,
            compile_classpath: &self.compile_classpath,
            runtime_classpath: &self.runtime_classpath,
            output_directory: &self.output_directory,
            test_source_set: self.test_source_set.as_ref(),
        }];
        modules.extend(self.additional_modules.iter().map(|m| DeclarationModule {
            id: &m.id,
            root: &m.root,
            release: m.release,
            source_roots: &m.source_roots,
            generated_source_roots: &m.generated_source_roots,
            compile_classpath: &m.compile_classpath,
            runtime_classpath: &m.runtime_classpath,
            output_directory: &m.output_directory,
            test_source_set: m.test_source_set.as_ref(),
        }));
        modules
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    workspace_id: String,
    generation: u64,
    request_id: String,
    path: String,
}
fn relative(value: &str, root: bool) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && !value.contains(['\0', '\\', ':'])
        && !value.starts_with('/')
        && ((root && value == ".")
            || value
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."))
}
fn validate(request: &Request) -> Result<(), String> {
    if request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.request_id.contains('\0')
        || request.generation == 0
        || request.generation > 9_007_199_254_740_991
        || (!request.project_path.is_empty() && !relative(&request.project_path, false))
    {
        return Err("Invalid explicit Java project configuration.".into());
    }
    if request.additional_modules.len() > 63 {
        return Err("A Java declaration supports at most 64 modules.".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut outputs = std::collections::HashSet::new();
    let modules = request.modules();
    let root_count: usize = modules
        .iter()
        .map(|m| m.source_roots.len() + m.test_source_set.map_or(0, |t| t.source_roots.len()))
        .sum();
    if root_count > 1024 {
        return Err("Too many declared Java source directories.".into());
    }
    for module in &modules {
        if module.id.is_empty()
            || module.id.len() > 128
            || !module
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            || !ids.insert(module.id)
            || !relative(module.root, true)
        {
            return Err("Use unique module names and project-relative module roots.".into());
        }
        validate_module(module)?;
        let contained = |p: &str| {
            module.root == "." || p == module.root || p.starts_with(&format!("{}/", module.root))
        };
        let mut source_and_output: Vec<&str> =
            module.source_roots.iter().map(String::as_str).collect();
        source_and_output.push(module.output_directory);
        if let Some(test) = module.test_source_set {
            source_and_output.extend(test.source_roots.iter().map(String::as_str));
            source_and_output.push(&test.output_directory);
        }
        if source_and_output.iter().any(|p| !contained(p)) {
            return Err(
                "Place each module's source and output directories under its module root.".into(),
            );
        }
        if !outputs.insert(module.output_directory)
            || module
                .test_source_set
                .is_some_and(|t| !outputs.insert(&t.output_directory))
        {
            return Err("Use a distinct class output directory for every source set.".into());
        }
    }
    Ok(())
}
fn validate_module(module: &DeclarationModule<'_>) -> Result<(), String> {
    if !(8..=27).contains(&module.release)
        || module.source_roots.is_empty()
        || module
            .generated_source_roots
            .iter()
            .any(|p| !module.source_roots.contains(p))
        || !relative(&module.output_directory, false)
        || [
            module.source_roots,
            module.generated_source_roots,
            module.compile_classpath,
            module.runtime_classpath,
        ]
        .iter()
        .any(|paths| paths.len() > 128 || paths.iter().any(|p| !relative(p, true)))
    {
        return Err("Invalid explicit Java project configuration.".into());
    }
    if let Some(test) = module.test_source_set {
        if test.id.is_empty()
            || test.id.len() > 128
            || test.id == "main"
            || !test
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            || test.source_roots.is_empty()
            || test
                .generated_source_roots
                .iter()
                .any(|p| !test.source_roots.contains(p))
            || !relative(&test.output_directory, false)
            || test.output_directory == module.output_directory
            || [
                &test.source_roots,
                &test.generated_source_roots,
                &test.compile_classpath,
                &test.runtime_classpath,
            ]
            .iter()
            .any(|paths| paths.len() > 128 || paths.iter().any(|p| !relative(p, true)))
        {
            return Err("Invalid explicit Java test configuration. Use a distinct source-set name and output directory.".into());
        }
    }
    Ok(())
}
fn create_at(root: &Path, request: &Request) -> Result<String, String> {
    validate(request)?;
    let mut project = root.to_path_buf();
    for part in request
        .project_path
        .split('/')
        .filter(|part| !part.is_empty())
    {
        project.push(part);
        let metadata =
            fs::symlink_metadata(&project).map_err(|_| "Choose an existing project directory.")?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("The project directory must not contain symbolic links.".into());
        }
    }
    for module in request.modules() {
        if [
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts",
        ]
        .iter()
        .any(|name| fs::symlink_metadata(project.join(module.root).join(name)).is_ok())
        {
            return Err("Use the existing Maven or Gradle project model instead of a plain Java declaration.".into());
        }
    }
    let sdk = Path::new(&request.sdk_home);
    let sdk = sdk
        .is_absolute()
        .then(|| sdk.canonicalize().ok())
        .flatten()
        .ok_or("Select an existing absolute JDK directory.")?;
    let executable = |name: &str| {
        if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        }
    };
    if !sdk.join("release").is_file()
        || ["java", "javac"]
            .iter()
            .any(|name| !sdk.join("bin").join(executable(name)).is_file())
    {
        return Err("Select a full JDK with java, javac and release metadata.".into());
    }
    let metadata = project.join(".refactorkit");
    let made_directory = match fs::create_dir(&metadata) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(error) => return Err(error.to_string()),
    };
    let result: Result<String, String> = (|| {
        let state = fs::symlink_metadata(&metadata).map_err(|error| error.to_string())?;
        if state.file_type().is_symlink() || !state.is_dir() {
            return Err("The declaration directory must be a real directory.".into());
        }
        let target = metadata.join("java-project.json");
        if fs::symlink_metadata(&target).is_ok() {
            return Err(
                "A Java project declaration already exists. Open it in the editor to change it."
                    .into(),
            );
        }
        let modules: Vec<_> = request.modules().iter().map(|module| {
            let mut source_sets = vec![json!({"id":"main","kind":"main","sourceRoots":module.source_roots,
                "generatedSourceRoots":module.generated_source_roots,"outputDirectories":[module.output_directory],
                "compileClasspath":module.compile_classpath,"runtimeClasspath":module.runtime_classpath,"release":module.release,"proc":"none"})];
            if let Some(test) = module.test_source_set {
                source_sets.push(json!({"id":test.id,"kind":"test","sourceRoots":test.source_roots,
                    "generatedSourceRoots":test.generated_source_roots,"outputDirectories":[test.output_directory],
                    "compileClasspath":test.compile_classpath,"runtimeClasspath":test.runtime_classpath,"release":module.release,"proc":"none"}));
            }
            json!({"id":module.id,"root":module.root,"sourceSets":source_sets})
        }).collect();
        let value =
            json!({"schemaVersion":"java-declared-project-v1","sdkHome":sdk,"modules":modules});
        let mut bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| "Cannot identify the declaration write.")?;
        let token = nonce
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let temporary = metadata.join(format!(".java-project-{token}.tmp"));
        let write: Result<(), String> = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| error.to_string())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| error.to_string())?;
            fs::hard_link(&temporary,&target).map_err(|error|format!("Cannot create the Java declaration without replacing an existing file: {error}"))?;
            Ok(())
        })();
        let _ = fs::remove_file(&temporary);
        write?;
        Ok(format!(
            "{}.refactorkit/java-project.json",
            if request.project_path.is_empty() {
                String::new()
            } else {
                format!("{}/", request.project_path)
            }
        ))
    })();
    if result.is_err() && made_directory {
        let _ = fs::remove_dir(&metadata);
    }
    result
}
#[tauri::command]
pub async fn create_java_project_declaration(
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<Created, String> {
    if window.label() != "main" {
        return Err("Project declarations require the main workspace window.".into());
    }
    super::blocking::run(move || {
        with_root_activation(|| {
            let root = workspace_root()?;
            let binding = current_workspace_binding_at(&root, &workspace_registry_path()?)?;
            if binding.workspace_id != request.workspace_id {
                return Err("The Java workspace changed before declaration creation.".into());
            }
            let path = create_at(&binding.canonical_root, &request)?;
            Ok(Created {
                workspace_id: request.workspace_id,
                generation: request.generation,
                request_id: request.request_id,
                path,
            })
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let mut nonce = [0; 16];
            getrandom::fill(&mut nonce).unwrap();
            let token: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
            let root = std::env::temp_dir().join(format!("ide-java-declaration-{token}"));
            fs::create_dir_all(root.join("sdk/bin")).unwrap();
            fs::create_dir_all(root.join("project/src")).unwrap();
            fs::write(root.join("sdk/release"), "JAVA_VERSION=21").unwrap();
            for name in ["java", "javac"] {
                fs::write(
                    root.join("sdk/bin").join(if cfg!(windows) {
                        format!("{name}.exe")
                    } else {
                        name.into()
                    }),
                    "",
                )
                .unwrap();
            }
            Self(root)
        }
        fn request(&self) -> Request {
            serde_json::from_value(json!({"workspaceId":"fixture","generation":1,"requestId":"create-1","projectPath":"project","sdkHome":self.0.join("sdk"),"release":17,"sourceRoots":["src"],"compileClasspath":[],"runtimeClasspath":["classes"],"outputDirectory":"classes"})).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn declaration_create_is_explicit_and_never_replaces_an_existing_file() {
        let fixture = Fixture::new();
        let request = fixture.request();
        let path = create_at(&fixture.0, &request).unwrap();
        assert_eq!(path, "project/.refactorkit/java-project.json");
        let bytes = fs::read(fixture.0.join(&path)).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["schemaVersion"], "java-declared-project-v1");
        assert_eq!(value["modules"][0]["sourceSets"][0]["proc"], "none");
        assert_eq!(
            value["modules"][0]["sourceSets"][0]["sourceRoots"],
            json!(["src"])
        );
        assert!(!fixture.0.join("project/classes").exists());
        assert!(create_at(&fixture.0, &request)
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(fs::read(fixture.0.join(path)).unwrap(), bytes);
        assert_eq!(
            fs::read_dir(fixture.0.join("project/.refactorkit"))
                .unwrap()
                .count(),
            1
        );
    }
    #[test]
    fn declaration_preserves_explicit_test_classpath_order_and_separate_outputs() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.test_source_set = Some(
            serde_json::from_value(json!({"id":"checks",
            "sourceRoots":["test code"],"outputDirectory":"products/test classes",
            "compileClasspath":["classes","lib/api.jar","lib/junit.jar"],
            "runtimeClasspath":["lib/runtime","products/test classes","classes","lib/junit.jar"]}))
            .unwrap(),
        );
        let path = create_at(&fixture.0, &request).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(fixture.0.join(path)).unwrap()).unwrap();
        let sets = value["modules"][0]["sourceSets"].as_array().unwrap();
        assert_eq!(sets.len(), 2);
        assert_eq!(sets[0]["compileClasspath"], json!([]));
        assert_eq!(
            sets[1],
            json!({"id":"checks","kind":"test","sourceRoots":["test code"],
            "generatedSourceRoots":[],"outputDirectories":["products/test classes"],
            "compileClasspath":["classes","lib/api.jar","lib/junit.jar"],
            "runtimeClasspath":["lib/runtime","products/test classes","classes","lib/junit.jar"],
            "release":17,"proc":"none"})
        );
        assert!(!fixture.0.join("project/products").exists());
    }
    #[test]
    fn declaration_refuses_invalid_test_configuration_without_writing() {
        let fixture = Fixture::new();
        let base = json!({"id":"checks","sourceRoots":["tests"],"outputDirectory":"test-classes",
            "compileClasspath":["classes"],"runtimeClasspath":["test-classes","classes"]});
        for (key, value) in [
            ("id", json!("main")),
            ("sourceRoots", json!([])),
            ("sourceRoots", json!(["../outside"])),
            ("outputDirectory", json!("classes")),
            ("runtimeClasspath", json!(["../outside.jar"])),
        ] {
            let mut request = fixture.request();
            let mut changed = base.clone();
            changed[key] = value;
            request.test_source_set = Some(serde_json::from_value(changed).unwrap());
            assert!(create_at(&fixture.0, &request).is_err(), "accepted {key}");
            assert!(!fixture.0.join("project/.refactorkit").exists());
        }
    }
    #[test]
    fn declaration_records_generated_roots_without_creating_or_generating_sources() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.source_roots.push("generated main".into());
        request.generated_source_roots = vec!["generated main".into()];
        request.test_source_set = Some(
            serde_json::from_value(json!({"id":"checks",
            "sourceRoots":["generated tests"],"generatedSourceRoots":["generated tests"],
            "outputDirectory":"test-classes","compileClasspath":["classes"],
            "runtimeClasspath":["test-classes","classes"]}))
            .unwrap(),
        );
        let path = create_at(&fixture.0, &request).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(fixture.0.join(path)).unwrap()).unwrap();
        assert_eq!(
            value["modules"][0]["sourceSets"][0]["sourceRoots"],
            json!(["src", "generated main"])
        );
        assert_eq!(
            value["modules"][0]["sourceSets"][0]["generatedSourceRoots"],
            json!(["generated main"])
        );
        assert_eq!(
            value["modules"][0]["sourceSets"][1]["generatedSourceRoots"],
            json!(["generated tests"])
        );
        assert!(!fixture.0.join("project/generated main").exists());
        assert!(!fixture.0.join("project/generated tests").exists());
    }
    #[test]
    fn declaration_refuses_generated_roots_outside_declared_compilation_roots() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.generated_source_roots = vec!["unselected".into()];
        assert!(create_at(&fixture.0, &request).is_err());
        request.generated_source_roots.clear();
        request.test_source_set = Some(
            serde_json::from_value(json!({"id":"checks",
            "sourceRoots":["tests"],"generatedSourceRoots":["unselected"],
            "outputDirectory":"test-classes","compileClasspath":[],"runtimeClasspath":[]}))
            .unwrap(),
        );
        assert!(create_at(&fixture.0, &request).is_err());
        assert!(!fixture.0.join("project/.refactorkit").exists());
    }
    #[test]
    fn declaration_serializes_multiple_modules_with_explicit_output_dependencies() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.compile_classpath = vec!["library/classes".into()];
        request.runtime_classpath.push("library/classes".into());
        request.additional_modules = vec![serde_json::from_value(json!({"id":"library","root":"library",
            "release":11,"sourceRoots":["library/src"],"generatedSourceRoots":[],
            "compileClasspath":[],"runtimeClasspath":["library/classes"],"outputDirectory":"library/classes"})).unwrap()];
        let path = create_at(&fixture.0, &request).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(fixture.0.join(path)).unwrap()).unwrap();
        assert_eq!(value["modules"].as_array().unwrap().len(), 2);
        assert_eq!(
            value["modules"][0]["sourceSets"][0]["compileClasspath"],
            json!(["library/classes"])
        );
        assert_eq!(
            value["modules"][1],
            json!({"id":"library","root":"library","sourceSets":[{
            "id":"main","kind":"main","sourceRoots":["library/src"],"generatedSourceRoots":[],
            "outputDirectories":["library/classes"],"compileClasspath":[],"runtimeClasspath":["library/classes"],"release":11,"proc":"none"}]})
        );
        assert!(!fixture.0.join("project/library").exists());
    }
    #[test]
    fn declaration_refuses_conflicting_module_names_outputs_and_build_models() {
        let fixture = Fixture::new();
        let base = json!({"id":"library","root":"library","release":17,"sourceRoots":["library/src"],
            "compileClasspath":[],"runtimeClasspath":["library/classes"],"outputDirectory":"library/classes"});
        for (key, value) in [
            ("id", json!("app")),
            ("root", json!("../outside")),
            ("sourceRoots", json!(["other/src"])),
            ("outputDirectory", json!("classes")),
        ] {
            let mut changed = base.clone();
            changed[key] = value;
            let mut request = fixture.request();
            request.additional_modules = vec![serde_json::from_value(changed).unwrap()];
            assert!(create_at(&fixture.0, &request).is_err(), "accepted {key}");
            assert!(!fixture.0.join("project/.refactorkit").exists());
        }
        let mut shared_output = base.clone();
        shared_output["root"] = json!(".");
        shared_output["outputDirectory"] = json!("classes");
        let mut conflicting = fixture.request();
        conflicting.additional_modules = vec![serde_json::from_value(shared_output).unwrap()];
        assert!(create_at(&fixture.0, &conflicting)
            .unwrap_err()
            .contains("distinct class output"));
        assert!(!fixture.0.join("project/.refactorkit").exists());
        let mut request = fixture.request();
        request.additional_modules = vec![serde_json::from_value(base).unwrap()];
        fs::create_dir_all(fixture.0.join("project/library")).unwrap();
        fs::write(fixture.0.join("project/library/pom.xml"), "preserve").unwrap();
        assert!(create_at(&fixture.0, &request)
            .unwrap_err()
            .contains("Maven or Gradle"));
        assert!(!fixture.0.join("project/.refactorkit").exists());
        assert_eq!(
            fs::read_to_string(fixture.0.join("project/library/pom.xml")).unwrap(),
            "preserve"
        );
    }
    #[test]
    fn declaration_rejects_build_models_and_escaping_configuration_before_writing() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        fs::write(fixture.0.join("project/pom.xml"), "preserve").unwrap();
        assert!(create_at(&fixture.0, &request)
            .unwrap_err()
            .contains("Maven or Gradle"));
        assert!(!fixture.0.join("project/.refactorkit").exists());
        fs::remove_file(fixture.0.join("project/pom.xml")).unwrap();
        request.source_roots = vec!["../outside".into()];
        assert!(create_at(&fixture.0, &request).is_err());
        request.source_roots = vec!["src".into()];
        request.output_directory = ".".into();
        assert!(create_at(&fixture.0, &request).is_err());
        assert!(!fixture.0.join("project/.refactorkit").exists());
    }
    #[cfg(unix)]
    #[test]
    fn declaration_rejects_a_redirected_metadata_directory() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("other")).unwrap();
        std::os::unix::fs::symlink(
            fixture.0.join("other"),
            fixture.0.join("project/.refactorkit"),
        )
        .unwrap();
        assert!(create_at(&fixture.0, &fixture.request())
            .unwrap_err()
            .contains("real directory"));
        assert_eq!(fs::read_dir(fixture.0.join("other")).unwrap().count(), 0);
    }
}
