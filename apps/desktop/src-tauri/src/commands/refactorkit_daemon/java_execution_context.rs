//! Project launch metadata comes from the owned RefactorKit context, never a second project model.
use super::transport::{session_call_detailed, REQUEST_TIMEOUT};
use super::{java_navigation::ProjectContext, java_project_context as project};
use crate::commands::workspace_registry::CurrentWorkspaceBinding;
use crate::workspace::ensure_within_root;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const MAVEN_TEST_JVM_SELECTION_METHOD: &str = "project.context.v7.testJvmSelection";

fn test_jvm_selection_has_toolchain_prerequisite(capabilities: &Value) -> Option<bool> {
    capabilities["methods"].as_array()?.iter().find(|method| {
            method["name"] == MAVEN_TEST_JVM_SELECTION_METHOD
                && method["requiresProject"] == true
                && method["writesWorkspace"] == false
                && ["typedSchemaV7", "mavenTestJvmSelection", "testJvmSelectionIsExecutionBound", "readOnlyBuildDiscovery"]
                    .iter().all(|feature| method["features"][*feature] == true)
    }).map(|method| method["features"]["mavenTestJvmToolchainPrerequisite"] == true)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MavenTestJvmSelection {
    BuildJvm,
    ExplicitExecutable(PathBuf),
    ToolchainRequirements(HashMap<String, String>),
    BuildContextToolchain,
    Unavailable,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MavenTestJvmSelectionFact {
    kind: String,
    availability: String,
    origin: Option<String>,
    executable: Option<String>,
    requirements: HashMap<String, String>,
    redacted: bool,
    refusal_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MavenTestJvmToolchainPrerequisite {
    availability: String,
    origin: String,
    requirements: HashMap<String, String>,
    redacted: bool,
    refusal_code: String,
}

fn test_jvm_fact_text(text: &str, limit: usize) -> bool {
    !text.is_empty() && text.len() <= limit && !text.chars().any(char::is_control)
}

fn test_jvm_toolchain_requirements_valid(requirements: &HashMap<String, String>) -> bool {
    requirements.len() <= 16 && requirements.iter().all(|(name, value)| {
        test_jvm_fact_text(name, 128) && test_jvm_fact_text(value, 1024)
    })
}

fn test_jvm_toolchain_prerequisite_valid(value: Value) -> bool {
    if value.is_null() {
        return true;
    }
    let Ok(fact) = serde_json::from_value::<MavenTestJvmToolchainPrerequisite>(value) else {
        return false;
    };
    fact.availability == "unavailable" && test_jvm_fact_text(&fact.origin, 8192)
        && test_jvm_toolchain_requirements_valid(&fact.requirements)
        && match fact.refusal_code.as_str() {
            "java.context.mavenTestJvmToolchainUnresolved" => !fact.redacted && !fact.requirements.is_empty(),
            "java.context.mavenTestJvmSelectionUnavailable" => fact.requirements.is_empty(),
            _ => false,
        }
}

fn decode_maven_test_jvm_selection(mut value: Value, with_prerequisite: bool) -> Option<MavenTestJvmSelection> {
    let mut has_plugin_prerequisite = false;
    if with_prerequisite {
        let prerequisite = value.as_object_mut()?.remove("toolchainPrerequisite")?;
        has_plugin_prerequisite = !prerequisite.is_null();
        // This field describes Maven's prerequisite lookup, rather than a replacement for the
        // effective JVM fact. Maven remains responsible for attempting the lookup at launch.
        if !test_jvm_toolchain_prerequisite_valid(prerequisite) {
            return None;
        }
    }
    let object = value.as_object()?;
    if object.len() != 7 || !["origin", "executable", "refusalCode"].iter().all(|key| object.contains_key(*key)) {
        return None;
    }
    let fact: MavenTestJvmSelectionFact = serde_json::from_value(value).ok()?;
    if fact.origin.as_deref().is_some_and(|origin| !test_jvm_fact_text(origin, 8192))
        || !test_jvm_toolchain_requirements_valid(&fact.requirements)
    {
        return None;
    }
    match (fact.kind.as_str(), fact.availability.as_str(), fact.refusal_code.as_deref()) {
        ("build-jvm", "complete", None) if !fact.redacted && fact.origin.is_some()
            && fact.executable.is_none() && fact.requirements.is_empty() => Some(MavenTestJvmSelection::BuildJvm),
        ("explicit-executable", "complete", None) if !fact.redacted && fact.origin.is_some()
            && fact.requirements.is_empty() => {
                let executable = fact.executable.as_deref().filter(|value| test_jvm_fact_text(value, 4096)).map(Path::new)?;
                (executable.is_absolute() && executable.parent()?.file_name()?.to_str()? == "bin"
                    && matches!(executable.file_name()?.to_str()?, "java" | "java.exe")
                    && !executable.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)))
                    .then(|| MavenTestJvmSelection::ExplicitExecutable(executable.to_path_buf()))
            }
        ("toolchain", "unavailable", Some("java.context.mavenTestJvmToolchainUnresolved"))
            if !fact.redacted && fact.origin.is_some() && fact.executable.is_none() && !fact.requirements.is_empty() =>
                Some(MavenTestJvmSelection::ToolchainRequirements(fact.requirements)),
        ("toolchain", "unavailable", Some("java.context.mavenTestJvmToolchainUnresolved"))
            if !fact.redacted && fact.executable.is_none() && fact.requirements.is_empty()
                && !has_plugin_prerequisite
                && fact.origin.as_deref() == Some("effective-model:build/plugins/org.apache.maven.plugins:maven-toolchains-plugin") =>
                Some(MavenTestJvmSelection::BuildContextToolchain),
        ("unresolved", "unavailable", Some("java.context.mavenTestJvmSelectionUnavailable"))
            if fact.executable.is_none() && fact.requirements.is_empty() => Some(MavenTestJvmSelection::Unavailable),
        _ => None,
    }
}

fn maven_test_jvm_selections(
    base: &Value,
    mut enriched: Value,
    with_prerequisite: bool,
) -> Result<HashMap<(String, String), Vec<MavenTestJvmSelection>>, String> {
    let invalid = || "RefactorKit returned inconsistent Maven test JVM selection metadata.".to_string();
    let mut selections = HashMap::new();
    for module in enriched["modules"].as_array_mut().ok_or_else(invalid)? {
        if module["providerId"] != "maven-effective-v1" {
            continue;
        }
        let module_id = module["id"].as_str().ok_or_else(invalid)?.to_owned();
        for source_set in module["sourceSets"].as_array_mut().ok_or_else(invalid)? {
            let id = source_set["id"].as_str().ok_or_else(invalid)?.to_owned();
            let executions = source_set["mavenTestJvm"]["executions"].as_array_mut().ok_or_else(invalid)?;
            let mut facts = Vec::with_capacity(executions.len());
            for execution in executions {
                let value = execution.as_object_mut().and_then(|execution| execution.remove("jvmSelection"))
                    .ok_or_else(invalid)?;
                facts.push(decode_maven_test_jvm_selection(value, with_prerequisite).ok_or_else(invalid)?);
            }
            if selections.insert((module_id.clone(), id), facts).is_some() {
                return Err(invalid());
            }
        }
    }
    // The method supplements the same context without changing execution identities, scope,
    // SDK evidence or snapshot authority. Keep the ordinary v7 response for all other use.
    if base != &enriched {
        return Err(invalid());
    }
    Ok(selections)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JavaExecutionProjectSelection {
    pub(super) context: ProjectContext,
    pub provider_id: String,
    pub module_id: String,
    pub source_set_id: String,
}

#[derive(Clone)]
pub(crate) struct JavaExecutionProjectContext(Arc<project::Manager>);

fn validate_selection_context(selection: &JavaExecutionProjectSelection) -> Result<(), String> {
    if project::valid_context_schema_version(&selection.context.context_schema_version) {
        Ok(())
    } else {
        Err("Unsupported Java project-context schema.".into())
    }
}

impl JavaExecutionProjectContext {
    pub(crate) fn new(state: &super::JavaProjectContextState) -> Self {
        Self(state.shared())
    }
    pub(crate) fn test_selection(
        &self,
        binding: &CurrentWorkspaceBinding,
        generation: u64,
        selection: &JavaExecutionProjectSelection,
    ) -> Result<JavaExecutionProjectSelection, String> {
        validate_selection_context(selection)?;
        let settings =
            serde_json::to_value(&selection.context).map_err(|_| "Invalid project selection.")?;
        project::with_selected_session(&self.0, binding, generation, &settings, |owned| {
            let custom_gradle_source_set = owned.has_gradle_evaluation();
            test_selection(
                owned
                    .observed_context()
                    .ok_or("Synchronize the project before execution.")?,
                selection,
                custom_gradle_source_set,
            )
        })
    }
    pub(crate) fn captured(
        &self,
        binding: &CurrentWorkspaceBinding,
        generation: u64,
        selection: &JavaExecutionProjectSelection,
    ) -> Result<ResolvedProject, String> {
        validate_selection_context(selection)?;
        let settings =
            serde_json::to_value(&selection.context).map_err(|_| "Invalid project selection.")?;
        let root = binding
            .canonical_root
            .join(&selection.context.project_path)
            .canonicalize()
            .map_err(|_| "The selected Java project is unavailable.")?;
        ensure_within_root(&binding.canonical_root, &root)?;
        let sdk = Path::new(&selection.context.sdk_home)
            .canonicalize()
            .map_err(|_| "The selected JDK is unavailable.")?;
        project::with_selected_session(&self.0, binding, generation, &settings, |owned| {
            let context = owned
                .observed_context()
                .ok_or("Synchronize the project before execution.")?;
            project_paths(
                &binding.canonical_root,
                &root,
                &sdk,
                context,
                selection,
                false,
            )
        })
    }

    /// Verify the selected context before a build. Later owned build output requires fresh metadata.
    pub(crate) fn resolve(
        &self,
        binding: &CurrentWorkspaceBinding,
        generation: u64,
        selection: &JavaExecutionProjectSelection,
        after_build: bool,
        require_jpms: bool,
    ) -> Result<ResolvedProject, String> {
        self.resolve_mode(
            binding,
            generation,
            selection,
            after_build,
            after_build,
            require_jpms,
            false,
        )
    }
    pub(crate) fn validate_retained(
        &self,
        binding: &CurrentWorkspaceBinding,
        generation: u64,
        selection: &JavaExecutionProjectSelection,
    ) -> Result<Option<PathBuf>, String> {
        validate_selection_context(selection)?;
        let settings = serde_json::to_value(&selection.context)
            .map_err(|_| "Invalid retained project selection.")?;
        project::with_workspace_session(&self.0, binding, generation, &settings, |owned| {
            owned.require_current_maven_runtime()?;
            Ok(owned.maven_launcher().map(Path::to_path_buf))
        })
    }
    pub(crate) fn resolve_for_launch(
        &self,
        binding: &CurrentWorkspaceBinding,
        generation: u64,
        selection: &JavaExecutionProjectSelection,
        repeated: bool,
        require_jpms: bool,
        qualify_test_jvm: bool,
    ) -> Result<ResolvedProject, String> {
        self.resolve_mode(binding, generation, selection, repeated, false, require_jpms, qualify_test_jvm)
    }
    fn resolve_mode(
        &self,
        binding: &CurrentWorkspaceBinding,
        generation: u64,
        selection: &JavaExecutionProjectSelection,
        after_build: bool,
        require_runtime: bool,
        require_jpms: bool,
        qualify_test_jvm: bool,
    ) -> Result<ResolvedProject, String> {
        if [
            &selection.provider_id,
            &selection.module_id,
            &selection.source_set_id,
        ]
        .iter()
        .any(|s| s.is_empty() || s.len() > 1024 || s.contains('\0'))
        {
            return Err(
                "Choose a module and source set from the synchronized Java project.".into(),
            );
        }
        let settings = serde_json::to_value(&selection.context)
            .map_err(|_| "Invalid Java execution project settings.")?;
        let provider_qualified =
            project::provider_qualified_context_schema(&selection.context.context_schema_version);
        let maven_failsafe_v4 =
            selection.context.context_schema_version == "java-project-context-v4";
        let context_v5 = selection.context.context_schema_version == "java-project-context-v5";
        let context_v6 = selection.context.context_schema_version == "java-project-context-v6";
        let context_v7 = selection.context.context_schema_version == "java-project-context-v7";
        if require_jpms && !(context_v5 || context_v6 || context_v7) {
            return Err(
                "Named-module launch requires provider-qualified Java project-context JPMS facts."
                    .into(),
            );
        }
        let request: project::Request = serde_json::from_value(json!({
            "workspaceId":binding.workspace_id,"generation":generation,"requestId":"java-execution-context",
            "projectPath":settings["projectPath"],"sdkHome":settings["sdkHome"],
            "mavenRepository":settings["mavenRepository"],"activeMavenProfiles":settings["activeMavenProfiles"],
            "inactiveMavenProfiles":settings["inactiveMavenProfiles"],"gradle":settings["gradle"],
            "providerId":if provider_qualified {json!(selection.provider_id)} else {Value::Null},
            "moduleId":if provider_qualified {json!(selection.module_id)} else {Value::Null},
            "sourceSetId":if provider_qualified && !maven_failsafe_v4 {json!(selection.source_set_id)} else {Value::Null},
            "sourceSetKind":if maven_failsafe_v4 {json!("integration-test")} else {Value::Null},
            "expectedContextHash":if after_build {Value::Null} else {settings["contextHash"].clone()},
            "requiredFacts":if require_jpms {json!(["jpms"])} else {Value::Null}
        })).map_err(|_| "Invalid Java execution context.")?;
        let (root, sdk) = project::validate_operation_settings(
            binding,
            generation,
            &selection.context.context_schema_version,
            &selection.context.project_path,
            &selection.context.sdk_home,
            settings["mavenRepository"]
                .as_str()
                .ok_or("Missing Maven repository settings.")?,
            &serde_json::from_value::<Vec<String>>(settings["activeMavenProfiles"].clone())
                .map_err(|_| "Invalid Maven profiles.")?,
            &serde_json::from_value::<Vec<String>>(settings["inactiveMavenProfiles"].clone())
                .map_err(|_| "Invalid Maven profiles.")?,
        )?;
        let action = |owned: &mut project::Active| {
            owned.require_current_maven_runtime()?;
            let refreshed = session_call_detailed(
                &mut owned.session,
                "workspace.refresh",
                json!({}),
                REQUEST_TIMEOUT,
            )
            .map_err(|_| "The Java execution project could not be refreshed.")?;
            if !matches!(refreshed["status"].as_str(), Some("ready" | "unchanged")) {
                return Err("Current saved Java project evidence is unavailable.".into());
            }
            let snapshot = refreshed["snapshotHash"]
                .as_str()
                .filter(|v| hash(v))
                .ok_or("Missing Java execution saved-source evidence.")?;
            let index_generation = refreshed["generation"]
                .as_u64()
                .ok_or("Missing Java execution index generation.")?;
            project::refresh_saved_authority(owned, snapshot, index_generation);
            if !after_build && snapshot != selection.context.snapshot_hash {
                return Err(
                    "The Java execution project changed. Synchronize it before launching.".into(),
                );
            }
            let mut params = json!({"expectedSnapshotHash":snapshot,"sdkHome":sdk});
            if provider_qualified {
                params["providerId"] = json!(selection.provider_id);
                params["moduleId"] = json!(selection.module_id);
                if maven_failsafe_v4 {
                    if !project::maven_failsafe_context_advertised(&owned.capabilities) {
                        return Err(
                            "RefactorKit no longer advertises Maven Failsafe context v4.".into(),
                        );
                    }
                    params["sourceSetKind"] = json!("integration-test");
                } else {
                    params["sourceSetId"] = json!(selection.source_set_id);
                }
                if context_v5 && !project::java_project_context_v5_advertised(&owned.capabilities) {
                    return Err("RefactorKit no longer advertises Java project-context v5.".into());
                }
                if context_v6 && !project::java_project_context_v6_advertised(&owned.capabilities) {
                    return Err("RefactorKit no longer advertises Java project-context v6.".into());
                }
                if context_v7 && !project::java_project_context_v7_advertised(&owned.capabilities) {
                    return Err("RefactorKit no longer advertises Java project-context v7.".into());
                }
            }
            if require_jpms {
                params["requiredFacts"] = json!(["jpms"]);
            }
            if !after_build {
                params["expectedContextHash"] = settings["contextHash"].clone();
            }
            let context_method = if context_v7 {
                "project.context.v7"
            } else if context_v6 {
                "project.context.v6"
            } else if context_v5 {
                "project.context.v5"
            } else if maven_failsafe_v4 {
                "project.context.v4"
            } else {
                "project.context"
            };
            let wants_build_tree_path = provider_qualified
                && selection.provider_id == "gradle-effective-v1"
                && owned.capabilities["methods"].as_array().is_some_and(|methods| {
                    methods.iter().any(|method| {
                        method["name"] == context_method
                            && method["requiresProject"] == true
                            && method["writesWorkspace"] == false
                            && method["features"]["gradleBuildTreeProjectPath"] == true
                    })
                });
            if wants_build_tree_path {
                params["includeGradleBuildTreeProjectPaths"] = json!(true);
            }
            let verification = (context_method.to_owned(), params.clone());
            let raw =
                session_call_detailed(&mut owned.session, context_method, params, REQUEST_TIMEOUT)
                    .map_err(|_| "Java execution project metadata is unavailable.")?;
            let selection_contract = (qualify_test_jvm && context_v7
                && selection.provider_id == "maven-effective-v1" && raw["status"] == "available")
                .then(|| test_jvm_selection_has_toolchain_prerequisite(&owned.capabilities)).flatten();
            let test_jvm_selections = if let Some(with_prerequisite) = selection_contract {
                let mut params = verification.1.clone();
                params["expectedContextHash"] = raw["contextHash"].clone();
                let enriched = session_call_detailed(
                    &mut owned.session, MAVEN_TEST_JVM_SELECTION_METHOD, params, REQUEST_TIMEOUT,
                ).map_err(|_| "Maven test JVM selection metadata is unavailable.")?;
                Some(maven_test_jvm_selections(&raw, enriched, with_prerequisite)?)
            } else {
                None
            };
            project::trace_snapshot(
                "project.execution.context.response",
                json!({
                    "providerId": selection.provider_id,
                    "moduleId": selection.module_id,
                    "sourceSetId": selection.source_set_id,
                    "requestedSchemaVersion": selection.context.context_schema_version,
                    "method": context_method,
                    "schemaVersion": raw.get("schemaVersion"),
                    "status": raw.get("status"),
                    "selectedSource": raw.get("selectedSource"),
                }),
            );
            if raw["providers"]
                .as_array()
                .is_some_and(|ps| ps.iter().any(|p| p["providerId"] == "gradle-effective-v1"))
                && !owned.has_gradle_evaluation()
            {
                return Err(
                    "Evaluate the Gradle project explicitly before using its launch context."
                        .into(),
                );
            }
            let version = owned.capabilities["version"]
                .as_str()
                .ok_or("Missing provider version.")?;
            let result = project::normalize(raw, &request, snapshot, &sdk, version)?;
            if result["status"] != "available" {
                return Err(
                    "An available effective project context is required for Java execution.".into(),
                );
            }
            let context = &result["context"];
            let identities: Vec<_> = context["sdk"]
                .as_array()
                .ok_or("Missing Java SDK evidence.")?
                .iter()
                .map(|s| s["identitySha256"].clone())
                .collect();
            if json!(identities) != settings["platformIdentities"] {
                return Err("The selected Java platform changed before execution.".into());
            }
            let resolved = project_paths_with_jpms(
                &binding.canonical_root,
                &root,
                &sdk,
                context,
                selection,
                require_runtime,
                require_jpms,
            )?;
            let mut resolved = resolved;
            if resolved.build_tool == "maven" {
                resolved.maven_launcher = owned.maven_launcher().map(Path::to_path_buf);
            }
            resolved.maven_test_jvm_selections = test_jvm_selections;
            if wants_build_tree_path != resolved.gradle_build_tree_project_path.is_some() {
                return Err("RefactorKit returned inconsistent Gradle build-tree project path evidence.".into());
            }
            if resolved.build_tool == "gradle" {
                let runtime_home = result["gradleSync"]["gradleRuntimeHome"]
                    .as_str()
                    .or_else(|| settings["gradle"]["gradleRuntimeHome"].as_str())
                    .map(Path::new)
                    .map(Path::canonicalize)
                    .transpose()
                    .map_err(|_| "The synchronized Gradle runtime JDK is unavailable.")?
                    .unwrap_or_else(|| sdk.clone());
                if !runtime_home.join("bin/java").is_file()
                    || !runtime_home.join("bin/javac").is_file()
                {
                    return Err("The synchronized Gradle runtime is not a full JDK.".into());
                }
                resolved.gradle_runtime_home = Some(runtime_home);
            }
            owned.observe_context(context.clone(), verification);
            Ok(resolved)
        };
        if after_build {
            project::with_workspace_session(&self.0, binding, generation, &settings, action)
        } else {
            project::with_selected_session(&self.0, binding, generation, &settings, action)
        }
    }
}

#[derive(Debug)]
pub(crate) struct ResolvedProject {
    pub project_context_schema_version: String,
    pub root: PathBuf,
    pub module_root: PathBuf,
    pub gradle_build_root: Option<PathBuf>,
    pub gradle_project_path: Option<String>,
    pub gradle_build_tree_project_path: Option<String>,
    pub sdk_home: PathBuf,
    pub gradle_runtime_home: Option<PathBuf>,
    pub build_tool: String,
    pub maven_launcher: Option<PathBuf>,
    pub declared_jdk: Option<DeclaredJdkCompilation>,
    pub source_set_kind: String,
    pub runtime_classpath: Vec<PathBuf>,
    pub debugger_source_roots: Vec<PathBuf>,
    pub output_directories: Vec<PathBuf>,
    pub module_name: Option<String>,
    pub module_descriptor_hash: Option<String>,
    pub module_path_identity: Option<Vec<(String, Vec<String>, Option<String>)>>,
    pub module_path: Vec<PathBuf>,
    pub maven_failsafe: Option<MavenFailsafeExecution>,
    /// Complete provider facts for the selected Maven module and its `--also-make` closure.
    /// `None` means JVM-option injection cannot establish the scope of Maven's global argLine.
    pub maven_test_jvm_modules: Option<Vec<MavenTestJvmModuleFacts>>,
    pub maven_test_jvm_selections: Option<HashMap<(String, String), Vec<MavenTestJvmSelection>>>,
}

impl ResolvedProject {
    pub(crate) fn gradle_invocation_root(&self) -> &Path {
        if self.gradle_build_tree_project_path.is_some() {
            &self.root
        } else {
            self.gradle_build_root.as_deref().unwrap_or(&self.module_root)
        }
    }

    pub(crate) fn gradle_task_project_path(&self) -> Option<&str> {
        self.gradle_build_tree_project_path.as_deref().or(self.gradle_project_path.as_deref())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct MavenTestJvmModuleFacts {
    pub module_id: String,
    pub root: Option<PathBuf>,
    pub source_sets: Vec<MavenTestJvmSourceSetFacts>,
}

#[derive(Debug, Clone)]
pub(crate) struct MavenTestJvmSourceSetFacts {
    pub id: String,
    pub kind: String,
    pub test_jvm: Value,
    pub failsafe: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MavenFailsafeExecution {
    pub execution_id: String,
    pub plugin_version: String,
    pub phase: String,
    pub goals: Vec<String>,
    /// Workspace-relative configured report directory, with no inferred Maven default.
    pub report_directory: String,
}
fn test_selection(
    context: &Value,
    selection: &JavaExecutionProjectSelection,
    custom_gradle_source_set: bool,
) -> Result<JavaExecutionProjectSelection, String> {
    let modules = context["modules"]
        .as_array()
        .filter(|modules| modules.len() <= 128)
        .ok_or("Invalid project modules.")?;
    let owners: Vec<_> = modules
        .iter()
        .filter(|module| {
            module["providerId"] == selection.provider_id && module["id"] == selection.module_id
        })
        .collect();
    if owners.len() != 1 {
        return Err("The selected module is missing or ambiguous.".into());
    }
    let sets = owners[0]["sourceSets"]
        .as_array()
        .filter(|sets| sets.len() <= 128)
        .ok_or("Invalid source sets.")?;
    let current: Vec<_> = sets
        .iter()
        .filter(|set| set["id"] == selection.source_set_id)
        .collect();
    if current.len() != 1 {
        return Err("The selected source set is missing or ambiguous.".into());
    }
    if current[0]["kind"] == "test" {
        return Ok(selection.clone());
    }
    if current[0]["kind"] == "integration-test" {
        return Ok(selection.clone());
    }
    if current[0]["kind"] == "custom" && custom_gradle_source_set {
        return Ok(selection.clone());
    }
    if current[0]["kind"] != "main" {
        return Err("Choose a supported test source set before test execution.".into());
    }
    let tests: Vec<_> = sets.iter().filter(|set| set["kind"] == "test").collect();
    if tests.len() != 1 {
        return Err(
            "The module has no unique test source set. Choose its test source set explicitly."
                .into(),
        );
    }
    let id = tests[0]["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 1024 && !id.contains('\0'))
        .ok_or("Invalid test source-set identity.")?;
    Ok(JavaExecutionProjectSelection {
        source_set_id: id.into(),
        ..selection.clone()
    })
}
fn hash(v: &str) -> bool {
    v.len() == 64
        && v.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn local_path(root: &Path, value: &Value) -> Result<PathBuf, String> {
    let text = value
        .as_str()
        .filter(|s| s.len() <= 4096 && !s.contains(['\0', '\\']))
        .ok_or("Invalid project launch path.")?;
    let path = Path::new(text);
    if path.is_absolute()
        || (text != "."
            && path
                .components()
                .any(|c| !matches!(c, Component::Normal(_))))
    {
        return Err("A module path must remain in its selected project.".into());
    }
    let resolved = root.join(path);
    let mut existing = resolved.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or("A module path has no existing workspace parent.")?;
    }
    let canonical = existing
        .canonicalize()
        .map_err(|_| "A module path has no safe workspace parent.")?;
    ensure_within_root(root, &canonical)?;
    Ok(resolved)
}
fn project_paths(
    workspace_root: &Path,
    selected_project_root: &Path,
    sdk: &Path,
    context: &Value,
    selection: &JavaExecutionProjectSelection,
    require_runtime: bool,
) -> Result<ResolvedProject, String> {
    project_paths_with_jpms(
        workspace_root,
        selected_project_root,
        sdk,
        context,
        selection,
        require_runtime,
        false,
    )
}

fn project_paths_with_jpms(
    workspace_root: &Path,
    selected_project_root: &Path,
    sdk: &Path,
    context: &Value,
    selection: &JavaExecutionProjectSelection,
    require_runtime: bool,
    require_jpms: bool,
) -> Result<ResolvedProject, String> {
    let path_root = if project::provider_qualified_context_schema(
        context["schemaVersion"].as_str().unwrap_or_default(),
    ) {
        workspace_root
    } else {
        selected_project_root
    };
    let modules = context["modules"]
        .as_array()
        .filter(|v| v.len() <= 128)
        .ok_or("Missing or oversized project modules.")?;
    let owners: Vec<_> = modules
        .iter()
        .filter(|m| m["providerId"] == selection.provider_id && m["id"] == selection.module_id)
        .collect();
    if owners.len() != 1 {
        return Err("The selected Java module is missing or ambiguous.".into());
    }
    let module = owners[0];
    let build_tool = match module["providerId"].as_str() {
        Some("maven-effective-v1") => "maven",
        Some("gradle-effective-v1") => "gradle",
        Some("java-declared-v1") => "jdk",
        _ => return Err("The selected module has no qualified effective build provider.".into()),
    };
    let gradle_identity = if build_tool == "gradle"
        && project::provider_qualified_context_schema(
            context["schemaVersion"].as_str().unwrap_or_default(),
        ) {
        let build_root = local_path(workspace_root, &module["buildRoot"])?;
        let project_path = module["projectPath"]
            .as_str()
            .filter(|value| gradle_project_path(value))
            .ok_or("The selected Gradle project path is invalid.")?;
        let tree_path = match module.get("buildTreeProjectPath") {
            None => None,
            Some(value) => {
                let path = value.as_str().filter(|path| gradle_project_path(path))
                    .ok_or("The selected Gradle build-tree project path is invalid.")?;
                let matches_project = if build_root == selected_project_root {
                    path == project_path
                } else {
                    path != ":" && path != project_path
                        && (project_path == ":" || path.ends_with(project_path))
                };
                if !matches_project {
                    return Err("The Gradle build-tree project path disagrees with the selected build and project.".into());
                }
                Some(path.to_owned())
            }
        };
        (Some(build_root), Some(project_path.to_string()), tree_path)
    } else {
        (None, None, None)
    };
    let module_root = local_path(path_root, &module["root"])?;
    if !module_root.is_dir() {
        return Err("The selected module directory is unavailable.".into());
    }
    // Empty and dot module roots can retain separators after Path::join. Gradle
    // compares this directory as text with projectDir.canonicalPath.
    let module_root = module_root
        .canonicalize()
        .map_err(|_| "The selected module directory is unavailable.".to_string())?;
    ensure_within_root(path_root, &module_root)?;
    let sets: Vec<_> = module["sourceSets"]
        .as_array()
        .ok_or("Missing source sets.")?
        .iter()
        .filter(|s| s["id"] == selection.source_set_id)
        .collect();
    if sets.len() != 1 {
        return Err("The selected Java source set is missing or ambiguous.".into());
    }
    let source_set = sets[0];
    let kind = source_set["kind"]
        .as_str()
        .ok_or("Missing source-set kind.")?;
    let outputs = source_set["outputDirectories"]
        .as_array()
        .filter(|v| v.len() <= 128)
        .ok_or("Missing or oversized source-set output directories.")?;
    let entries = source_set["runtimeClasspath"]
        .as_array()
        .filter(|v| v.len() <= 4096)
        .ok_or("Missing or oversized runtime classpath.")?;
    let declared_jdk = if build_tool == "jdk" {
        Some(declared_jdk_compilation(path_root, source_set)?)
    } else {
        None
    };
    let maven_failsafe = if build_tool == "maven" && kind == "integration-test" {
        Some(maven_failsafe_execution(
            workspace_root,
            &module_root,
            context,
            source_set,
        )?)
    } else {
        None
    };
    let project_context_schema_version = context["schemaVersion"]
        .as_str()
        .unwrap_or(&selection.context.context_schema_version)
        .to_owned();
    let maven_test_jvm_modules =
        if build_tool == "maven" && project_context_schema_version == "java-project-context-v7" {
            maven_test_jvm_facts_for_invocation(
                context,
                &selection.module_id,
                module_root == selected_project_root,
                path_root,
            )
        } else {
            None
        };
    let output_directories = outputs
        .iter()
        .map(|value| local_path(path_root, value))
        .collect::<Result<Vec<_>, _>>()?;
    let (module_name, module_descriptor_hash, module_path_identity, module_path) = if require_jpms {
        jpms_module_facts(
            path_root,
            &module_root,
            source_set,
            &output_directories,
            require_runtime,
        )?
    } else {
        (None, None, None, Vec::new())
    };
    let mut runtime_classpath = Vec::new();
    if require_runtime || declared_jdk.is_some() {
        let mut declared_outputs = Vec::new();
        for owner in modules {
            for set in owner["sourceSets"]
                .as_array()
                .filter(|v| v.len() <= 128)
                .ok_or("Invalid source-set output inventory.")?
            {
                for output in set["outputDirectories"]
                    .as_array()
                    .filter(|v| v.len() <= 128)
                    .ok_or("Invalid output directories.")?
                {
                    declared_outputs.push(local_path(path_root, output)?);
                    if declared_outputs.len() > 16384 {
                        return Err("Project output inventory is oversized.".into());
                    }
                }
            }
        }
        let mut compiled_output_available = false;
        for output in outputs {
            let path = local_path(path_root, output)?;
            if path.is_dir() {
                compiled_output_available = true;
                if declared_jdk.is_none() && !runtime_classpath.contains(&path) {
                    runtime_classpath.push(path);
                }
            }
        }
        if require_runtime && !compiled_output_available {
            return Err("The selected source set has no compiled output directory.".into());
        }
        for entry in entries {
            let value = entry["path"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 4096 && !s.contains('\0'))
                .ok_or("Invalid runtime dependency path.")?;
            let path = if Path::new(value).is_absolute() {
                PathBuf::from(value)
            } else {
                local_path(path_root, &entry["path"])?
            };
            if !path.is_file() && !path.is_dir() && !declared_outputs.contains(&path) {
                return Err(
                    "A synchronized runtime dependency is unavailable after compilation.".into(),
                );
            }
            if !runtime_classpath.contains(&path) {
                runtime_classpath.push(path);
            }
        }
        if require_runtime && runtime_classpath.is_empty() {
            return Err("The selected source set has no declared runtime classpath.".into());
        }
    }
    let mut providers = context["providers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|provider| provider["providerId"] == selection.provider_id);
    let gradle_archives = if gradle_identity.0.is_some()
        && providers
            .next()
            .is_some_and(|provider| provider["status"] == "available")
        && providers.next().is_none()
    {
        gradle_project_archives(path_root, source_set, entries, selection, require_runtime)
    } else {
        HashMap::new()
    };
    let debugger_source_roots =
        debugger_source_roots(path_root, modules, selection, entries, gradle_archives)?;
    Ok(ResolvedProject {
        project_context_schema_version,
        root: selected_project_root.to_path_buf(),
        module_root,
        gradle_build_root: gradle_identity.0,
        gradle_project_path: gradle_identity.1,
        gradle_build_tree_project_path: gradle_identity.2,
        sdk_home: sdk.to_path_buf(),
        gradle_runtime_home: None,
        build_tool: build_tool.into(),
        maven_launcher: None,
        declared_jdk,
        source_set_kind: kind.into(),
        runtime_classpath,
        debugger_source_roots,
        output_directories,
        module_name,
        module_descriptor_hash,
        module_path_identity,
        module_path,
        maven_failsafe,
        maven_test_jvm_modules,
        maven_test_jvm_selections: None,
    })
}

/// Evaluated Gradle identifies its project JAR with the producing main source set.
/// Other artifacts are attributed to the consuming set. Group repeated paths so
/// conflicting provider rows cannot make either set eligible.
fn gradle_project_archives<'a>(
    root: &Path,
    source_set: &Value,
    entries: &'a [Value],
    selection: &JavaExecutionProjectSelection,
    require_runtime: bool,
) -> HashMap<PathBuf, (&'a str, &'a str)> {
    // Two Gradle Jar tasks can publish the same physical path. The evaluated
    // dependency edges and the classpath must agree before attributing sources.
    let Some(dependencies) = source_set["moduleDependencies"].as_array() else {
        return HashMap::new();
    };
    let runtime_dependencies: HashSet<_> = dependencies
        .iter()
        .filter_map(|edge| {
            edge["moduleId"]
                .as_str()
                .zip(edge["scope"].as_str())
                .filter(|(_, scope)| matches!(*scope, "compile" | "runtime"))
        })
        .collect();
    let reported: HashSet<_> = entries
        .iter()
        .filter(|entry| entry["providerId"] == selection.provider_id)
        .filter_map(|entry| {
            entry["moduleId"]
                .as_str()
                .zip(entry["dependencyScope"].as_str())
        })
        .collect();
    if !runtime_dependencies.is_subset(&reported) {
        return HashMap::new();
    }
    let mut archives = HashMap::new();
    for entry in entries {
        let Some(text) = entry["path"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 4096)
        else {
            continue;
        };
        let path = root.join(text);
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        if !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        {
            continue;
        }
        let owner = entry["moduleId"]
            .as_str()
            .zip(entry["sourceSetId"].as_str())
            .filter(|&(module, set)| {
                entry["providerId"] == selection.provider_id
                    && (module != selection.module_id || set != selection.source_set_id)
                    && (module == selection.module_id
                        || entry["dependencyScope"]
                            .as_str()
                            .is_some_and(|scope| runtime_dependencies.contains(&(module, scope))))
            })
            .zip(entry["fingerprint"].as_str());
        let candidate = archives.entry(path).or_insert(owner);
        if *candidate != owner {
            *candidate = None;
        }
    }
    archives
        .into_iter()
        .filter_map(|(path, claim)| {
            let (owner, fingerprint) = claim?;
            // A Gradle test worker can build the declared JAR after debugger setup.
            // Failing metadata or linked ancestors cannot stand in for an absent output.
            for ancestor in path.ancestors() {
                match std::fs::symlink_metadata(ancestor) {
                    Ok(metadata) if ancestor.canonicalize().ok().as_deref() == Some(ancestor) => {
                        let matches = if ancestor == path {
                            metadata.is_file() && valid_sha256(fingerprint)
                        } else {
                            !require_runtime && metadata.is_dir() && fingerprint == "missing"
                        };
                        return matches.then_some((path, owner));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    _ => return None,
                }
            }
            None
        })
        .collect()
}

/// Test workers compile after launch preparation. Their declared runtime outputs
/// can identify source roots even before the build creates the output directories.
fn debugger_source_roots(
    path_root: &Path,
    modules: &[Value],
    selection: &JavaExecutionProjectSelection,
    entries: &[Value],
    mut gradle_archives: HashMap<PathBuf, (&str, &str)>,
) -> Result<Vec<PathBuf>, String> {
    let declared_paths: HashSet<_> = entries
        .iter()
        .filter_map(|entry| entry["path"].as_str())
        .filter(|path| !path.is_empty() && path.len() <= 4096)
        .map(|path| path_root.join(path))
        .collect();
    let mut source_sets = Vec::new();
    let mut output_owners = HashMap::new();
    let mut archive_owners = HashMap::new();
    for module in modules {
        for set in module["sourceSets"]
            .as_array()
            .filter(|sets| sets.len() <= 128)
            .ok_or("Missing or oversized source sets.")?
        {
            let index = source_sets.len();
            let selected = module["providerId"] == selection.provider_id
                && module["id"] == selection.module_id
                && set["id"] == selection.source_set_id;
            source_sets.push((set, selected));
            if !gradle_archives.is_empty() && module["providerId"] == selection.provider_id {
                if let Some(id) = module["id"].as_str().zip(set["id"].as_str()) {
                    archive_owners
                        .entry(id)
                        .and_modify(|owner| *owner = None)
                        .or_insert((set["kind"] == "main").then_some(index));
                }
            }
            for output in set["outputDirectories"]
                .as_array()
                .filter(|outputs| outputs.len() <= 128)
                .ok_or("Missing or oversized source-set output directories.")?
            {
                let path = local_path(path_root, output)?;
                gradle_archives.remove(&path);
                if declared_paths.contains(&path) {
                    let owner = output_owners.entry(path).or_insert(Some(index));
                    if *owner != Some(index) {
                        *owner = None;
                    }
                }
            }
        }
    }
    // A shared output directory cannot identify which source set supplied a runtime class.
    for index in output_owners.into_values().flatten() {
        source_sets[index].1 = true;
    }
    for owner in gradle_archives.values() {
        if let Some(Some(index)) = archive_owners.get(owner) {
            source_sets[*index].1 = true;
        }
    }
    let mut directories = Vec::new();
    for (set, included) in source_sets {
        if !included {
            continue;
        }
        for key in ["sourceRoots", "generatedSourceRoots"] {
            if let Some(roots) = set[key].as_array() {
                if roots.len() > 128 {
                    return Err("Source-root inventory is oversized.".into());
                }
                for value in roots {
                    let directory = local_path(path_root, value)?;
                    if directory.is_dir() && !directories.contains(&directory) {
                        directories.push(directory);
                    }
                    if directories.len() > 4096 {
                        return Err("Debugger source-root inventory is oversized.".into());
                    }
                }
            }
        }
    }
    Ok(directories)
}

/// Capture the entire Maven reactor slice that `--projects <module> --also-make` can execute.
/// Missing identities or dependency edges make the scope unknown, so callers must refuse JVM
/// option injection while leaving ordinary build and test execution available.
fn maven_test_jvm_facts_for_invocation(
    context: &Value,
    selected_module_id: &str,
    includes_all_modules: bool,
    path_root: &Path,
) -> Option<Vec<MavenTestJvmModuleFacts>> {
    let modules = context["modules"]
        .as_array()
        .filter(|items| items.len() <= 128)?;
    let mut modules_by_id = HashMap::<String, &Value>::new();
    let mut dependencies_by_id = HashMap::<String, HashSet<String>>::new();
    for module in modules
        .iter()
        .filter(|module| module["providerId"] == "maven-effective-v1")
    {
        let module_id = module["id"].as_str()?.to_owned();
        let source_sets = module["sourceSets"]
            .as_array()
            .filter(|items| items.len() <= 128)?;
        let mut dependencies = HashSet::new();
        for source_set in source_sets {
            for dependency in source_set["moduleDependencies"]
                .as_array()
                .filter(|items| items.len() <= 128)?
            {
                dependencies.insert(dependency["moduleId"].as_str()?.to_owned());
            }
        }
        if modules_by_id.insert(module_id.clone(), module).is_some()
            || dependencies_by_id.insert(module_id, dependencies).is_some()
        {
            return None;
        }
    }
    if !modules_by_id.contains_key(selected_module_id) {
        return None;
    }

    let mut included = HashSet::new();
    let mut pending = VecDeque::new();
    if includes_all_modules {
        pending.extend(modules_by_id.keys().cloned());
    } else {
        pending.push_back(selected_module_id.to_owned());
    }
    while let Some(module_id) = pending.pop_front() {
        if !included.insert(module_id.clone()) {
            continue;
        }
        for dependency_id in dependencies_by_id.get(&module_id)? {
            if !modules_by_id.contains_key(dependency_id) {
                return None;
            }
            pending.push_back(dependency_id.clone());
        }
    }

    let mut result = Vec::with_capacity(included.len());
    for module_id in included {
        let module = modules_by_id.get(&module_id)?;
        let source_sets = module["sourceSets"].as_array()?;
        let mut facts = Vec::with_capacity(source_sets.len());
        for source_set in source_sets {
            let id = source_set["id"].as_str()?.to_owned();
            let kind = source_set["kind"].as_str()?.to_owned();
            let test_jvm = source_set["mavenTestJvm"].clone();
            if !project::maven_test_jvm_fact_valid(&test_jvm) {
                return None;
            }
            facts.push(MavenTestJvmSourceSetFacts {
                id,
                kind,
                test_jvm,
                failsafe: source_set["mavenFailsafe"].clone(),
            });
        }
        result.push(MavenTestJvmModuleFacts {
            module_id,
            root: local_path(path_root, &module["root"]).ok(),
            source_sets: facts,
        });
    }
    Some(result)
}

fn jpms_module_facts(
    path_root: &Path,
    module_root: &Path,
    source_set: &Value,
    output_directories: &[PathBuf],
    require_runtime: bool,
) -> Result<
    (
        Option<String>,
        Option<String>,
        Option<Vec<(String, Vec<String>, Option<String>)>>,
        Vec<PathBuf>,
    ),
    String,
> {
    if source_set["kind"] != "main" || source_set["id"] != "main" {
        return Err(
            "Named-module launch is supported only for the synchronized main source set.".into(),
        );
    }
    let jpms = &source_set["jpms"];
    if jpms["availability"] != "complete" || !jpms["refusalCode"].is_null() {
        return Err(
            "RefactorKit did not attest a complete JPMS module path and descriptor.".into(),
        );
    }
    let descriptors = jpms["descriptors"]
        .as_array()
        .filter(|items| items.len() == 1)
        .ok_or("Named-module launch requires exactly one provider-attested module descriptor.")?;
    let descriptor = &descriptors[0];
    let module_name = descriptor["moduleName"]
        .as_str()
        .filter(|name| valid_module_name(name))
        .ok_or("RefactorKit returned an invalid JPMS module name.")?
        .to_owned();
    let declared_hash = descriptor["contentSha256"]
        .as_str()
        .filter(|hash| valid_sha256(hash))
        .ok_or("RefactorKit returned an invalid module-descriptor fingerprint.")?;
    let descriptor_path = local_path(path_root, &descriptor["path"])?;
    let descriptor_real = descriptor_path
        .canonicalize()
        .map_err(|_| "The synchronized Java module descriptor is unavailable.")?;
    let module_root_real = module_root
        .canonicalize()
        .map_err(|_| "The selected Java module directory is unavailable.")?;
    if !descriptor_real.is_file()
        || descriptor_real.file_name().and_then(|name| name.to_str()) != Some("module-info.java")
        || !descriptor_real.starts_with(&module_root_real)
    {
        return Err(
            "The JPMS descriptor is outside the selected module or is not module-info.java.".into(),
        );
    }
    let bytes = std::fs::read(&descriptor_real)
        .map_err(|_| "The synchronized Java module descriptor cannot be read.")?;
    let current_hash = format!("{:x}", Sha256::digest(bytes));
    if current_hash != declared_hash {
        return Err("The synchronized Java module descriptor changed before launch.".into());
    }

    let entries = jpms["modulePath"]
        .as_array()
        .filter(|items| items.len() <= 4096)
        .ok_or("RefactorKit returned an invalid or oversized JPMS module path.")?;
    let mut paths = Vec::with_capacity(entries.len() + output_directories.len());
    let mut module_names = std::collections::HashSet::new();
    let mut module_path_identity = Vec::with_capacity(entries.len());
    if require_runtime {
        let module_outputs = output_directories
            .iter()
            .filter(|output| output.join("module-info.class").is_file())
            .collect::<Vec<_>>();
        if module_outputs.len() != 1 {
            return Err("Named-module launch requires exactly one compiled module output.".into());
        }
        let canonical = module_outputs[0]
            .canonicalize()
            .map_err(|_| "The selected Java module output is unavailable after compilation.")?;
        if !canonical.is_dir() {
            return Err("The selected Java module output is not a directory.".into());
        }
        paths.push(canonical);
    }
    for entry in entries {
        let value = entry["path"]
            .as_str()
            .filter(|path| !path.is_empty() && path.len() <= 4096 && !path.contains('\0'))
            .ok_or("RefactorKit returned an invalid JPMS module-path entry.")?;
        let names = entry["moduleNames"]
            .as_array()
            .filter(|names| !names.is_empty() && names.len() <= 4096)
            .ok_or("RefactorKit returned a module-path entry without resolved module names.")?;
        let mut entry_module_names = Vec::with_capacity(names.len());
        for name in names {
            let name = name
                .as_str()
                .filter(|name| valid_module_name(name))
                .ok_or("RefactorKit returned an invalid module-path module name.")?;
            if !module_names.insert(name.to_owned()) || name == module_name {
                return Err(
                    "The synchronized JPMS module path contains ambiguous module names.".into(),
                );
            }
            entry_module_names.push(name.to_owned());
        }
        let fingerprint = match &entry["fingerprint"] {
            Value::Null => None,
            Value::String(value) if value.len() <= 8192 && !value.contains('\0') => {
                Some(value.clone())
            }
            _ => return Err("RefactorKit returned an invalid module-path fingerprint.".into()),
        };
        module_path_identity.push((value.to_owned(), entry_module_names, fingerprint));
        if require_runtime {
            let path = Path::new(value);
            let path = if path.is_absolute() {
                path.canonicalize().map_err(|_| {
                    "A synchronized JPMS module-path entry is unavailable after compilation."
                })?
            } else {
                local_path(path_root, &entry["path"])?
                    .canonicalize()
                    .map_err(|_| {
                        "A synchronized JPMS module-path entry is unavailable after compilation."
                    })?
            };
            if !path.is_file() && !path.is_dir() {
                return Err(
                    "A synchronized JPMS module-path entry is not a file or directory.".into(),
                );
            }
            if !paths.contains(&path) {
                paths.push(path);
            }
        } else if !Path::new(value).is_absolute() {
            let _ = local_path(path_root, &entry["path"])?;
        }
    }
    Ok((
        Some(module_name),
        Some(declared_hash.to_owned()),
        Some(module_path_identity),
        paths,
    ))
}

fn valid_module_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value.split('.').all(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
                && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn maven_failsafe_execution(
    workspace_root: &Path,
    module_root: &Path,
    context: &Value,
    source_set: &Value,
) -> Result<MavenFailsafeExecution, String> {
    if context["schemaVersion"] != "java-project-context-v4"
        && context["schemaVersion"] != "java-project-context-v5"
        && context["schemaVersion"] != "java-project-context-v6"
        && context["schemaVersion"] != "java-project-context-v7"
    {
        return Err("Maven integration tests require RefactorKit context v4 or later.".into());
    }
    let facts = &source_set["mavenFailsafe"];
    if facts["availability"] != "complete" || !facts["refusalCode"].is_null() {
        return Err("Maven Failsafe execution metadata is incomplete or ambiguous.".into());
    }
    let executions = facts["executions"]
        .as_array()
        .filter(|items| items.len() == 1)
        .ok_or("Maven Failsafe must resolve to exactly one execution.")?;
    let execution = &executions[0];
    if execution["availability"] != "complete"
        || !execution["refusalCode"].is_null()
        || execution["pluginId"] != "org.apache.maven.plugins:maven-failsafe-plugin"
    {
        return Err("The selected Maven Failsafe execution is not complete.".into());
    }
    let plugin_version = bounded_text(&execution["pluginVersion"], 128)?;
    let execution_id = bounded_text(&execution["executionId"], 256)?;
    let phase = bounded_text(&execution["phase"], 256)?;
    let goals = execution["goals"]
        .as_array()
        .filter(|items| !items.is_empty() && items.len() <= 32)
        .ok_or("Maven Failsafe execution goals are unavailable.")?
        .iter()
        .map(|value| bounded_text(value, 256))
        .collect::<Result<Vec<_>, _>>()?;
    if phase != "integration-test"
        || !goals.iter().any(|goal| goal == "integration-test")
        || !goals.iter().any(|goal| goal == "verify")
    {
        return Err("This Failsafe execution has no qualified verify lifecycle mapping.".into());
    }
    for category in ["selectors", "reports"] {
        let values = execution[category]
            .as_array()
            .filter(|items| items.len() <= 128)
            .ok_or("Maven Failsafe configuration is incomplete.")?;
        if values.iter().any(|item| item["availability"] != "complete") {
            return Err("Maven Failsafe configuration contains unresolved values.".into());
        }
    }
    let reports = execution["reports"]
        .as_array()
        .ok_or("Maven Failsafe report metadata is unavailable.")?;
    let report_values: Vec<_> = reports
        .iter()
        .filter(|item| item["name"] == "reportsDirectory")
        .collect();
    if report_values.len() != 1 {
        return Err("Maven Failsafe must declare one concrete reportsDirectory.".into());
    }
    let configured_directory = bounded_text(&report_values[0]["value"], 4096)?;
    if configured_directory.contains(['$', '{', '}'])
        || configured_directory.contains('\\')
        || Path::new(&configured_directory).is_absolute()
        || Path::new(&configured_directory)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(
            "The configured Failsafe report directory is not a concrete project path.".into(),
        );
    }
    let report_path = module_root.join(&configured_directory);
    let relative = report_path
        .strip_prefix(workspace_root)
        .map_err(|_| "The configured Failsafe report directory escapes the workspace.")?;
    let report_directory = relative
        .to_str()
        .filter(|value| !value.is_empty() && value.len() <= 4096)
        .ok_or("The configured Failsafe report directory is invalid.")?
        .replace('\\', "/");
    let checked_report_path = local_path(workspace_root, &json!(report_directory))?;
    if checked_report_path != report_path {
        return Err("The configured Failsafe report directory changed during validation.".into());
    }
    Ok(MavenFailsafeExecution {
        execution_id,
        plugin_version,
        phase,
        goals,
        report_directory,
    })
}

fn bounded_text(value: &Value, maximum: usize) -> Result<String, String> {
    value
        .as_str()
        .filter(|value| {
            !value.is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .ok_or_else(|| "Maven Failsafe execution metadata is invalid.".into())
}

fn gradle_project_path(value: &str) -> bool {
    if value.len() > 4096 || !value.starts_with(':') || value.chars().any(char::is_control) {
        return false;
    }
    if value == ":" {
        return true;
    }
    value[1..].split(':').all(|segment| {
        !segment.is_empty() && segment != "." && segment != ".." && !segment.contains(['/', '\\'])
    })
}

#[cfg(test)]
#[path = "java_execution_context_tests.rs"]
mod tests;

/// Explicit compiler inputs from the provider; this is an execution projection, not a project model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeclaredJdkCompilation {
    pub source_roots: Vec<PathBuf>,
    pub output: PathBuf,
    pub compile_classpath: Vec<PathBuf>,
    pub release: u64,
}

fn declared_jdk_compilation(
    workspace: &Path,
    set: &Value,
) -> Result<DeclaredJdkCompilation, String> {
    if set["compilerOptionsAvailability"] != "complete"
        || set["annotationProcessors"]["availability"] != "complete"
        || set["annotationProcessors"]["mode"] != "none"
    {
        return Err("Declared Java execution needs complete compiler options and disabled annotation processing.".into());
    }
    let options = set["compilerOptions"]
        .as_array()
        .filter(|options| options.len() == 2)
        .ok_or(
            "Declared Java execution requires exactly release and proc:none compiler options.",
        )?;
    if options
        .iter()
        .any(|option| option["redacted"] != false || option["origin"] != "java-declared-project-v1")
    {
        return Err("Declared Java compiler options have no complete provider provenance.".into());
    }
    let releases = options
        .iter()
        .filter(|option| option["name"] == "release")
        .collect::<Vec<_>>();
    let processors = options
        .iter()
        .filter(|option| option["name"] == "proc" && option["value"] == "none")
        .count();
    let release = if releases.len() == 1 && processors == 1 {
        releases[0]["value"]
            .as_str()
            .and_then(|value| value.parse::<u64>().ok())
    } else {
        None
    }
    .filter(|value| (8..=27).contains(value))
    .ok_or("The declared Java release is unavailable.")?;
    if set["release"] != release || set["sourceLevel"] != release {
        return Err("Declared Java compiler and source levels disagree.".into());
    }
    let roots = set["sourceRoots"]
        .as_array()
        .filter(|roots| !roots.is_empty() && roots.len() <= 128)
        .ok_or("Declared Java source roots are unavailable.")?
        .iter()
        .map(|value| local_path(workspace, value))
        .collect::<Result<Vec<_>, _>>()?;
    let generated = set["generatedSourceRoots"]
        .as_array()
        .filter(|roots| roots.len() <= 128)
        .ok_or("Declared generated-source roots are unavailable.")?;
    if generated
        .iter()
        .any(|value| local_path(workspace, value).map_or(true, |path| !roots.contains(&path)))
    {
        return Err(
            "Declared generated roots must be included in the selected source inventory.".into(),
        );
    }
    let outputs = set["outputDirectories"]
        .as_array()
        .filter(|outputs| outputs.len() == 1)
        .ok_or(
            "JDK compilation requires one explicit output directory for the selected source set.",
        )?;
    let output = local_path(workspace, &outputs[0])?;
    if output == workspace || roots.iter().any(|root| root.starts_with(&output)) {
        return Err("A declared compiler output cannot contain the source roots.".into());
    }
    let classpath = set["compileClasspath"]
        .as_array()
        .filter(|paths| paths.len() <= 4096)
        .ok_or("Declared compile classpath is unavailable.")?
        .iter()
        .map(|entry| {
            let value = entry["path"]
                .as_str()
                .filter(|value| !value.is_empty() && value.len() <= 4096 && !value.contains('\0'))
                .ok_or("Invalid declared compile classpath.")?;
            let path = if Path::new(value).is_absolute() {
                PathBuf::from(value)
            } else {
                local_path(workspace, &entry["path"])?
            };
            if path != output && !path.is_dir() && !path.is_file() {
                return Err(
                    "A declared compiler dependency is unavailable; build the dependency first."
                        .into(),
                );
            }
            Ok(path)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(DeclaredJdkCompilation {
        source_roots: roots,
        output,
        compile_classpath: classpath,
        release,
    })
}
