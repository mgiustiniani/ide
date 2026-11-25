use super::*;
use sha2::Digest;
use std::fs;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let root = std::env::temp_dir().join(format!(
            "ide-project-launch-{}",
            random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        ));
        fs::create_dir_all(root.join("app/target/classes")).unwrap();
        fs::write(root.join("dependency.jar"), b"fixture").unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn selection(&self) -> JavaExecutionProjectSelection {
        serde_json::from_value(json!({"context":{"projectPath":"","sdkHome":self.0,
            "mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],
            "snapshotHash":"a".repeat(64),"contextHash":"b".repeat(64),"platformIdentities":["c".repeat(64)]},
            "providerId":"maven-effective-v1","moduleId":"app","sourceSetId":"main"})).unwrap()
    }
    fn context(&self) -> Value {
        json!({"modules":[{"providerId":"maven-effective-v1","id":"app","root":"app",
            "sourceSets":[{"id":"main","kind":"main","outputDirectories":["app/target/classes","app/build/classes/java/main"],
            "runtimeClasspath":[{"path":"dependency.jar"},{"path":self.0.join("dependency.jar")}],"moduleDependencies":[]},
            {"id":"test","kind":"test","outputDirectories":["app/target/test-classes"],"runtimeClasspath":[],"moduleDependencies":[]}]}]})
    }

    fn v4_maven_integration_context(&self) -> Value {
        let mut context = self.context();
        context["schemaVersion"] = json!("java-project-context-v4");
        context["modules"][0]["sourceSets"].as_array_mut().unwrap().push(json!({
            "id":"integrationTest",
            "kind":"integration-test",
            "outputDirectories":["app/target/integration-test-classes"],
            "runtimeClasspath":[{"path":"dependency.jar"}],
            "moduleDependencies":[],
            "mavenFailsafe":{
                "availability":"complete",
                "refusalCode":null,
                "executions":[{
                    "pluginId":"org.apache.maven.plugins:maven-failsafe-plugin",
                    "pluginVersion":"3.5.2",
                    "executionId":"run-tests",
                    "goals":["integration-test","verify"],
                    "phase":"integration-test",
                    "profileId":"quality",
                    "selectors":[{"name":"includes","value":"**/*IT.java","origin":"profile-execution:quality","availability":"complete"}],
                    "reports":[
                        {"name":"reportsDirectory","value":"target/failsafe-reports","origin":"profile-execution:quality","availability":"complete"},
                        {"name":"reportFormat","value":"plain","origin":"profile-execution:quality","availability":"complete"}
                    ],
                    "availability":"complete",
                    "refusalCode":null
                }]
            }
        }));
        context
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn launch_projection_uses_only_the_selected_source_set_and_provider_order() {
    let f = Fixture::new();
    let selected = project_paths(&f.0, &f.0, &f.0, &f.context(), &f.selection(), true).unwrap();
    assert_eq!(selected.module_root, f.0.join("app"));
    assert_eq!(selected.build_tool, "maven");
    assert_eq!(selected.source_set_kind, "main");
    assert_eq!(
        selected.runtime_classpath,
        vec![f.0.join("app/target/classes"), f.0.join("dependency.jar")]
    );
}

#[test]
fn root_module_launch_paths_use_the_canonical_directory_string() {
    let f = Fixture::new();
    for provider in ["maven-effective-v1", "gradle-effective-v1"] {
        for root in ["", "."] {
            let mut context = f.context();
            context["modules"][0]["providerId"] = json!(provider);
            context["modules"][0]["root"] = json!(root);
            let mut selection = f.selection();
            selection.provider_id = provider.into();
            let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, true).unwrap();
            // Gradle compares the serialized module directory with canonicalPath.
            // Path equality alone hides a trailing separator or a dot component.
            assert_eq!(resolved.module_root.as_os_str(), f.0.as_os_str());
        }
    }
}

#[test]
fn v3_execution_paths_resolve_from_workspace_root_for_composite_gradle_modules() {
    let f = Fixture::new();
    fs::create_dir_all(f.0.join("app")).unwrap();
    fs::create_dir_all(f.0.join("external-project-dir/classes")).unwrap();
    fs::create_dir_all(f.0.join("shared/sources")).unwrap();
    let mut context = f.context();
    context["schemaVersion"] = json!("java-project-context-v3");
    context["modules"][0]["providerId"] = json!("gradle-effective-v1");
    context["modules"][0]["id"] = json!("gradle-bbb::lib");
    context["modules"][0]["name"] = json!("lib");
    context["modules"][0]["buildRoot"] = json!("included-build");
    context["modules"][0]["projectPath"] = json!(":lib");
    context["modules"][0]["root"] = json!("external-project-dir");
    context["modules"][0]["sourceSets"][0]["sourceRoots"] = json!(["shared/sources"]);
    context["modules"][0]["sourceSets"][0]["outputDirectories"] =
        json!(["external-project-dir/classes"]);
    context["modules"][0]["sourceSets"][0]["runtimeClasspath"] = json!([
        {"path":"external-project-dir/classes"},
        {"path":f.0.join("dependency.jar")}
    ]);
    context["modules"][0]["sourceSets"][1]["outputDirectories"] =
        json!(["external-project-dir/test-classes"]);
    let mut selection = f.selection();
    selection.context.project_path = "app".into();
    selection.provider_id = "gradle-effective-v1".into();
    selection.module_id = "gradle-bbb::lib".into();

    let selected_project_root = f.0.join("app");
    let resolved = project_paths(
        &f.0,
        &selected_project_root,
        &f.0,
        &context,
        &selection,
        true,
    )
    .unwrap();
    assert_eq!(resolved.root, selected_project_root);
    assert_eq!(resolved.module_root, f.0.join("external-project-dir"));
    assert_eq!(
        resolved.output_directories,
        vec![f.0.join("external-project-dir/classes")]
    );
    assert_eq!(
        resolved.runtime_classpath,
        vec![
            f.0.join("external-project-dir/classes"),
            f.0.join("dependency.jar")
        ]
    );
}

#[test]
fn execution_selection_accepts_v3_v4_and_rejects_unknown_project_context_schemas() {
    let f = Fixture::new();
    let mut selection = f.selection();
    assert!(validate_selection_context(&selection).is_ok());
    selection.context.context_schema_version = "java-project-context-v3".into();
    assert!(validate_selection_context(&selection).is_ok());
    selection.context.context_schema_version = "java-project-context-v4".into();
    assert!(validate_selection_context(&selection).is_ok());
    selection.context.context_schema_version = "java-project-context-v5".into();
    assert!(validate_selection_context(&selection).is_ok());
    selection.context.context_schema_version = "java-project-context-v6".into();
    assert!(validate_selection_context(&selection).is_ok());
    selection.context.context_schema_version = "java-project-context-v7".into();
    assert!(validate_selection_context(&selection).is_ok());
}

#[test]
fn v4_maven_integration_projection_uses_only_declared_failsafe_execution_and_report_path() {
    let f = Fixture::new();
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    selection.context.context_schema_version = "java-project-context-v4".into();
    let context = f.v4_maven_integration_context();

    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, false).unwrap();

    let failsafe = resolved.maven_failsafe.unwrap();
    assert_eq!(failsafe.execution_id, "run-tests");
    assert_eq!(failsafe.plugin_version, "3.5.2");
    assert_eq!(failsafe.phase, "integration-test");
    assert_eq!(
        failsafe.goals,
        ["integration-test".to_owned(), "verify".to_owned()]
    );
    assert_eq!(failsafe.report_directory, "app/target/failsafe-reports");
}

#[test]
fn v5_maven_integration_projection_preserves_the_selected_failsafe_declaration() {
    let f = Fixture::new();
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    selection.context.context_schema_version = "java-project-context-v5".into();
    let mut context = f.v4_maven_integration_context();
    context["schemaVersion"] = json!("java-project-context-v5");
    for source_set in context["modules"][0]["sourceSets"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
    {
        source_set
            .as_object_mut()
            .unwrap()
            .entry("mavenFailsafe")
            .or_insert_with(|| {
                json!({
                    "availability":"not-applicable",
                    "refusalCode":null,
                    "executions":[]
                })
            });
    }

    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, false).unwrap();

    let failsafe = resolved.maven_failsafe.unwrap();
    assert_eq!(failsafe.execution_id, "run-tests");
    assert_eq!(failsafe.plugin_version, "3.5.2");
    assert_eq!(failsafe.report_directory, "app/target/failsafe-reports");
}

#[test]
fn v6_metadata_context_keeps_declared_maven_failsafe_mapping_without_source_analysis() {
    let f = Fixture::new();
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    selection.context.context_schema_version = "java-project-context-v6".into();
    let mut context = f.v4_maven_integration_context();
    context["schemaVersion"] = json!("java-project-context-v6");
    context["analysis"] = Value::Null;
    context["semanticAnalysis"] = json!({
        "availability":"unqualified",
        "refusalCode":"java.context.sourceAnalysisUnqualified"
    });
    context["selectedSource"] = Value::Null;

    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, false).unwrap();

    let failsafe = resolved.maven_failsafe.unwrap();
    assert_eq!(failsafe.execution_id, "run-tests");
    assert_eq!(failsafe.report_directory, "app/target/failsafe-reports");
}

#[test]
fn v7_metadata_context_retains_validated_surefire_and_failsafe_facts_for_execution() {
    let f = Fixture::new();
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    selection.context.context_schema_version = "java-project-context-v7".into();
    let mut context = f.v4_maven_integration_context();
    context["schemaVersion"] = json!("java-project-context-v7");
    context["analysis"] = Value::Null;
    context["semanticAnalysis"] = json!({
        "availability":"unqualified",
        "refusalCode":"java.context.sourceAnalysisUnqualified"
    });
    context["selectedSource"] = Value::Null;
    for source_set in context["modules"][0]["sourceSets"].as_array_mut().unwrap() {
        source_set["mavenTestJvm"] = if source_set["kind"] == "main" {
            json!({"availability":"not-applicable","mode":"unknown","refusalCode":null,"executions":[]})
        } else {
            let (plugin_id, goals, phase) = if source_set["kind"] == "test" {
                (
                    "org.apache.maven.plugins:maven-surefire-plugin",
                    json!(["test"]),
                    "test",
                )
            } else {
                (
                    "org.apache.maven.plugins:maven-failsafe-plugin",
                    json!(["integration-test", "verify"]),
                    "integration-test",
                )
            };
            json!({"availability":"complete","mode":"forked","refusalCode":null,
                "executions":[{"pluginId":plugin_id,"pluginVersion":"3.5.3","executionId":"default-test",
                    "goals":goals,"phase":phase,"mode":"forked","availability":"complete","refusalCode":null,
                    "forkSettings":[],"argLineLayers":[],"effectiveArgLineTemplate":null}]})
        };
    }

    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, false).unwrap();
    assert_eq!(
        resolved.project_context_schema_version,
        "java-project-context-v7"
    );
    let maven_modules = resolved.maven_test_jvm_modules.unwrap();
    assert_eq!(maven_modules.len(), 1);
    assert_eq!(maven_modules[0].module_id, "app");
    assert_eq!(maven_modules[0].source_sets.len(), 3);
    assert_eq!(maven_modules[0].source_sets[1].id, "test");
    assert_eq!(maven_modules[0].source_sets[1].test_jvm["mode"], "forked");
    assert_eq!(resolved.maven_failsafe.unwrap().execution_id, "run-tests");
}

#[test]
fn test_jvm_selection_must_supplement_the_same_context_and_executions() {
    let base = json!({"contextHash":"original", "modules":[{
        "providerId":"maven-effective-v1", "id":"app", "sourceSets":[{
            "id":"test", "mavenTestJvm":{"executions":[{"executionId":"default-test"}]}
        }]
    }]});
    let mut enriched = base.clone();
    enriched["modules"][0]["sourceSets"][0]["mavenTestJvm"]["executions"][0]["jvmSelection"] = json!({
        "kind":"build-jvm", "availability":"complete", "origin":"plugin-default:pom.xml", "executable":null,
        "requirements":{}, "redacted":false, "refusalCode":null
    });
    let facts = maven_test_jvm_selections(&base, enriched.clone(), false).unwrap();
    assert_eq!(facts[&("app".into(), "test".into())], vec![MavenTestJvmSelection::BuildJvm]);
    assert!(maven_test_jvm_selections(&base, base.clone(), false).is_err());

    let mut changed_context = enriched.clone();
    changed_context["contextHash"] = json!("changed");
    assert!(maven_test_jvm_selections(&base, changed_context, false).is_err());
    let mut changed_execution = enriched.clone();
    changed_execution["modules"][0]["sourceSets"][0]["mavenTestJvm"]["executions"][0]["executionId"] = json!("other-test");
    assert!(maven_test_jvm_selections(&base, changed_execution, false).is_err());
    enriched["modules"][0]["sourceSets"][0]["mavenTestJvm"]["executions"][0]["jvmSelection"]["redacted"] = json!(true);
    assert!(maven_test_jvm_selections(&base, enriched, false).is_err());
}

#[test]
fn unresolved_toolchain_prerequisite_does_not_replace_explicit_fork_selection() {
    let mut selection = json!({
        "kind":"explicit-executable", "availability":"complete", "origin":"pom.xml/configuration/jvm",
        "executable":"/jdk-21/bin/java", "requirements":{}, "redacted":false, "refusalCode":null
    });
    assert!(decode_maven_test_jvm_selection(selection.clone(), true).is_none());
    selection["toolchainPrerequisite"] = json!({
        "availability":"unavailable", "origin":"pom.xml/configuration/jdkToolchain",
        "requirements":{"version":"1.8"}, "redacted":false,
        "refusalCode":"java.context.mavenTestJvmToolchainUnresolved"
    });
    assert_eq!(
        decode_maven_test_jvm_selection(selection.clone(), true),
        Some(MavenTestJvmSelection::ExplicitExecutable(PathBuf::from("/jdk-21/bin/java"))),
    );
    assert!(decode_maven_test_jvm_selection(selection.clone(), false).is_none());
    selection["toolchainPrerequisite"]["availability"] = json!("complete");
    assert!(decode_maven_test_jvm_selection(selection.clone(), true).is_none());
    selection["toolchainPrerequisite"] = Value::Null;
    assert!(decode_maven_test_jvm_selection(selection, true).is_some());
}

#[test]
fn v7_maven_test_jvm_facts_cover_the_selected_module_dependency_closure() {
    let source_set = |dependencies: &[&str]| {
        json!({
            "id":"test",
            "kind":"test",
            "moduleDependencies":dependencies.iter().map(|module_id| json!({"moduleId":module_id})).collect::<Vec<_>>(),
            "mavenTestJvm":{"availability":"complete","mode":"forked","refusalCode":null,
                "executions":[{"pluginId":"org.apache.maven.plugins:maven-surefire-plugin",
                    "pluginVersion":"3.5.4","executionId":"default-test","goals":["test"],
                    "phase":"test","mode":"forked","availability":"complete","refusalCode":null,
                    "forkSettings":[],"argLineLayers":[],"effectiveArgLineTemplate":null}]},
            "mavenFailsafe":{"availability":"not-declared","refusalCode":null,"executions":[]}
        })
    };
    let context = json!({"modules":[
        {"providerId":"maven-effective-v1","id":"app","sourceSets":[source_set(&["library"])]},
        {"providerId":"maven-effective-v1","id":"library","sourceSets":[source_set(&["runtime"])]},
        {"providerId":"maven-effective-v1","id":"runtime","sourceSets":[source_set(&[])]},
        {"providerId":"maven-effective-v1","id":"unrelated","sourceSets":[source_set(&[])]}
    ]});

    let closure = maven_test_jvm_facts_for_invocation(&context, "app", false, Path::new(".")).unwrap();
    let module_ids = closure
        .iter()
        .map(|module| module.module_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(module_ids, ["app", "library", "runtime"].into());

    let all_modules = maven_test_jvm_facts_for_invocation(&context, "app", true, Path::new(".")).unwrap();
    assert_eq!(all_modules.len(), 4);

    let mut missing_edge = context.clone();
    missing_edge["modules"][0]["sourceSets"][0]["moduleDependencies"][0]["moduleId"] =
        json!("missing");
    assert!(maven_test_jvm_facts_for_invocation(&missing_edge, "app", false, Path::new(".")).is_none());
}

#[test]
fn v4_maven_integration_projection_refuses_partial_or_unresolved_failsafe_facts() {
    let f = Fixture::new();
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    selection.context.context_schema_version = "java-project-context-v4".into();
    let mut context = f.v4_maven_integration_context();
    context["modules"][0]["sourceSets"][2]["mavenFailsafe"]["availability"] = json!("partial");
    assert!(project_paths(&f.0, &f.0, &f.0, &context, &selection, false)
        .unwrap_err()
        .contains("incomplete"));

    let mut context = f.v4_maven_integration_context();
    context["modules"][0]["sourceSets"][2]["mavenFailsafe"]["executions"][0]["reports"][0]
        ["value"] = json!("${project.build.directory}/failsafe-reports");
    assert!(project_paths(&f.0, &f.0, &f.0, &context, &selection, false)
        .unwrap_err()
        .contains("concrete project path"));
}

#[test]
fn gradle_build_tree_path_is_scoped_to_the_evaluated_composite() {
    let f = Fixture::new();
    let mut context = f.context();
    context["schemaVersion"] = json!("java-project-context-v3");
    let module = &mut context["modules"][0];
    module["providerId"] = json!("gradle-effective-v1");
    module["buildRoot"] = json!("parent/leaf-dir");
    module["projectPath"] = json!(":app");
    let mut selection = f.selection();
    selection.provider_id = "gradle-effective-v1".into();
    let resolve = |context: &Value| project_paths(&f.0, &f.0, &f.0, context, &selection, false);
    let legacy = resolve(&context).unwrap();
    assert_eq!(legacy.gradle_invocation_root(), f.0.join("parent/leaf-dir"));
    assert_eq!(legacy.gradle_task_project_path(), Some(":app"));
    context["modules"][0]["buildTreeProjectPath"] = json!(":parentAlias:leafAlias:app");
    let composite = resolve(&context).unwrap();
    assert_eq!(composite.gradle_invocation_root(), f.0);
    assert_eq!(composite.gradle_task_project_path(), Some(":parentAlias:leafAlias:app"));
    for path in [":app", ":parentAlias:other", ":parentAlias:../app", ":parentAlias::app"] {
        context["modules"][0]["buildTreeProjectPath"] = json!(path);
        assert!(resolve(&context).is_err(), "accepted {path}");
    }
}

#[test]
fn gradle_project_path_uses_logical_segments_and_rejects_filesystem_paths() {
    assert!(gradle_project_path(":"));
    assert!(gradle_project_path(":included:lib"));
    assert!(!gradle_project_path("included/lib"));
    assert!(!gradle_project_path(":included::lib"));
    assert!(!gradle_project_path(":../lib"));
}

#[test]
fn launch_projection_refuses_ambiguous_modules_and_source_sets() {
    let f = Fixture::new();
    let mut c = f.context();
    let duplicate = c["modules"][0].clone();
    c["modules"].as_array_mut().unwrap().push(duplicate);
    assert!(project_paths(&f.0, &f.0, &f.0, &c, &f.selection(), false)
        .unwrap_err()
        .contains("ambiguous"));
    let mut c = f.context();
    let item = c["modules"][0]["sourceSets"][0].clone();
    c["modules"][0]["sourceSets"]
        .as_array_mut()
        .unwrap()
        .push(item);
    assert!(project_paths(&f.0, &f.0, &f.0, &c, &f.selection(), false)
        .unwrap_err()
        .contains("ambiguous"));
}

#[test]
fn provider_identity_selects_a_module_when_provider_ids_collide() {
    let f = Fixture::new();
    fs::create_dir_all(f.0.join("other/target/classes")).unwrap();
    let mut context = f.context();
    let mut other_provider = context["modules"][0].clone();
    other_provider["providerId"] = json!("gradle-effective-v1");
    other_provider["root"] = json!("other");
    other_provider["sourceSets"][0]["outputDirectories"] = json!(["other/target/classes"]);
    context["modules"]
        .as_array_mut()
        .unwrap()
        .push(other_provider);

    let mut selection = f.selection();
    selection.provider_id = "gradle-effective-v1".into();
    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, true).unwrap();
    assert_eq!(resolved.build_tool, "gradle");
    assert_eq!(resolved.module_root, f.0.join("other"));
    assert_eq!(
        resolved.output_directories,
        vec![f.0.join("other/target/classes")]
    );

    let selected_test = test_selection(&context, &selection, false).unwrap();
    assert_eq!(selected_test.provider_id, "gradle-effective-v1");
    assert_eq!(selected_test.source_set_id, "test");
}
#[test]
fn launch_projection_rejects_escaping_outputs_and_missing_runtime_dependencies() {
    let f = Fixture::new();
    let mut c = f.context();
    c["modules"][0]["sourceSets"][0]["outputDirectories"][0] = json!("../outside");
    assert!(project_paths(&f.0, &f.0, &f.0, &c, &f.selection(), true).is_err());
    let mut c = f.context();
    c["modules"][0]["sourceSets"][0]["runtimeClasspath"][0]["path"] = json!("missing.jar");
    assert!(project_paths(&f.0, &f.0, &f.0, &c, &f.selection(), true)
        .unwrap_err()
        .contains("unavailable"));
}
#[test]
fn launch_projection_allows_missing_outputs_before_build_but_never_fabricates_them_afterward() {
    let f = Fixture::new();
    let mut selection = f.selection();
    selection.source_set_id = "test".into();
    assert!(
        project_paths(&f.0, &f.0, &f.0, &f.context(), &selection, false)
            .unwrap()
            .runtime_classpath
            .is_empty()
    );
    assert!(
        project_paths(&f.0, &f.0, &f.0, &f.context(), &selection, true)
            .unwrap_err()
            .contains("no compiled output")
    );
}

#[test]
fn launch_projection_preserves_declared_empty_resource_outputs_but_refuses_missing_jars() {
    let f = Fixture::new();
    let mut context = f.context();
    let resources = "app/build/resources/main";
    context["modules"][0]["sourceSets"][0]["outputDirectories"]
        .as_array_mut()
        .unwrap()
        .push(json!(resources));
    context["modules"][0]["sourceSets"][0]["runtimeClasspath"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":resources}));
    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &f.selection(), true).unwrap();
    assert!(resolved.runtime_classpath.contains(&f.0.join(resources)));
    context["modules"][0]["sourceSets"][0]["runtimeClasspath"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"absent.jar"}));
    assert!(project_paths(&f.0, &f.0, &f.0, &context, &f.selection(), true).is_err());
}

#[test]
fn debugger_roots_follow_provider_outputs_in_the_runtime_classpath() {
    let f = Fixture::new();
    for directory in [
        "app/src/main/java",
        "app/src/test/java",
        "app/generated",
        "library/src/main/java",
        "library/classes",
        "unrelated/src/main/java",
        "unrelated/classes",
    ] {
        fs::create_dir_all(f.0.join(directory)).unwrap();
    }
    let mut context = f.context();
    context["modules"][0]["sourceSets"][0]["sourceRoots"] = json!(["app/src/main/java"]);
    context["modules"][0]["sourceSets"][0]["generatedSourceRoots"] = json!(["app/generated"]);
    context["modules"][0]["sourceSets"][1]["sourceRoots"] = json!(["app/src/test/java"]);
    context["modules"][0]["sourceSets"][0]["runtimeClasspath"]
        .as_array_mut()
        .unwrap()
        .push(json!({"path":"library/classes"}));
    for module in ["library", "unrelated"] {
        context["modules"].as_array_mut().unwrap().push(json!({"id":module,"sourceSets":[{"id":"main","outputDirectories":[format!("{module}/classes")],"sourceRoots":[format!("{module}/src/main/java")]}]}));
    }
    assert_eq!(
        project_paths(&f.0, &f.0, &f.0, &context, &f.selection(), true)
            .unwrap()
            .debugger_source_roots,
        vec![
            f.0.join("app/src/main/java"),
            f.0.join("app/generated"),
            f.0.join("library/src/main/java")
        ]
    );
}

#[test]
fn gradle_debugger_uses_only_the_project_archive_producer_in_the_runtime_classpath() {
    let f = Fixture::new();
    let provider = "gradle-effective-v1";
    let mut selection = f.selection();
    selection.provider_id = provider.into();
    let mut context = f.context();
    context["schemaVersion"] = json!("java-project-context-v3");
    context["providers"] = json!([{"providerId": provider, "status": "available"}]);
    let app = &mut context["modules"][0];
    app["providerId"] = json!(provider);
    app["buildRoot"] = json!(".");
    app["projectPath"] = json!(":app");
    app["sourceSets"][0]["moduleDependencies"] =
        json!([{"moduleId":"first::lib","scope":"compile"}]);
    for id in ["first::lib", "second::lib"] {
        let directory = if id == "first::lib" {
            "included"
        } else {
            "other"
        };
        fs::create_dir_all(f.0.join(directory)).unwrap();
        context["modules"].as_array_mut().unwrap().push(json!({
            "id": id, "providerId": provider, "sourceSets": [
                {"id":"production", "kind":"main", "outputDirectories":[],
                 "sourceRoots":[directory]}
            ]
        }));
    }
    let entry = json!({"path":"dependency.jar", "providerId":provider, "moduleId":"first::lib",
        "sourceSetId":"production", "fingerprint":"a".repeat(64), "dependencyScope":"compile"});
    let resolve = |context: &Value, require_runtime| {
        project_paths(&f.0, &f.0, &f.0, context, &selection, require_runtime)
            .unwrap()
            .debugger_source_roots
    };
    let rows = |context: &mut Value, entries| {
        context["modules"][0]["sourceSets"][0]["runtimeClasspath"] = entries;
    };
    rows(&mut context, json!([entry, entry]));
    assert_eq!(resolve(&context, true), [f.0.join("included")]);
    let mut wrong_owner = entry.clone();
    wrong_owner["moduleId"] = json!("second::lib");
    wrong_owner["dependencyScope"] = Value::Null;
    rows(&mut context, json!([wrong_owner]));
    assert!(resolve(&context, true).is_empty());
    let mut two_producers = context.clone();
    two_producers["modules"][0]["sourceSets"][0]["moduleDependencies"]
        .as_array_mut()
        .unwrap()
        .push(json!({"moduleId":"second::lib","scope":"runtime"}));
    wrong_owner["dependencyScope"] = json!("runtime");
    rows(&mut two_producers, json!([wrong_owner]));
    assert!(resolve(&two_producers, true).is_empty());
    for (field, wrong) in [
        ("providerId", json!("maven-effective-v1")),
        ("moduleId", json!("second::lib")),
        ("sourceSetId", json!("other")),
        ("fingerprint", json!("b".repeat(64))),
        ("fingerprint", json!("missing")),
    ] {
        let mut conflict = entry.clone();
        conflict["path"] = json!(f.0.join("dependency.jar"));
        conflict[field] = wrong;
        rows(&mut context, json!([entry, conflict]));
        assert!(resolve(&context, true).is_empty(), "conflict in {field}");
    }
    rows(&mut context, json!([entry]));
    let mut duplicate_owner = context.clone();
    let duplicate = duplicate_owner["modules"][1].clone();
    duplicate_owner["modules"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(resolve(&duplicate_owner, true).is_empty());
    let mut legacy = context.clone();
    legacy["schemaVersion"] = json!("java-project-context-v2");
    assert!(resolve(&legacy, true).is_empty());
    context["providers"][0]["status"] = json!("partial");
    assert!(resolve(&context, true).is_empty());
    context["providers"][0]["status"] = json!("available");
    for wrong in [
        json!({"providerId":provider, "moduleId":"app", "sourceSetId":"main"}),
        json!({"fingerprint":"missing"}),
        json!({"path":f.0.parent().unwrap().join("external.jar")}),
    ] {
        let mut external = entry.clone();
        external
            .as_object_mut()
            .unwrap()
            .extend(wrong.as_object().unwrap().clone());
        rows(&mut context, json!([external]));
        assert!(resolve(&context, false).is_empty());
    }
    let mut unbuilt = entry.clone();
    unbuilt["path"] = json!("custom-output/nested/renamed-artifact");
    unbuilt["fingerprint"] = json!("missing");
    rows(&mut context, json!([unbuilt]));
    assert_eq!(resolve(&context, false), [f.0.join("included")]);
    let mut shared_output = context.clone();
    for module in &mut shared_output["modules"].as_array_mut().unwrap()[1..] {
        module["sourceSets"][0]["outputDirectories"] = json!([unbuilt["path"]]);
    }
    assert!(resolve(&shared_output, false).is_empty());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(f.0.parent().unwrap(), f.0.join("custom-output")).unwrap();
        assert!(resolve(&context, false).is_empty());
    }
}

#[test]
fn test_debugger_captures_runtime_sources_before_the_build_tool_compiles() {
    let f = Fixture::new();
    for directory in ["app/src/main/java", "app/src/test/java", "sibling/src/main/java", "shadow/src/main/java"] {
        fs::create_dir_all(f.0.join(directory)).unwrap();
    }
    let mut context = f.context();
    let sets = &mut context["modules"][0]["sourceSets"];
    sets[0]["sourceRoots"] = json!(["app/src/main/java"]);
    sets[1]["sourceRoots"] = json!(["app/src/test/java"]);
    sets[1]["runtimeClasspath"] = json!([
        {"path": "app/target/classes"}, {"path": f.0.join("shared/classes")}
    ]);
    for id in ["sibling", "shadow"] {
        context["modules"].as_array_mut().unwrap().push(json!({
            "id": id, "providerId": "maven-effective-v1",
            "sourceSets": [{"id": "main", "outputDirectories": ["shared/classes"],
                "sourceRoots": [format!("{id}/src/main/java")]}]
        }));
    }
    let mut selection = f.selection();
    selection.source_set_id = "test".into();
    let resolved = project_paths(&f.0, &f.0, &f.0, &context, &selection, false).unwrap();
    assert_eq!(resolved.debugger_source_roots, vec![f.0.join("app/src/main/java"), f.0.join("app/src/test/java")]);
    assert!(resolved.runtime_classpath.is_empty());
}

#[test]
fn test_operations_use_the_published_test_scope_without_guessing_its_identity() {
    let f = Fixture::new();
    let mut context = f.context();
    context["modules"][0]["sourceSets"][1]["id"] = json!("provider-owned-test-id");
    let selected = test_selection(&context, &f.selection(), false).unwrap();
    assert_eq!(selected.source_set_id, "provider-owned-test-id");
    assert_eq!(
        selected.context.context_hash,
        f.selection().context.context_hash
    );
    assert_eq!(
        test_selection(&context, &selected, false)
            .unwrap()
            .source_set_id,
        selected.source_set_id
    );
    let duplicate = context["modules"][0]["sourceSets"][1].clone();
    context["modules"][0]["sourceSets"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(test_selection(&context, &f.selection(), false).is_err());
    context["modules"][0]["sourceSets"]
        .as_array_mut()
        .unwrap()
        .truncate(1);
    assert!(test_selection(&context, &f.selection(), false).is_err());
}

#[test]
fn custom_test_source_sets_require_a_gradle_evaluation() {
    let f = Fixture::new();
    let mut context = f.context();
    context["modules"][0]["sourceSets"][0]["id"] = json!("integrationTest");
    context["modules"][0]["sourceSets"][0]["kind"] = json!("custom");
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    assert!(test_selection(&context, &selection, false).is_err());
    assert_eq!(
        test_selection(&context, &selection, true)
            .unwrap()
            .source_set_id,
        "integrationTest"
    );
}

#[test]
fn maven_integration_test_source_sets_are_valid_test_selections() {
    let f = Fixture::new();
    let mut context = f.context();
    context["modules"][0]["sourceSets"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id": "integrationTest",
            "kind": "integration-test",
            "outputDirectories": ["app/target/test-classes"],
            "runtimeClasspath": []
        }));
    let mut selection = f.selection();
    selection.source_set_id = "integrationTest".into();
    assert_eq!(
        test_selection(&context, &selection, false)
            .unwrap()
            .source_set_id,
        "integrationTest"
    );
}

#[test]
fn jpms_module_launch_uses_only_complete_current_provider_facts() {
    let fixture = Fixture::new();
    let module_root = fixture.0.join("app");
    let descriptor_path = module_root.join("src/main/java/module-info.java");
    fs::create_dir_all(descriptor_path.parent().unwrap()).unwrap();
    let descriptor = "module example.app { exports example.app; }\n";
    fs::write(&descriptor_path, descriptor).unwrap();
    fs::write(
        fixture.0.join("app/target/classes/module-info.class"),
        b"fixture",
    )
    .unwrap();
    let resources_output = fixture.0.join("app/target/resources");
    fs::create_dir_all(&resources_output).unwrap();
    let hash = format!("{:x}", sha2::Sha256::digest(descriptor.as_bytes()));
    let dependency = fixture.0.join("dependency.jar");
    let source_set = json!({
        "id":"main", "kind":"main", "jpms":{
            "availability":"complete", "refusalCode":null,
            "modulePath":[{"path":dependency,"moduleNames":["fixture.dependency"],"fingerprint":"artifact:fixture"}],
            "descriptors":[{"path":"app/src/main/java/module-info.java","moduleName":"example.app",
                "contentSha256":hash}]
        }
    });
    let outputs = vec![
        fixture.0.join("app/target/classes"),
        resources_output.clone(),
    ];
    let (module, descriptor_hash, module_path_identity, path) =
        jpms_module_facts(&fixture.0, &module_root, &source_set, &outputs, true).unwrap();
    assert_eq!(module.as_deref(), Some("example.app"));
    assert_eq!(descriptor_hash.as_deref(), Some(hash.as_str()));
    assert_eq!(
        module_path_identity,
        Some(vec![(
            dependency.to_string_lossy().into_owned(),
            vec!["fixture.dependency".into()],
            Some("artifact:fixture".into())
        )])
    );
    assert_eq!(path.len(), 2);
    assert!(path.contains(&outputs[0].canonicalize().unwrap()));
    assert!(!path.contains(&resources_output.canonicalize().unwrap()));
    assert!(path.contains(&dependency.canonicalize().unwrap()));

    let mut partial = source_set.clone();
    partial["jpms"]["availability"] = json!("partial");
    assert!(jpms_module_facts(&fixture.0, &module_root, &partial, &outputs, true).is_err());
    let mut stale = source_set;
    stale["jpms"]["descriptors"][0]["contentSha256"] = json!("0".repeat(64));
    assert!(jpms_module_facts(&fixture.0, &module_root, &stale, &outputs, true).is_err());

    let mut ambiguous = json!({
        "id":"main", "kind":"main", "jpms":{
            "availability":"complete", "refusalCode":null,
            "modulePath":[
                {"path":dependency,"moduleNames":["fixture.dependency"],"fingerprint":"artifact:one"},
                {"path":dependency,"moduleNames":["fixture.dependency"],"fingerprint":"artifact:two"}
            ],
            "descriptors":[{"path":"app/src/main/java/module-info.java","moduleName":"example.app",
                "contentSha256":hash}]
        }
    });
    assert!(jpms_module_facts(&fixture.0, &module_root, &ambiguous, &outputs, true).is_err());
    ambiguous["jpms"]["modulePath"] = json!([]);
    let descriptor = ambiguous["jpms"]["descriptors"][0].clone();
    ambiguous["jpms"]["descriptors"]
        .as_array_mut()
        .unwrap()
        .push(descriptor);
    assert!(jpms_module_facts(&fixture.0, &module_root, &ambiguous, &outputs, true).is_err());
}

fn declared_compiler_fixture() -> Value {
    json!({"release":17,"sourceLevel":17,"compilerOptionsAvailability":"complete",
        "compilerOptions":[{"name":"release","value":"17","origin":"java-declared-project-v1","redacted":false},{"name":"proc","value":"none","origin":"java-declared-project-v1","redacted":false}],
        "annotationProcessors":{"availability":"complete","mode":"none"},
        "sourceRoots":["app/src"],"generatedSourceRoots":[],"outputDirectories":["app/target/classes"],"compileClasspath":[{"path":"dependency.jar"}]})
}
#[test]
fn declared_jdk_execution_projects_complete_explicit_compiler_inputs() {
    let fixture = Fixture::new();
    let set = declared_compiler_fixture();
    let declaration = declared_jdk_compilation(&fixture.0, &set).unwrap();
    assert_eq!(declaration.release, 17);
    assert_eq!(declaration.source_roots, vec![fixture.0.join("app/src")]);
    assert_eq!(declaration.output, fixture.0.join("app/target/classes"));
    assert_eq!(
        declaration.compile_classpath,
        vec![fixture.0.join("dependency.jar")]
    );
}
#[test]
fn declared_jdk_runtime_projection_preserves_order_before_build_without_implicit_outputs() {
    let fixture = Fixture::new();
    let mut context = fixture.context();
    context["modules"][0]["providerId"] = json!("java-declared-v1");
    let mut set = declared_compiler_fixture();
    set["id"] = json!("main");
    set["kind"] = json!("main");
    set["runtimeClasspath"] = json!([{"path":"dependency.jar"},{"path":"app/target/classes"}]);
    context["modules"][0]["sourceSets"] = json!([set]);
    let mut selection = fixture.selection();
    selection.provider_id = "java-declared-v1".into();
    let expected = vec![
        fixture.0.join("dependency.jar"),
        fixture.0.join("app/target/classes"),
    ];
    for after_build in [false, true] {
        assert_eq!(
            project_paths(
                &fixture.0,
                &fixture.0,
                &fixture.0,
                &context,
                &selection,
                after_build
            )
            .unwrap()
            .runtime_classpath,
            expected
        );
    }
    fs::remove_dir(fixture.0.join("app/target/classes")).unwrap();
    assert_eq!(
        project_paths(&fixture.0, &fixture.0, &fixture.0, &context, &selection, false)
            .unwrap()
            .runtime_classpath,
        expected
    );
    assert!(project_paths(&fixture.0, &fixture.0, &fixture.0, &context, &selection, true).is_err());
    fs::create_dir(fixture.0.join("app/target/classes")).unwrap();
    context["modules"][0]["sourceSets"][0]["runtimeClasspath"] = json!([{"path":"dependency.jar"}]);
    assert_eq!(
        project_paths(&fixture.0, &fixture.0, &fixture.0, &context, &selection, true)
            .unwrap()
            .runtime_classpath,
        vec![fixture.0.join("dependency.jar")]
    );
}
#[test]
fn declared_jdk_execution_rejects_missing_ambiguous_or_unsafe_compiler_facts() {
    let fixture = Fixture::new();
    let base = declared_compiler_fixture();
    let mutations = vec![
        ("compilerOptionsAvailability", json!("partial")),
        ("compilerOptions", json!([])),
        ("release", json!(21)),
        ("sourceRoots", json!([])),
        ("generatedSourceRoots", json!(["other"])),
        ("outputDirectories", json!(["../escape"])),
        ("outputDirectories", json!(["app"])),
        ("outputDirectories", json!(["app/one", "app/two"])),
        ("compileClasspath", json!([{"path":"missing.jar"}])),
        (
            "annotationProcessors",
            json!({"availability":"complete","mode":"full"}),
        ),
    ];
    for (key, value) in mutations {
        let mut set = base.clone();
        set[key] = value;
        assert!(
            declared_jdk_compilation(&fixture.0, &set).is_err(),
            "{key}: {set}"
        );
    }
    let mut redacted = base.clone();
    redacted["compilerOptions"][0]["redacted"] = json!(true);
    assert!(declared_jdk_compilation(&fixture.0, &redacted).is_err());
}
