#[path = "java_entry_point_real_tests.rs"]
mod entry_points;
#[path = "java_declared_execution_real_tests.rs"]
mod declared_execution;
use super::*;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[test]
fn maven_runtime_requires_the_read_only_project_open_feature() {
    let mut method = json!({ "name": "project.open", "requiresProject": false, "writesWorkspace": false });
    assert!(!maven_runtime_advertised(&json!({"methods": [&method]})));
    method["features"] = json!({"mavenRuntime": true});
    assert!(maven_runtime_advertised(&json!({"methods": [&method]})));
    method["writesWorkspace"] = json!(true);
    assert!(!maven_runtime_advertised(&json!({"methods": [&method]})));
}

#[test]
#[ignore = "requires real RefactorKit Maven-runtime and compact class rename support, Maven on PATH and a full JDK; run with --test-threads=1"]
fn real_maven_runtime_qualifies_an_implicit_compiler_without_executing_maven() {
    use super::super::java_context_refactoring::{apply_at, preview_at, rollback_at};
    let fixture = Fixture::new();
    let pom = r#"<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>fixture</groupId><artifactId>implicit-compiler</artifactId><version>1</version>
  <properties><maven.compiler.source>17</maven.compiler.source><maven.compiler.target>17</maven.compiler.target></properties>
</project>"#;
    let source = "package fixture; public final class Main { public Main() {} }\n";
    let relative = "src/main/java/fixture/Main.java";
    let file = fixture.root.join(relative);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, source).unwrap();
    fs::write(fixture.root.join("pom.xml"), pom).unwrap();
    let expected_plugin = std::env::var("IDE_JAVA_CONTEXT_MAVEN_COMPILER_PLUGIN")
        .expect("Set the expected lifecycle compiler plugin for the Maven on PATH.");
    let runtime = maven_runtime::selected(&fixture.root, &fixture.binding.canonical_root)
        .expect("Select the standard Maven distribution using PATH.");
    let mut request = fixture.request();
    request.sdk_home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Select a full JDK.");
    request.maven_repository = std::env::var("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY").expect("Select a populated Maven repository.");
    let state = JavaProjectContextState::default();
    let response = query_owned(fixture.binding.clone(), request.clone(), state.shared(), 0).unwrap();
    assert_eq!(response["status"], "available", "{response}");
    let context = &response["context"];
    let evidence = runtime.project_open_params();
    assert!(context["buildEvidence"].as_array().unwrap().iter().any(|item| {
        item["path"] == evidence["coreJar"] && item["kind"] == "effective-model-input"
    }));
    let modules = context["modules"].as_array().unwrap();
    assert_eq!(modules.len(), 1);
    let source_sets = modules[0]["sourceSets"].as_array().unwrap();
    assert_eq!(source_sets.len(), 2);
    for source_set in source_sets {
        assert_eq!(source_set["sourceLevel"], 17);
        assert_eq!(source_set["compilerOptionsAvailability"], "complete");
        let plugin = source_set["compilerOptions"].as_array().unwrap().iter()
            .find(|option| option["name"] == "pluginVersion").unwrap();
        assert_eq!(plugin["value"], expected_plugin);
        assert!(plugin["origin"].as_str().unwrap().ends_with(evidence["sha256"].as_str().unwrap()));
    }
    let mut expected = request_settings(&request);
    expected["contextSchemaVersion"] = context["schemaVersion"].clone();
    expected["snapshotHash"] = context["snapshotHash"].clone();
    expected["contextHash"] = context["contextHash"].clone();
    expected["platformIdentities"] = json!(context["sdk"].as_array().unwrap().iter()
        .map(|sdk| &sdk["identitySha256"]).collect::<Vec<_>>());
    let authority = json!({"workspaceId":fixture.binding.workspace_id,"workspaceGeneration":1});
    let mut rename = json!({"operation":"rename-class","target":{"kind":"class","path":relative,"identity":"fixture.Main"},
        "changeIntent":{"operation":"rename-class","newName":"Renamed"},"authority":authority,
        "selectionGeneration":1,"requestId":"implicit-compiler-rename","projectContext":expected});
    let refactoring = super::super::application::RefactorKitDaemonState::default();
    let preview = preview_at(serde_json::from_value(rename.clone()).unwrap(), &refactoring, fixture.binding.clone(), &fixture.root).unwrap();
    assert_eq!(preview["status"], "ready", "{preview}");
    assert_eq!(preview["applyEligibility"]["eligible"], true, "{preview}");
    assert_eq!(fs::read_to_string(&file).unwrap(), source);
    rename["planId"] = preview["planId"].clone();
    rename["approval"] = json!({"approvalId":"implicit-compiler-approval","approvedPlanId":preview["planId"],"approvedAt":"2026-11-21T09:00:00Z"});
    let applied = apply_at(serde_json::from_value(rename).unwrap(), &refactoring, fixture.binding.clone(), &fixture.root).unwrap();
    assert_eq!(applied["outcome"], "applied", "{applied}");
    let destination = file.with_file_name("Renamed.java");
    let renamed_source = fs::read_to_string(&destination).unwrap();
    assert!(renamed_source.contains("class Renamed"));
    assert!(renamed_source.contains("public Renamed()"));
    assert!(!file.exists());
    let rollback = json!({"transactionId":applied["transactionId"],"operation":"rename-class","authority":authority,
        "requestId":"implicit-compiler-rollback","projectContext":expected,"expectedSnapshotHash":applied["appliedSnapshotHash"]});
    let rolled_back = rollback_at(serde_json::from_value(rollback).unwrap(), &refactoring, fixture.binding.clone(), &fixture.root).unwrap();
    assert_eq!(rolled_back["rolledBack"], true, "{rolled_back}");
    assert!(!destination.exists());
    assert_eq!(fs::read_to_string(&file).unwrap(), source);
    assert_eq!(fs::read_to_string(fixture.root.join("pom.xml")).unwrap(), pom);
    assert!(!fixture.root.join("target").exists());
    #[cfg(unix)]
    {
        with_selected_session(&state.shared(), &fixture.binding, 1, &expected, |_| Ok(())).unwrap();
        fs::write(fixture.root.join("mvnw"), "#!/bin/sh\nexit 97\n").unwrap();
        let error = with_selected_session(&state.shared(), &fixture.binding, 1, &expected, |_| -> Result<(), String> {
            panic!("A changed Maven launcher must invalidate the selected context");
        }).unwrap_err();
        assert_eq!(error, MAVEN_RUNTIME_CHANGED_MESSAGE);
        assert!(state.0.active.lock().unwrap().as_ref().unwrap().context.is_none());
        let response = query_owned(fixture.binding.clone(), request.clone(), state.shared(), 0).unwrap();
        assert_eq!(response["code"], "java.context.compilerOptionsIncomplete", "{response}");
        assert!(!fixture.root.join("target").exists());
        fs::remove_file(fixture.root.join("mvnw")).unwrap();
    }
    let refreshed = query_owned(fixture.binding.clone(), request.clone(), state.shared(), 0).unwrap();
    assert_eq!(refreshed["status"], "available", "{refreshed}");
    let context = &refreshed["context"];
    expected["contextSchemaVersion"] = context["schemaVersion"].clone();
    expected["snapshotHash"] = context["snapshotHash"].clone();
    expected["contextHash"] = context["contextHash"].clone();
    let module = &context["modules"][0];
    let main = module["sourceSets"].as_array().unwrap().iter().find(|source_set| source_set["kind"] == "main").unwrap();
    let selection = serde_json::from_value(json!({"context":expected,"providerId":module["providerId"],"moduleId":module["id"],"sourceSetId":main["id"]})).unwrap();
    let launch = serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"operation":"build","trusted":true,
        "configuration":{"buildTool":"auto","mainClass":"","classPath":[]}})).unwrap();
    let executor = crate::commands::java_execution::JavaExecutionState::new(&state);
    let started = serde_json::to_value(executor.start_project(fixture.binding.clone(), launch, selection).unwrap()).unwrap();
    let session = serde_json::from_value(json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let finished = loop {
        let current = serde_json::to_value(executor.snapshot_at(&fixture.binding, &session).unwrap()).unwrap();
        if matches!(current["state"].as_str(), Some("succeeded" | "failed" | "stopped")) {
            break current;
        }
        assert!(Instant::now() < deadline, "{current}");
        std::thread::sleep(Duration::from_millis(30));
    };
    assert_eq!(finished["state"], "succeeded", "{finished}");
    assert!(finished["output"].as_str().unwrap().contains(&format!("compiler:{expected_plugin}:compile")), "{finished}");
    let class = fs::read(fixture.root.join("target/classes/fixture/Main.class")).unwrap();
    assert_eq!(&class[..8], &[0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61]);
    assert_eq!(fs::read_to_string(&file).unwrap(), source);
    executor.shutdown_all();
    state.shutdown_all();
}

#[path = "java_gradle_diagnostic_real_tests.rs"]
mod gradle_diagnostics;

#[path = "java_editor_dependency_source_tests.rs"]
mod editor_dependency_sources;
#[path = "java_platform_source_real_tests.rs"]
mod platform_sources;
#[path = "java_editor_diagnostics_real_tests.rs"]
mod editor_diagnostics;

#[test]
fn dropping_a_shared_context_handle_does_not_shutdown_the_live_manager() {
    let owner = JavaProjectContextState::default();
    let temporary_handle = JavaProjectContextState(owner.shared());

    drop(temporary_handle);

    assert!(!owner.0.shutting_down.load(Ordering::SeqCst));
}

#[test]
fn generated_gradle_source_import_requires_materialized_owned_roots_and_one_source_set() {
    let fixture = Fixture::new();
    let workspace = fixture.binding.canonical_root.as_path();
    let project = workspace.join("nested");
    let app = project.join("app");
    let generated = app.join("build/generated");
    fs::create_dir_all(app.join("src/main/java")).unwrap();
    fs::create_dir_all(&generated).unwrap();
    fs::create_dir_all(project.join("outside-app")).unwrap();
    let mut context = json!({
        "schemaVersion": "java-project-context-v2",
        "providers": [{"providerId": "gradle-effective-v1", "status": "available"}],
        "modules": [{
            "providerId": "gradle-effective-v1",
            "root": "app",
            "sourceSets": [{
                "sourceRoots": ["app/src/main/java"],
                "generatedSourceRoots": ["app/build/generated", "app/build/missing", "outside-app"]
            }]
        }]
    });
    let sets = gradle_generated_source_sets(&context, workspace, &project).unwrap();
    assert_eq!(sets.len(), 1);
    assert_eq!(sets[0].module, app.to_str().unwrap());
    assert_eq!(sets[0].generated, [generated.to_str().unwrap()]);

    context["schemaVersion"] = json!("java-project-context-v7");
    context["modules"][0]["root"] = json!("nested/app");
    context["modules"][0]["sourceSets"][0] = json!({
        "sourceRoots": ["nested/app/src/main/java"],
        "generatedSourceRoots": ["nested/app/build/generated"]
    });
    assert_eq!(gradle_generated_source_sets(&context, workspace, &project).unwrap(), sets);

    fs::create_dir_all(app.join("src/test/java")).unwrap();
    context["modules"][0]["sourceSets"].as_array_mut().unwrap().push(json!({
        "sourceRoots": ["nested/app/src/test/java"],
        "generatedSourceRoots": ["nested/app/build/generated"]
    }));
    assert!(gradle_generated_source_sets(&context, workspace, &project).is_none());
}

#[test]
fn concurrent_java_context_trace_appends_preserve_json_lines() {
    let path = std::env::temp_dir().join(format!(
        "ide-java-context-trace-{}-{}.jsonl",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let writers = 8;
    let records_per_writer = 100;
    let threads = (0..writers)
        .map(|writer| {
            let path = path.clone();
            std::thread::spawn(move || {
                for sequence in 0..records_per_writer {
                    let record = json!({"writer": writer, "sequence": sequence}).to_string();
                    append_trace_record(&path, &record).unwrap();
                }
            })
        })
        .collect::<Vec<_>>();
    for thread in threads {
        thread.join().unwrap();
    }

    let contents = fs::read_to_string(&path).unwrap();
    let records = contents
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(records.len(), writers * records_per_writer);
    let unique = records
        .iter()
        .map(|record| {
            (
                record["writer"].as_u64().unwrap(),
                record["sequence"].as_u64().unwrap(),
            )
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(unique.len(), writers * records_per_writer);
    fs::remove_file(path).unwrap();
}

#[test]
fn context_consumers_queued_at_shutdown_are_rejected_before_waiting_for_the_session_lock() {
    let fixture = Fixture::new();
    let state = Arc::new(Manager::default());
    let active = state.active.lock().unwrap();
    state.shutting_down.store(true, Ordering::SeqCst);

    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (result_tx, result_rx) = std::sync::mpsc::channel();
    let worker_state = state.clone();
    let binding = fixture.binding.clone();
    let worker = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        let result = with_selected_session(&worker_state, &binding, 1, &json!({}), |_| Ok(()));
        result_tx.send(result).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let before_unlock = result_rx.recv_timeout(Duration::from_millis(100));
    let returned_before_unlock = before_unlock.is_ok();
    drop(active);
    let result =
        before_unlock.unwrap_or_else(|_| result_rx.recv_timeout(Duration::from_secs(1)).unwrap());
    worker.join().unwrap();

    assert!(
        returned_before_unlock,
        "a queued consumer waited for the session lock after shutdown began"
    );
    assert_eq!(
        result.unwrap_err(),
        "Java project context is shutting down."
    );
}

#[cfg(unix)]
#[test]
fn a_dead_selected_session_is_retired_and_requires_explicit_synchronization() {
    use std::process::{Command, Stdio};

    let fixture = Fixture::new();
    let snapshot = "a".repeat(64);
    let context_hash = "b".repeat(64);
    let sdk_identity = "c".repeat(64);
    let expected = json!({
        "projectPath": "",
        "sdkHome": fixture.sdk,
        "mavenRepository": "",
        "activeMavenProfiles": [],
        "inactiveMavenProfiles": [],
        "contextSchemaVersion": "v5",
        "snapshotHash": snapshot,
        "contextHash": context_hash,
        "platformIdentities": [sdk_identity],
        "gradle": null
    });
    let context = json!({
        "status": "available",
        "schemaVersion": "v5",
        "snapshotHash": expected["snapshotHash"],
        "contextHash": expected["contextHash"],
        "sdk": [{"identitySha256": expected["platformIdentities"][0]}]
    });

    let mut child = Command::new("sh")
        .args(["-c", "sleep 60"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let stdin = child.stdin.take().unwrap();
    let (response_sender, responses) = std::sync::mpsc::channel();
    drop(response_sender);
    let session = Session {
        workspace_id: fixture.binding.workspace_id.clone(),
        generation: 1,
        root: fixture.root.clone(),
        executable: PathBuf::from("fake-refactorkit"),
        executable_sha256: None,
        child,
        stdin,
        responses,
        next_id: 0,
        capabilities: None,
    };
    let active = Active {
        binding: fixture.binding.clone(),
        generation: 1,
        session_id: 1,
        session,
        capabilities: json!({}),
        settings: settings_key(&expected),
        opened: None,
        context: Some(context),
        context_verification: None,
        maven_runtime: None,
        gradle_sync: None,
        maven_module_rename_plans: Default::default(),
        maven_module_rename_transactions: Default::default(),
        editor_reviews: Default::default(),
        editor_transactions: Default::default(),
    };
    let state = Arc::new(Manager::default());
    *state.active.lock().unwrap() = Some(active);
    {
        let mut active = state.active.lock().unwrap();
        let child = &mut active.as_mut().unwrap().session.child;
        child.kill().unwrap();
        child.wait().unwrap();
    }

    let error =
        with_selected_session(&state, &fixture.binding, 1, &expected, |_| Ok(())).unwrap_err();
    assert_eq!(error, SESSION_RETIRED_MESSAGE);
    assert!(state.active.lock().unwrap().is_none());
    assert_eq!(
        with_selected_session(&state, &fixture.binding, 1, &expected, |_| Ok(())).unwrap_err(),
        "Synchronize the Java project before using its SDK context."
    );
}

#[test]
fn declared_project_watch_follows_provider_roots_inside_conventional_output_names() {
    let workspace = Path::new("/workspace");
    let project = workspace.join("plain");
    let context = json!({"schemaVersion":"java-project-context-v3","modules":[
        {"providerId":"java-declared-v1","sourceSets":[{"sourceRoots":["plain/code"]}]},
        {"providerId":"maven-effective-v1","sourceSets":[{"sourceRoots":["plain/other"]}]}
    ]});
    let roots = declared_java_watch_roots(workspace, &project, &context);
    assert_eq!(roots, vec![project.join("code")]);
    assert_eq!(project_input_kind_with_declared_roots(&project, &project.join("code/build/Main.java"), &roots), Some(ProjectInputKind::Source));
    assert_eq!(project_input_kind_with_declared_roots(&project, &project.join("build/generated/Main.java"), &roots), None);
    assert_eq!(project_input_kind_with_declared_roots(&project, &project.join("code/build/Main.class"), &roots), None);
    assert_eq!(project_input_kind_with_declared_roots(&project, &workspace.join("outside/build/Main.java"), &roots), None);
    let mut legacy = context.clone();
    legacy["schemaVersion"] = json!("java-project-context-v2");
    legacy["modules"][0]["sourceSets"][0]["sourceRoots"] = json!(["code"]);
    assert_eq!(declared_java_watch_roots(workspace, &project, &legacy), roots);
}

#[test]
fn project_change_filter_distinguishes_sources_and_build_inputs() {
    let root = Path::new("/workspace/app");
    for path in [
        "/workspace/app/src/main/java/pkg/Main.java",
        "/workspace/app/src/test/java/pkg/MainTest.java",
        "/workspace/app/src/main/kotlin/pkg/Main.kt",
    ] {
        assert_eq!(
            project_input_kind(root, Path::new(path)),
            Some(ProjectInputKind::Source),
            "{path}"
        );
    }
    for path in [
        "/workspace/app/pom.xml",
        "/workspace/app/.refactorkit/java-project.json",
        "/workspace/app/module/build.gradle.kts",
        "/workspace/app/gradle.properties",
        "/workspace/app/gradle/libs.versions.toml",
        "/workspace/app/gradle/custom-catalog.toml",
        "/workspace/app/app/dependencies.lockfile",
        "/workspace/app/gradle/verification-metadata.xml",
        "/workspace/app/config/extra.gradle",
        "/workspace/app/buildSrc/src/main/kotlin/BuildLogic.kt",
        "/workspace/app/buildSrc/src/main/groovy/BuildPlugin.groovy",
        "/workspace/app/build-logic/src/main/java/BuildPlugin.java",
        "/workspace/app/.mvn/maven.config",
        "/workspace/app/.mvn/jvm.config",
        "/workspace/app/.mvn/extensions.xml",
        "/workspace/app/.mvn/wrapper/maven-wrapper.properties",
    ] {
        assert_eq!(
            project_input_kind(root, Path::new(path)),
            Some(ProjectInputKind::BuildConfiguration),
            "{path}"
        );
    }
    for path in [
        "/workspace/app/README.md",
        "/workspace/app/target/classes/pkg/Main.class",
        "/workspace/app/build/generated/sources/annotationProcessor/java/Main.java",
        "/workspace/app/.git/config",
        "/other/workspace/app/src/Main.java",
        "/workspace/app/src/.ide-save-abc.tmp",
    ] {
        assert_eq!(project_input_kind(root, Path::new(path)), None, "{path}");
    }
}

#[test]
fn source_edits_retain_gradle_receipt_while_build_edits_invalidate_it() {
    let mut context = Some(json!({"contextHash":"old-context"}));
    let receipt = json!({"snapshotHash":"evaluated-build"});
    let mut gradle_sync = Some(receipt.clone());

    invalidate_project_evidence_for_change(
        &mut context,
        &mut gradle_sync,
        ProjectInputChange::Changed(ProjectInputKind::Source),
    );

    assert!(context.is_none());
    assert_eq!(gradle_sync, Some(receipt.clone()));

    context = Some(json!({"contextHash":"new-context"}));
    invalidate_project_evidence_for_change(
        &mut context,
        &mut gradle_sync,
        ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration),
    );

    assert!(context.is_none());
    assert!(gradle_sync.is_none());

    context = Some(json!({"contextHash":"current-context"}));
    gradle_sync = Some(receipt.clone());
    invalidate_project_evidence_for_change(
        &mut context,
        &mut gradle_sync,
        ProjectInputChange::Unavailable,
    );
    assert_eq!(context, Some(json!({"contextHash":"current-context"})));
    assert_eq!(gradle_sync, Some(receipt));
}

#[test]
fn project_input_debounce_does_not_drop_build_change_after_source_change() {
    let now = std::time::Instant::now();

    assert!(!should_suppress_project_input_change(
        Some((now, ProjectInputChange::Changed(ProjectInputKind::Source))),
        now + std::time::Duration::from_millis(10),
        ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration),
    ));
    assert!(should_suppress_project_input_change(
        Some((
            now,
            ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration)
        )),
        now + std::time::Duration::from_millis(10),
        ProjectInputChange::Changed(ProjectInputKind::Source),
    ));
    assert!(should_suppress_project_input_change(
        Some((now, ProjectInputChange::Changed(ProjectInputKind::Source))),
        now + std::time::Duration::from_millis(10),
        ProjectInputChange::Changed(ProjectInputKind::Source),
    ));
}

#[test]
fn native_project_watcher_reports_java_changes_and_ignores_unrelated_files() {
    use std::sync::mpsc;
    use std::time::Duration;

    let fixture = Fixture::new();
    let source_root = fixture.root.join("src/main/java/pkg");
    fs::create_dir_all(&source_root).unwrap();
    let (sender, receiver) = mpsc::channel();
    let _watcher = watch_project_root(&fixture.root, vec![], move |change| {
        let _ = sender.send(change);
    })
    .unwrap();

    fs::write(fixture.root.join("README.md"), "documentation").unwrap();
    assert!(receiver.recv_timeout(Duration::from_millis(400)).is_err());

    fs::write(source_root.join("Main.java"), "class Main {}\n").unwrap();
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
        ProjectInputChange::Changed(ProjectInputKind::Source)
    );

    std::thread::sleep(Duration::from_millis(350));
    fs::write(fixture.root.join("pom.xml"), "<project/>\n").unwrap();
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
        ProjectInputChange::Changed(ProjectInputKind::BuildConfiguration)
    );
}

#[test]
fn project_watcher_events_require_the_current_watch_and_context_snapshot() {
    let fixture = Fixture::new();
    let watcher = watch_project_root(&fixture.root, vec![], |_| {}).unwrap();
    let watch = ProjectWatch {
        workspace_id: "workspace-1".into(),
        generation: 4,
        project_path: "service".into(),
        watch_id: "watch-current".into(),
        snapshot_hash: "a".repeat(64),
        _watcher: watcher,
    };

    assert!(project_watch_matches_context(
        Some(&watch),
        "workspace-1",
        4,
        "service",
        "watch-current",
        &"a".repeat(64),
        Some(&"a".repeat(64)),
    ));
    assert!(!project_watch_matches_context(
        Some(&watch),
        "workspace-1",
        4,
        "service",
        "watch-old",
        &"a".repeat(64),
        Some(&"a".repeat(64)),
    ));
    assert!(!project_watch_matches_context(
        Some(&watch),
        "workspace-1",
        4,
        "service",
        "watch-current",
        &"a".repeat(64),
        Some(&"b".repeat(64)),
    ));
    assert!(project_watch_matches_context(
        Some(&watch),
        "workspace-1",
        4,
        "service",
        "watch-current",
        &"a".repeat(64),
        None,
    ));
}

#[test]
fn a_full_context_sync_retires_only_its_own_previous_project_watch() {
    let fixture = Fixture::new();
    let watcher = watch_project_root(&fixture.root, vec![], |_| {}).unwrap();
    let state = Manager {
        project_watcher: Mutex::new(Some(ProjectWatch {
            workspace_id: "workspace-1".into(),
            generation: 4,
            project_path: "service".into(),
            watch_id: "watch-current".into(),
            snapshot_hash: "a".repeat(64),
            _watcher: watcher,
        })),
        ..Manager::default()
    };

    retire_project_watch_for_sync(
        &Authority {
            workspace_id: "workspace-1".into(),
            generation: 5,
        },
        &state,
    )
    .unwrap();
    assert!(state.project_watcher.lock().unwrap().is_some());

    retire_project_watch_for_sync(
        &Authority {
            workspace_id: "workspace-1".into(),
            generation: 4,
        },
        &state,
    )
    .unwrap();
    assert!(state.project_watcher.lock().unwrap().is_none());
}

#[test]
#[ignore = "requires frozen dependency-source RefactorKit delivery and real selected JDK; run with --test-threads=1"]
fn real_dependency_sources_use_selected_session_and_refuse_changed_attachment() {
    qualify_dependency_sources(false);
}

#[test]
#[ignore = "requires frozen exact dependency declaration delivery and real selected JDK; run with --test-threads=1"]
fn real_dependency_declarations_resolve_exact_overload_through_selected_session() {
    qualify_dependency_sources(true);
}

fn qualify_dependency_sources(exact: bool) {
    use super::super::java_dependency_source;
    use std::process::Command;
    let daemon = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set frozen daemon path");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", daemon);
    let sdk = PathBuf::from(std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Set selected JDK"));
    let f = Fixture::new();
    let repository = f.root.join("repository");
    let artifact = repository.join("external/library/1");
    let sources = artifact.join("src/external");
    let classes = artifact.join("classes");
    fs::create_dir_all(&sources).unwrap();
    fs::create_dir_all(&classes).unwrap();
    let library = "package external;\npublic class Library {\n public String call(int n) { return \"integer\"; }\n public String call(String n) { return n; }\n}\n";
    fs::write(sources.join("Library.java"), library).unwrap();
    let compiled = Command::new(sdk.join("bin/javac"))
        .args(["--release", "17", "-d"])
        .arg(&classes)
        .arg(sources.join("Library.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let binary = artifact.join("library-1.jar");
    let archive = artifact.join("library-1-sources.jar");
    for (path, directory) in [(&binary, classes.clone()), (&archive, artifact.join("src"))] {
        let packaged = Command::new(sdk.join("bin/jar"))
            .arg("cf")
            .arg(path)
            .arg("-C")
            .arg(directory)
            .arg(".")
            .output()
            .unwrap();
        assert!(
            packaged.status.success(),
            "{}",
            String::from_utf8_lossy(&packaged.stderr)
        );
    }
    fs::write(artifact.join("library-1.pom"), "<project><modelVersion>4.0.0</modelVersion><groupId>external</groupId><artifactId>library</artifactId><version>1</version></project>").unwrap();
    let pom = "<project><modelVersion>4.0.0</modelVersion><groupId>consumer</groupId><artifactId>app</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>external</groupId><artifactId>library</artifactId><version>1</version></dependency></dependencies></project>";
    fs::write(f.root.join("pom.xml"), pom).unwrap();
    let path = "src/main/java/Main.java";
    let source = "import external.Library;\nclass Main { String value() { return new Library().call(1); } }\n";
    fs::create_dir_all(f.root.join("src/main/java")).unwrap();
    fs::write(f.root.join(path), source).unwrap();
    let state = JavaProjectContextState::default();
    let mut context_request = f.request();
    context_request.sdk_home = sdk.to_string_lossy().into_owned();
    context_request.maven_repository = repository.to_string_lossy().into_owned();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let response = query_owned(
        f.binding.clone(),
        context_request.clone(),
        state.shared(),
        ticket,
    )
    .unwrap();
    assert_eq!(response["status"], "available", "{response}");
    let context = &response["context"];
    let identities: Vec<_> = context["sdk"]
        .as_array()
        .unwrap()
        .iter()
        .map(|sdk| sdk["identitySha256"].clone())
        .collect();
    let project = json!({"projectPath":"", "sdkHome":context_request.sdk_home,"mavenRepository":context_request.maven_repository,
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],"contextSchemaVersion":context["schemaVersion"],"platformIdentities":identities});
    let raw = json!({"workspaceId":f.binding.workspace_id,"generation":1,"requestId":"source-real", "projectContext":project,
        "document":{"path":path,"text":source,"version":1},"position":{"line":1,"character":52}});
    if exact {
        let nav_state = super::super::java_navigation::JavaNavigationState::new(&state);
        let mut request = raw.clone();
        request["kind"] = json!("definition");
        request["includeDeclaration"] = json!(true);
        request["limit"] = json!(1);
        let empty = super::super::java_navigation::query_at(
            f.binding.clone(),
            serde_json::from_value(request).unwrap(),
            &nav_state,
        )
        .unwrap();
        assert_eq!(empty["status"], "ready", "{empty}");
        assert_eq!(empty["locations"].as_array().unwrap().len(), 0, "{empty}");
    }
    let run = |value: Value, operation| {
        java_dependency_source::query(
            f.binding.clone(),
            serde_json::from_value(value).unwrap(),
            operation,
            state.shared(),
        )
        .unwrap()
    };
    let pid = state
        .0
        .active
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .session
        .child
        .id();
    let lookup = run(raw.clone(), "lookup");
    assert_eq!(lookup["status"], "available", "{lookup}");
    assert_eq!(
        lookup["association"]["jvmIdentity"]["kind"], "CALLABLE",
        "{lookup}"
    );
    assert_eq!(
        lookup["association"]["jvmIdentity"]["descriptor"],
        "(I)Ljava/lang/String;"
    );
    assert_eq!(lookup["association"]["readOnly"], true);
    let mut read = raw.clone();
    read["expectedAssociationHash"] = lookup["association"]["associationHash"].clone();
    let contents = run(read.clone(), "read");
    assert_eq!(contents["status"], "available", "{contents}");
    assert_eq!(contents["content"], library);
    let declaration = if exact {
        let declaration = run(raw.clone(), "declaration");
        assert_eq!(declaration["status"], "available", "{declaration}");
        assert_eq!(declaration["association"], lookup["association"]);
        assert_eq!(declaration["declaration"]["evidence"], "JDT_SOURCE_BINDING");
        assert_eq!(
            declaration["declaration"]["nameRange"],
            json!({"start":{"line":2,"character":15},"end":{"line":2,"character":19}})
        );
        Some(declaration)
    } else {
        None
    };
    assert_eq!(
        state
            .0
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .session
            .child
            .id(),
        pid
    );
    let mut draft = raw.clone();
    draft["document"]["text"] = json!(format!("{source}// draft"));
    assert_eq!(
        run(draft, "lookup")["reason"]["code"],
        "java.sources.unsavedCursor"
    );
    let original_archive = fs::read(&archive).unwrap();
    fs::remove_file(&archive).unwrap();
    let missing = run(raw.clone(), "lookup");
    assert_eq!(missing["status"], "unavailable", "{missing}");
    fs::write(&archive, &original_archive).unwrap();
    fs::write(
        sources.join("Library.java"),
        library.replace("integer", "changed"),
    )
    .unwrap();
    let changed = Command::new(sdk.join("bin/jar"))
        .arg("cf")
        .arg(&archive)
        .arg("-C")
        .arg(artifact.join("src"))
        .arg(".")
        .output()
        .unwrap();
    assert!(changed.status.success());
    fs::write(sources.join("Library.java"), library).unwrap();
    let stale = run(read.clone(), "read");
    assert_eq!(stale["status"], "refused", "{stale}");
    assert_eq!(
        stale["reason"]["code"], "java.sources.associationStale",
        "{stale}"
    );
    let wire = f.root.join("consumer-source-response.json");
    fs::write(&wire,serde_json::to_vec(&json!({"lookupRequest":raw,"lookup":lookup,"readRequest":read,"read":contents,"declaration":declaration})).unwrap())
    .unwrap();
    let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let decoded = Command::new("node").current_dir(repository_root).args(["--import","tsx","--input-type=module","-e",
        "import fs from 'node:fs';import{normalizeJavaDependencySource,normalizeJavaDependencySourceDeclaration}from './packages/tauri-adapters/src/java-dependency-source-tauri.ts';const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for(const op of ['lookup','read']){const r=normalizeJavaDependencySource(x[op],x[op+'Request'],op);if(r.status!=='available'||r.association.readOnly!==true)throw Error('Consumer rejected source');}if(x.declaration){const d=normalizeJavaDependencySourceDeclaration(x.declaration,x.lookupRequest);if(d.status!=='available'||d.declaration.evidence!=='JDT_SOURCE_BINDING')throw Error('Consumer rejected declaration');console.log('PRODUCTION_DECLARATION_DECODER_ACCEPTED');}console.log('PRODUCTION_SOURCE_DECODER_ACCEPTED');"
    ]).arg(&wire).output().unwrap();
    fs::remove_file(&wire).unwrap();
    assert!(
        decoded.status.success(),
        "{}",
        String::from_utf8_lossy(&decoded.stderr)
    );
    assert!(String::from_utf8_lossy(&decoded.stdout).contains("PRODUCTION_SOURCE_DECODER_ACCEPTED"));
    assert_eq!(fs::read_to_string(f.root.join(path)).unwrap(), source);
    assert_eq!(fs::read_to_string(f.root.join("pom.xml")).unwrap(), pom);
    let mut active = state.0.active.lock().unwrap();
    reset(&mut active);
    assert!(active.is_none());
    eprintln!("DEPENDENCY_SOURCE_ACCEPTED SDK={} reusedPid={} owningFile=external/Library.java overload=(I)Ljava/lang/String; dirtyCursor=refused missingAttachment=unavailable changedAttachment=refused inputs=unchanged", sdk.display(), pid);
}

#[test]
#[ignore = "requires real RefactorKit daemon, Gradle and full selected JDK"]
fn real_refactorkit_gradle_context_shares_evaluation_with_source_queries_and_editor_preview() {
    use std::process::Command;
    let engine =
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set IDE_REAL_REFACTORKIT_DAEMON");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(v) => std::env::set_var("IDE_REFACTORKIT_DAEMON", v),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let f = Fixture::new();
    let home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK")
        .unwrap_or_else(|_| "/usr/lib/jvm/java-21-openjdk".into());
    let gradle =
        std::env::var("IDE_JAVA_CONTEXT_TEST_GRADLE").unwrap_or_else(|_| "/usr/bin/gradle".into());
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let inputs = [
        ("settings.gradle", "rootProject.name='context-test'\ninclude 'app','library'\n"),
        ("gradle.properties", "org.gradle.daemon=false\norg.gradle.workers.max=2\n"),
        ("build.gradle", "file('evaluation-count.txt').append('evaluated\\n')\nsubprojects { apply plugin: 'java-library'; tasks.withType(JavaCompile).configureEach { options.release=17; options.compilerArgs.add('-parameters') } }\nproject(':app') { dependencies { implementation project(':library') } }\n"),
        ("library/src/main/java/pkg/Service.java", "package pkg;\npublic class Service {\n public String message(int n) { return \"integer\"; }\n public String message(String n) { return n; }\n}\n"),
        ("app/src/main/java/pkg/Runner.java", "package pkg;\npublic class Runner {\n public String run() { return new Service().message(2); }\n}\n"),
    ];
    for (path, text) in inputs {
        let path = f.root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    let user_home = f.root.join(".gradle-user-home");
    let build = Command::new(&gradle)
        .current_dir(&f.root)
        .env("JAVA_HOME", &home)
        .args(["--offline", "--no-daemon", "--console=plain", "-g"])
        .arg(&user_home)
        .arg("classes")
        .output()
        .unwrap();
    assert!(
        build.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr)
    );
    let marker = f.root.join("evaluation-count.txt");
    fs::remove_file(&marker).unwrap();
    let state = JavaProjectContextState::default();
    let navigation_state = super::super::java_navigation::JavaNavigationState::new(&state);
    let run = |request: Request| {
        let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
        query_owned(f.binding.clone(), request, state.0.clone(), ticket).unwrap()
    };
    let mut request = f.request();
    request.sdk_home = home.clone();
    request.gradle = Some(GradleSettings {
        executable: gradle,
        user_home: user_home.to_string_lossy().into_owned(),
        gradle_runtime_home: Some(home.clone()),
        project_properties: BTreeMap::new(),
    });
    let partial = run(request.clone());
    assert_eq!(partial["status"], "partial", "{partial}");
    assert!(
        !marker.exists(),
        "ordinary synchronization must not evaluate Gradle"
    );
    request.evaluate_gradle = Some(true);
    let synced = run(request.clone());
    assert_eq!(synced["status"], "available", "{synced}");
    assert_eq!(synced["gradleSync"]["providerId"], "gradle-effective-v1");
    assert_eq!(synced["gradleSync"]["gradleRuntimeHome"], home.as_str());
    let evaluations = fs::read(&marker).unwrap();
    assert!(!evaluations.is_empty());
    request.evaluate_gradle = None;
    request.expected_snapshot_hash =
        Some(synced["context"]["snapshotHash"].as_str().unwrap().into());
    request.expected_context_hash = Some(synced["context"]["contextHash"].as_str().unwrap().into());
    let main = synced["context"]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"] == "app")
        .unwrap()
        .clone();
    let main_set = main["sourceSets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["kind"] == "main")
        .unwrap();
    assert_eq!(
        main_set["compilerOptionsAvailability"], "complete",
        "{main_set}"
    );
    assert!(main_set["compilerOptions"].as_array().unwrap().iter().any(|option| {
        option["name"] == "compilerArg"
            && option["value"] == "-parameters"
            && option["redacted"] == false
            && option["origin"].as_str().is_some_and(|origin| !origin.is_empty())
    }), "The Gradle context did not report the literal JavaCompile compiler argument with origin: {main_set}");
    request.module_id = Some(main["id"].as_str().unwrap().into());
    request.source_set_id = Some(main_set["id"].as_str().unwrap().into());
    request.source_relative_path = Some("pkg/Runner.java".into());
    let inspected = run(request.clone());
    assert_eq!(inspected["status"], "available", "{inspected}");
    assert_eq!(
        inspected["context"]["selectedSource"]["path"],
        "app/src/main/java/pkg/Runner.java"
    );
    // Keep the legacy import assertion above, but exercise modern provider-qualified
    // authority through the same navigation, editor preview and transaction path.
    let mut qualified_request = request.clone();
    qualified_request.provider_id = Some("gradle-effective-v1".into());
    qualified_request.module_id = Some(":app".into());
    qualified_request.expected_context_hash = None;
    let qualified = run(qualified_request.clone());
    assert_eq!(qualified["status"], "available", "{qualified}");
    assert_eq!(
        qualified["context"]["schemaVersion"], "java-project-context-v7",
        "{qualified}"
    );
    let runner = inputs[4].1;
    let dirty = runner.replace("message(2)", "message(\"draft\")");
    let line = 2;
    let column = dirty.lines().nth(line).unwrap().find("message").unwrap();
    let authority = json!({"projectPath":"","sdkHome":request.sdk_home,"mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],"gradle":request.gradle,
        "snapshotHash":qualified["context"]["snapshotHash"],"contextHash":qualified["context"]["contextHash"],"contextSchemaVersion":qualified["context"]["schemaVersion"],"platformIdentities":qualified["context"]["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()});
    let docs = json!([{"path":"app/src/main/java/pkg/Runner.java","text":dirty,"version":2},{"path":"library/src/main/java/pkg/Service.java","text":inputs[3].1,"version":1}]);
    let mut navigation = json!({"workspaceId":request.workspace_id,"generation":request.generation,"requestId":"gradle-draft","kind":"definition",
        "document":docs[0],"position":{"line":line,"character":column},"includeDeclaration":true,"limit":1,"projectContext":authority,"editorOverlay":{"documents":docs}});
    let navigate = |v: &Value| {
        super::super::java_navigation::query_at(
            f.binding.clone(),
            serde_json::from_value(v.clone()).unwrap(),
            &navigation_state,
        )
        .unwrap()
    };
    let definition = navigate(&navigation);
    assert_eq!(definition["status"], "ready", "{definition}");
    assert_eq!(
        definition["locations"][0]["path"],
        "library/src/main/java/pkg/Service.java"
    );
    assert_eq!(definition["locations"][0]["range"]["start"]["line"], 3);
    navigation["kind"] = json!("mutationSelection");
    navigation["editorRefactoring"] = json!({"operation":"rename-member","target":{"kind":"member","path":"app/src/main/java/pkg/Runner.java","identity":"@cursor"},"changeIntent":{"operation":"rename-member","newName":"draftMessage"},"selectionGeneration":1});
    let preview = navigate(&navigation);
    assert_eq!(preview["status"], "ready", "{preview}");
    assert_eq!(preview["applyEligibility"]["eligible"], false);
    assert!(preview["renderedDiff"]
        .as_str()
        .unwrap()
        .contains("draftMessage"));
    let sample = f.root.join("wire.json");
    fs::write(&sample,serde_json::to_vec(&json!({"request":{"workspaceId":request.workspace_id,"generation":request.generation,"requestId":request.request_id,"projectPath":"","sdkHome":request.sdk_home,"mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],"gradle":request.gradle,"expectedSnapshotHash":request.expected_snapshot_hash,"expectedContextHash":request.expected_context_hash,"moduleId":request.module_id,"sourceSetId":request.source_set_id,"sourceRelativePath":request.source_relative_path},"response":inspected,"navigation":navigation,"definition":definition,"preview":preview})).unwrap()).unwrap();
    let decoded=Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
        "import{readFileSync}from'node:fs';import{normalizeJavaProjectContext}from'./packages/tauri-adapters/src/java-project-context-tauri.ts';import{normalizeJavaNavigation}from'./packages/tauri-adapters/src/java-navigation-tauri.ts';import{normalizeRefactorPreview}from'./packages/tauri-adapters/src/refactorkit-tauri.ts';import{verifyJavaEditorPreview}from'./packages/tauri-adapters/src/java-editor-refactoring-tauri.ts';const d=JSON.parse(readFileSync(process.argv[1],'utf8'));const context=normalizeJavaProjectContext(d.response,d.request);if(context.status!=='available')throw Error('Context');const options=context.context.modules.flatMap(m=>m.sourceSets).flatMap(s=>s.compilerOptions??[]);if(!options.some(o=>o.name==='compilerArg'&&o.value==='-parameters'&&o.redacted===false&&o.origin))throw Error('Compiler options');if(normalizeJavaNavigation(d.definition,{...d.navigation,kind:'definition',editorRefactoring:undefined}).status!=='ready')throw Error('Definition');const p=normalizeRefactorPreview('native-gradle-preview',d.preview);await verifyJavaEditorPreview(p,{projectContext:d.navigation.projectContext,editorOverlay:d.navigation.editorOverlay,operation:'rename-member'});",sample.to_str().unwrap()]).output().unwrap();
    assert!(
        decoded.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&decoded.stdout),
        String::from_utf8_lossy(&decoded.stderr)
    );
    fs::remove_file(&sample).unwrap();
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "source inspection, navigation and preview must not re-evaluate Gradle"
    );
    let transaction_documents =
        qualify_editor_transaction(&f, &state, &navigation_state, &navigation);
    let mut saved_refresh = request.clone();
    saved_refresh.expected_snapshot_hash = None;
    saved_refresh.expected_context_hash = None;
    saved_refresh.module_id = None;
    saved_refresh.source_set_id = None;
    saved_refresh.source_relative_path = None;
    fs::write(
        f.root.join(inputs[4].0),
        format!(
            "{}\n// saved after explicit Gradle evaluation\n",
            inputs[4].1
        ),
    )
    .unwrap();
    let refreshed = run(saved_refresh.clone());
    assert_eq!(refreshed["status"], "available", "{refreshed}");
    assert_ne!(
        refreshed["context"]["snapshotHash"],
        synced["context"]["snapshotHash"]
    );
    assert_eq!(
        refreshed["gradleSync"]["snapshotHash"], synced["gradleSync"]["snapshotHash"],
        "retain the original provider evaluation receipt"
    );
    fs::write(&sample, serde_json::to_vec(&json!({"request":{"workspaceId":f.binding.workspace_id,"generation":1,"requestId":saved_refresh.request_id,"projectPath":"","sdkHome":request.sdk_home,"mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],"gradle":request.gradle},"response":refreshed})).unwrap()).unwrap();
    let decoded_refresh=Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
        "import{readFileSync}from'node:fs';import{normalizeJavaProjectContext}from'./packages/tauri-adapters/src/java-project-context-tauri.ts';const d=JSON.parse(readFileSync(process.argv[1],'utf8'));if(normalizeJavaProjectContext(d.response,d.request).status!=='available')throw Error('Refreshed context');",sample.to_str().unwrap()]).output().unwrap();
    assert!(
        decoded_refresh.status.success(),
        "{}",
        String::from_utf8_lossy(&decoded_refresh.stderr)
    );
    fs::remove_file(&sample).unwrap();
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "saved-source refresh must not re-evaluate Gradle"
    );
    let unformatted = "package pkg;\npublic class Runner{\npublic String run(){return new Service().message(2);}\n}\n";
    let runner_path = f.root.join("app/src/main/java/pkg/Runner.java");
    fs::write(&runner_path, unformatted).unwrap();
    let refactor_context_response = run(saved_refresh.clone());
    assert_eq!(refactor_context_response["status"], "available");
    let project_context = json!({
        "projectPath":"",
        "sdkHome":request.sdk_home,
        "mavenRepository":"",
        "activeMavenProfiles":[],
        "inactiveMavenProfiles":[],
        "gradle":request.gradle,
        "snapshotHash":refactor_context_response["context"]["snapshotHash"],
        "contextHash":refactor_context_response["context"]["contextHash"],
        "contextSchemaVersion":refactor_context_response["context"]["schemaVersion"],
        "platformIdentities":refactor_context_response["context"]["sdk"].as_array().unwrap()
            .iter().map(|sdk| sdk["identitySha256"].clone()).collect::<Vec<_>>()
    });
    let original_session = state
        .0
        .active
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .session
        .child
        .id();
    let operation_target = json!({
        "kind":"file",
        "path":"app/src/main/java/pkg/Runner.java",
        "identity":"app/src/main/java/pkg/Runner.java"
    });
    let preview_request = serde_json::from_value(json!({
        "operation":"format-file",
        "target":operation_target,
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":7,
        "requestId":"gradle-saved-format",
        "projectContext":project_context
    }))
    .unwrap();
    let refactor_state = super::super::RefactorKitDaemonState::default();
    let preview = super::super::java_context_refactoring::preview_in_gradle_session_at(
        preview_request,
        &refactor_state,
        &state,
        f.binding.clone(),
        &f.root,
    )
    .unwrap();
    assert_eq!(preview["status"], "ready", "{preview}");
    assert_eq!(preview["applyEligibility"]["eligible"], true, "{preview}");
    assert_eq!(fs::read_to_string(&runner_path).unwrap(), unformatted);
    let plan_id = preview["planId"].as_str().unwrap().to_owned();
    let apply_request = serde_json::from_value(json!({
        "projectContext":project_context,
        "planId":plan_id,
        "operation":"format-file",
        "target":operation_target,
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":7,
        "requestId":"gradle-saved-format",
        "approval":{"approvalId":"gradle-format-approval","approvedPlanId":plan_id,"approvedAt":"gradle-format-reviewed"}
    }))
    .unwrap();
    let applied = super::super::java_context_refactoring::apply_in_gradle_session_at(
        apply_request,
        &refactor_state,
        &state,
        f.binding.clone(),
        &f.root,
    )
    .unwrap();
    assert_eq!(applied["outcome"], "applied", "{applied}");
    assert_ne!(fs::read_to_string(&runner_path).unwrap(), unformatted);
    let rollback_request = serde_json::from_value(json!({
        "transactionId":applied["transactionId"],
        "operation":"format-file",
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "requestId":"gradle-saved-format-rollback",
        "projectContext":project_context,
        "expectedSnapshotHash":applied["appliedSnapshotHash"]
    }))
    .unwrap();
    let rolled_back = super::super::java_context_refactoring::rollback_in_gradle_session_at(
        rollback_request,
        &refactor_state,
        &state,
        f.binding.clone(),
        &f.root,
    )
    .unwrap();
    assert_eq!(rolled_back["rolledBack"], true, "{rolled_back}");
    assert_eq!(fs::read_to_string(&runner_path).unwrap(), unformatted);
    let rename_context_response = run(saved_refresh.clone());
    assert_eq!(rename_context_response["status"], "available");
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "ordinary synchronization after rollback must reuse Gradle evaluation"
    );
    let rename_project_context = json!({
        "projectPath":"",
        "sdkHome":request.sdk_home,
        "mavenRepository":"",
        "activeMavenProfiles":[],
        "inactiveMavenProfiles":[],
        "gradle":request.gradle,
        "snapshotHash":rename_context_response["context"]["snapshotHash"],
        "contextHash":rename_context_response["context"]["contextHash"],
        "contextSchemaVersion":rename_context_response["context"]["schemaVersion"],
        "platformIdentities":rename_context_response["context"]["sdk"].as_array().unwrap()
            .iter().map(|sdk| sdk["identitySha256"].clone()).collect::<Vec<_>>()
    });
    let service_path = f.root.join("library/src/main/java/pkg/Service.java");
    let renamed_service_path = f.root.join("library/src/main/java/pkg/RenamedService.java");
    let class_target = json!({
        "kind":"class",
        "path":"library/src/main/java/pkg/Service.java",
        "identity":"pkg.Service"
    });
    let rename_request = serde_json::from_value(json!({
        "operation":"rename-class",
        "target":class_target,
        "changeIntent":{"operation":"rename-class","newName":"RenamedService"},
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":8,
        "requestId":"gradle-cross-module-rename",
        "projectContext":rename_project_context
    }))
    .unwrap();
    let rename_preview = super::super::java_context_refactoring::preview_in_gradle_session_at(
        rename_request,
        &refactor_state,
        &state,
        f.binding.clone(),
        &f.root,
    )
    .unwrap();
    assert_eq!(rename_preview["status"], "ready", "{rename_preview}");
    assert_eq!(
        rename_preview["applyEligibility"]["eligible"], true,
        "{rename_preview}"
    );
    assert!(rename_preview["renderedDiff"]
        .as_str()
        .unwrap()
        .contains("RenamedService"));
    let rename_plan_id = rename_preview["planId"].as_str().unwrap().to_owned();
    let rename_apply_request = serde_json::from_value(json!({
        "projectContext":rename_project_context,
        "planId":rename_plan_id,
        "operation":"rename-class",
        "target":class_target,
        "changeIntent":{"operation":"rename-class","newName":"RenamedService"},
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":8,
        "requestId":"gradle-cross-module-rename",
        "approval":{"approvalId":"gradle-rename-approval","approvedPlanId":rename_plan_id,"approvedAt":"gradle-rename-reviewed"}
    }))
    .unwrap();
    let rename_applied = super::super::java_context_refactoring::apply_in_gradle_session_at(
        rename_apply_request,
        &refactor_state,
        &state,
        f.binding.clone(),
        &f.root,
    )
    .unwrap();
    assert_eq!(rename_applied["outcome"], "applied", "{rename_applied}");
    assert!(!service_path.exists());
    assert!(fs::read_to_string(&renamed_service_path)
        .unwrap()
        .contains("class RenamedService"));
    assert!(fs::read_to_string(&runner_path)
        .unwrap()
        .contains("new RenamedService()"));
    let compile_output = f.root.join("gradle-refactor-compile-check");
    fs::create_dir_all(&compile_output).unwrap();
    let javac = Path::new(&home)
        .join("bin")
        .join(format!("javac{}", std::env::consts::EXE_SUFFIX));
    let compile = Command::new(javac)
        .current_dir(&f.root)
        .args(["--release", "17", "-d"])
        .arg(&compile_output)
        .arg(&renamed_service_path)
        .arg(&runner_path)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&compile.stdout),
        String::from_utf8_lossy(&compile.stderr)
    );
    fs::remove_dir_all(&compile_output).unwrap();
    let rename_rollback_request = serde_json::from_value(json!({
        "transactionId":rename_applied["transactionId"],
        "operation":"rename-class",
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "requestId":"gradle-cross-module-rename-rollback",
        "projectContext":rename_project_context,
        "expectedSnapshotHash":rename_applied["appliedSnapshotHash"]
    }))
    .unwrap();
    let rename_rolled_back = super::super::java_context_refactoring::rollback_in_gradle_session_at(
        rename_rollback_request,
        &refactor_state,
        &state,
        f.binding.clone(),
        &f.root,
    )
    .unwrap();
    assert_eq!(
        rename_rolled_back["rolledBack"], true,
        "{rename_rolled_back}"
    );
    assert_eq!(fs::read_to_string(&service_path).unwrap(), inputs[3].1);
    assert_eq!(fs::read_to_string(&runner_path).unwrap(), unformatted);
    assert_eq!(
        state
            .0
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .session
            .child
            .id(),
        original_session,
        "saved-source Gradle refactoring and rollback reuse the evaluated daemon session"
    );
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "saved-source Gradle refactoring and rollback must not evaluate build scripts"
    );
    fs::write(f.root.join(inputs[4].0), inputs[4].1).unwrap();
    // The saved-source cases acquired v2 contexts and changed snapshots. Bind the
    // negative navigation cases to a current v7 context before testing their cause.
    qualified_request.expected_snapshot_hash = None;
    let current = run(qualified_request.clone());
    assert_eq!(current["status"], "available", "{current}");
    let bind_current_context = |navigation: &mut Value, response: &Value| {
        let context = &response["context"];
        for (authority_key, context_key) in [
            ("snapshotHash", "snapshotHash"),
            ("contextHash", "contextHash"),
            ("contextSchemaVersion", "schemaVersion"),
        ] {
            navigation["projectContext"][authority_key] = context[context_key].clone();
        }
        navigation["projectContext"]["platformIdentities"] = json!(context["sdk"]
            .as_array()
            .unwrap()
            .iter()
            .map(|sdk| sdk["identitySha256"].clone())
            .collect::<Vec<_>>());
    };
    bind_current_context(&mut navigation, &current);
    // Undo produced newer editor versions; use those returned images rather than
    // replaying the original pre-transaction overlay versions.
    navigation["editorOverlay"]["documents"] = transaction_documents.clone();
    navigation["document"] = transaction_documents
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["path"] == navigation["document"]["path"])
        .unwrap()
        .clone();
    let (line, text) = navigation["document"]["text"]
        .as_str()
        .unwrap()
        .lines()
        .enumerate()
        .find(|(_, text)| text.contains("message("))
        .unwrap();
    navigation["position"] = json!({"line":line,"character":text.find("message(").unwrap()});
    navigation["requestId"] = json!("gradle-current-draft");
    let mut definition_probe = navigation.clone();
    definition_probe["kind"] = json!("definition");
    definition_probe
        .as_object_mut()
        .unwrap()
        .remove("editorRefactoring");
    let ready = navigate(&definition_probe);
    assert_eq!(ready["status"], "ready", "{ready}");
    // A saved source can invalidate a read-only query without invalidating the
    // evaluated Gradle build. Retire semantic authority and refresh in this daemon.
    fs::write(
        f.root.join(inputs[4].0),
        format!("{}\n// saved after context acquisition\n", inputs[4].1),
    )
    .unwrap();
    let stale_source = navigate(&definition_probe);
    assert_eq!(stale_source["status"], "refused", "{stale_source}");
    assert_eq!(
        stale_source["projectContextRetired"], true,
        "{stale_source}"
    );
    {
        let active = state.0.active.lock().unwrap();
        let active = active
            .as_ref()
            .expect("a typed source snapshot refusal must retain the daemon");
        assert!(active.context.is_none());
        assert!(active.has_gradle_evaluation());
        assert_eq!(active.session.child.id(), original_session);
    }
    assert_eq!(
        navigate(&definition_probe)["status"],
        "refused",
        "a retired context must not authorize another query"
    );
    let refreshed_source = run(saved_refresh.clone());
    assert_eq!(
        refreshed_source["status"], "available",
        "{refreshed_source}"
    );
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "source recovery must not evaluate Gradle again"
    );
    fs::write(f.root.join(inputs[4].0), inputs[4].1).unwrap();
    let restored_context = run(qualified_request.clone());
    assert_eq!(
        restored_context["status"], "available",
        "{restored_context}"
    );
    bind_current_context(&mut navigation, &restored_context);
    assert_eq!(
        state
            .0
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .session
            .child
            .id(),
        original_session
    );
    let mut wrong = navigation.clone();
    wrong["projectContext"]["gradle"]["projectProperties"] = json!({"changed":"true"});
    assert_eq!(navigate(&wrong)["status"], "refused");
    fs::write(
        f.root.join("build.gradle"),
        format!("{}\n// changed after synchronization\n", inputs[2].1),
    )
    .unwrap();
    let mut read_only_build_probe = navigation.clone();
    read_only_build_probe
        .as_object_mut()
        .unwrap()
        .remove("editorRefactoring");
    read_only_build_probe["kind"] = json!("definition");
    let stale_build = navigate(&read_only_build_probe);
    assert_eq!(stale_build["status"], "refused", "{stale_build}");
    assert_eq!(stale_build["projectContextRetired"], true, "{stale_build}");
    assert_ne!(
        run(saved_refresh.clone())["status"],
        "available",
        "retaining a live daemon must not renew changed build metadata"
    );
    assert_eq!(
        navigate(&navigation)["status"],
        "refused",
        "changed build inputs must retire effective Gradle authority"
    );
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "stale build evidence must not cause automatic re-evaluation"
    );
    assert_ne!(
        run(saved_refresh)["status"],
        "available",
        "ordinary refresh must not renew obsolete Gradle build metadata"
    );
    assert_eq!(
        fs::read(&marker).unwrap(),
        evaluations,
        "changed build inputs must require explicit evaluation"
    );
    fs::write(f.root.join("build.gradle"), inputs[2].1).unwrap();
    // Renew the deliberately invalidated build metadata explicitly. The loss
    // assertion must use this current session, rather than stale request authority.
    let mut reevaluate = request.clone();
    reevaluate.expected_snapshot_hash = None;
    reevaluate.expected_context_hash = None;
    reevaluate.module_id = None;
    reevaluate.source_set_id = None;
    reevaluate.source_relative_path = None;
    reevaluate.evaluate_gradle = Some(true);
    let synchronized = run(reevaluate);
    assert_eq!(synchronized["status"], "available", "{synchronized}");
    let current = run(qualified_request);
    assert_eq!(current["status"], "available", "{current}");
    bind_current_context(&mut navigation, &current);
    let explicit_evaluations = fs::read(&marker).unwrap();
    assert!(explicit_evaluations.len() > evaluations.len());
    // Simulate a recoverable daemon loss. shutdown_all() terminates the manager itself,
    // so it cannot be followed by the expected partial context reacquisition.
    {
        let mut active = state.0.active.lock().unwrap();
        let child = &mut active.as_mut().unwrap().session.child;
        child.kill().unwrap();
        child.wait().unwrap();
    }
    let lost_session = navigate(&navigation);
    assert_eq!(lost_session["status"], "refused");
    assert_eq!(lost_session["projectContextRetired"], true);
    assert!(state.0.active.lock().unwrap().is_none());
    let mut fresh = request.clone();
    fresh.expected_snapshot_hash = None;
    fresh.expected_context_hash = None;
    fresh.module_id = None;
    fresh.source_set_id = None;
    fresh.source_relative_path = None;
    assert_eq!(run(fresh)["status"], "partial");
    assert_eq!(
        fs::read(&marker).unwrap(),
        explicit_evaluations,
        "session loss must never silently re-evaluate Gradle"
    );
    for (path, text) in inputs {
        assert_eq!(fs::read_to_string(f.root.join(path)).unwrap(), text);
    }
    state.shutdown_all();
    navigation_state.shutdown_all();
}

struct Fixture {
    root: PathBuf,
    binding: CurrentWorkspaceBinding,
    sdk: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-java-project-context-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let sdk = root.join("sdk");
        fs::create_dir_all(sdk.join("bin")).unwrap();
        fs::create_dir_all(sdk.join("lib")).unwrap();
        fs::write(sdk.join("release"), "JAVA_VERSION=\"21\"\n").unwrap();
        fs::write(
            sdk.join("lib/ct.sym"),
            "test metadata only; no provider is executed",
        )
        .unwrap();
        fs::write(
            sdk.join(if cfg!(windows) {
                "bin/javac.exe"
            } else {
                "bin/javac"
            }),
            "",
        )
        .unwrap();
        let registry = root.join("registry.json");
        crate::commands::workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = current_workspace_binding_at(&root, &registry).unwrap();
        Self { root, binding, sdk }
    }
    fn request(&self) -> Request {
        serde_json::from_value(json!({"workspaceId": self.binding.workspace_id, "generation": 1, "requestId": "context-1", "projectPath": "", "sdkHome": self.sdk,
            "mavenRepository": "", "activeMavenProfiles": [], "inactiveMavenProfiles": []})).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn capabilities() -> Value {
    json!({"apiVersion": "0.2", "version": "0.7.0", "methods": [{"name":"project.context", "requiresProject":true, "writesWorkspace":false,
        "features": {"typedSchemaV1":true, "snapshotBound":true, "configuredSdkEvidence":true, "orderedCompileRuntimeClasspaths":true,
            "sharedJdtBuildContext":true, "staleEvidenceRefusal":true}}]})
}
fn partial(f: &Fixture) -> Value {
    json!({"schemaVersion":"java-project-context-v1", "status":"partial", "snapshotHash":"a".repeat(64), "contextHash":"b".repeat(64),
        "sdk":[{"home":f.sdk}], "providers":[{"providerId":"gradle-declarative-v1", "status":"partial", "buildCodeExecution":"denied", "credentialsAccess":"denied", "networkAccess":"denied"}], "refusal":null})
}

#[test]
fn context_schema_v2_is_preserved_and_unknown_versions_are_refused() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let snapshot = "a".repeat(64);
    let mut response = partial(&fixture);
    response["schemaVersion"] = json!("java-project-context-v2");
    let normalized = normalize(response, &request, &snapshot, &fixture.sdk, "0.8.0").unwrap();
    assert_eq!(
        normalized["context"]["schemaVersion"],
        "java-project-context-v2"
    );
    assert_eq!(normalized["context"]["contextHash"], "b".repeat(64));

    let mut unsupported = partial(&fixture);
    unsupported["schemaVersion"] = json!("java-project-context-v4");
    assert!(normalize(unsupported, &request, &snapshot, &fixture.sdk, "0.8.0").is_err());
}

#[test]
fn provider_qualified_context_requires_v3_and_preserves_the_provider_selector() {
    let fixture = Fixture::new();
    let snapshot = "a".repeat(64);
    let mut request = fixture.request();
    request.module_id = Some("app".into());
    request.source_set_id = Some("main".into());
    request.provider_id = Some("maven-effective-v1".into());
    assert!(valid_required_facts(&request));
    let params = context_params(&request, &snapshot, &fixture.sdk, "project.context.v3");
    assert_eq!(params["providerId"], "maven-effective-v1");

    let mut response_v2 = partial(&fixture);
    response_v2["schemaVersion"] = json!("java-project-context-v2");
    assert!(normalize(response_v2, &request, &snapshot, &fixture.sdk, "0.8.0").is_err());

    let mut response_v3 = partial(&fixture);
    response_v3["schemaVersion"] = json!("java-project-context-v3");
    assert_eq!(
        normalize(response_v3, &request, &snapshot, &fixture.sdk, "0.8.0").unwrap()["context"]
            ["schemaVersion"],
        "java-project-context-v3"
    );

    let mut unqualified = fixture.request();
    let mut response_v3 = partial(&fixture);
    response_v3["schemaVersion"] = json!("java-project-context-v3");
    assert!(normalize(response_v3, &unqualified, &snapshot, &fixture.sdk, "0.8.0").is_err());
    unqualified.provider_id = Some("maven-effective-v1".into());
    assert!(!valid_required_facts(&unqualified));
}

#[test]
fn aggregate_gradle_composite_context_requires_explicit_sync_and_uses_the_v3_endpoint() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.gradle = Some(GradleSettings {
        executable: "/gradle".into(),
        user_home: String::new(),
        gradle_runtime_home: None,
        project_properties: BTreeMap::new(),
    });
    request.evaluate_gradle = Some(true);
    request.aggregate_gradle_composite_context = Some(true);

    assert_eq!(
        context_method(&request, &json!({})),
        "project.context.aggregate"
    );
    assert!(validate(&request, &fixture.binding).is_ok());
    let params = context_params(
        &request,
        &"a".repeat(64),
        &fixture.sdk,
        "project.context.aggregate",
    );
    assert_eq!(params["expectedSnapshotHash"], "a".repeat(64));
    assert_eq!(params["sdkHome"], fixture.sdk.to_string_lossy().as_ref());
    assert!(params.get("providerId").is_none());
    assert!(params.get("moduleId").is_none());

    let mut unqualified = request.clone();
    unqualified.evaluate_gradle = None;
    assert!(validate(&unqualified, &fixture.binding).is_err());
    let mut selected = request;
    selected.provider_id = Some("gradle-effective-v1".into());
    selected.module_id = Some("app".into());
    selected.source_set_id = Some("main".into());
    assert!(validate(&selected, &fixture.binding).is_err());
}

#[test]
fn aggregate_gradle_context_capability_requires_all_read_only_identity_features() {
    let capability = json!({"methods":[{"name":"project.context.aggregate","requiresProject":true,"writesWorkspace":false,
        "features":{"typedSchemaV3":true,"aggregateGradleCompositeBuildIdentity":true,
            "requiresExplicitGradleSync":true,"snapshotBound":true,"readOnly":true}}]});
    assert!(aggregate_gradle_composite_identity_advertised(&capability));
    for feature in [
        "typedSchemaV3",
        "aggregateGradleCompositeBuildIdentity",
        "requiresExplicitGradleSync",
        "snapshotBound",
        "readOnly",
    ] {
        let mut incomplete = capability.clone();
        incomplete["methods"][0]["features"][feature] = json!(false);
        assert!(!aggregate_gradle_composite_identity_advertised(&incomplete));
    }
}

#[test]
fn maven_failsafe_context_request_uses_v4_and_selects_by_source_set_kind() {
    let fixture = Fixture::new();
    let snapshot = "a".repeat(64);
    let mut request = fixture.request();
    request.provider_id = Some("maven-effective-v1".into());
    request.module_id = Some("app".into());
    request.source_set_kind = Some("integration-test".into());

    assert!(valid_required_facts(&request));
    let capabilities = json!({"methods":[{"name":"project.context.v4","requiresProject":true,
        "writesWorkspace":false,"features":{"typedSchemaV4":true,"mavenFailsafeExecutionMetadata":true}}]});
    assert_eq!(
        context_method(&request, &capabilities),
        "project.context.v4"
    );
    let params = context_params(&request, &snapshot, &fixture.sdk, "project.context.v4");
    assert_eq!(params["providerId"], "maven-effective-v1");
    assert_eq!(params["moduleId"], "app");
    assert_eq!(params["sourceSetKind"], "integration-test");
    assert!(params["sourceSetId"].is_null());

    let mut id_request = request;
    id_request.source_set_kind = None;
    id_request.source_set_id = Some("integrationTest".into());
    assert_eq!(
        context_method(&id_request, &capabilities),
        "project.context"
    );
}

#[test]
fn required_jpms_facts_select_v5_when_available_and_keep_legacy_fallbacks() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.provider_id = Some("maven-effective-v1".into());
    request.module_id = Some("app".into());
    request.source_set_id = Some("main".into());
    request.required_facts = Some(vec!["jpms".into()]);
    let mut kind_request = request.clone();
    kind_request.source_set_id = None;
    kind_request.source_set_kind = Some("main".into());

    let v5 = json!({"methods":[{"name":"project.context.v5","requiresProject":true,
        "writesWorkspace":false,"features":{"typedSchemaV5":true,"providerQualifiedSourceAssociation":true,
            "standardJpmsDirectives":true,"closedLegacySchemas":true,"mavenFailsafeExecutionMetadata":true}}]});
    assert_eq!(context_method(&request, &v5), "project.context.v5");
    assert_eq!(context_method(&kind_request, &v5), "project.context.v5");
    assert!(provider_qualified_source_association_advertised(&v5));
    assert!(java_project_context_v5_advertised(&v5));

    let v4 = json!({"methods":[{"name":"project.context.v4","requiresProject":true,
        "writesWorkspace":false,"features":{"typedSchemaV4":true,"mavenFailsafeExecutionMetadata":true}}]});
    assert_eq!(context_method(&request, &v4), "project.context.v4");

    assert_eq!(context_method(&request, &json!({})), "project.context");
}

#[test]
fn v6_metadata_context_is_advertised_as_a_fallback_and_may_omit_source_analysis() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.provider_id = Some("maven-effective-v1".into());
    request.module_id = Some("app".into());
    request.source_set_id = Some("main".into());
    let capabilities = json!({"apiVersion":"0.2","version":"0.8.0","methods":[{
        "name":"project.context.v6","requiresProject":true,"writesWorkspace":false,
        "features":{"typedSchemaV6":true,"providerQualifiedSourceAssociation":true,
            "snapshotBound":true,"configuredSdkEvidence":true,"orderedCompileRuntimeClasspaths":true,
            "sharedJdtBuildContext":true,"staleEvidenceRefusal":true}
    }]});
    assert!(advertised(&capabilities));
    assert!(provider_qualified_source_association_advertised(
        &capabilities
    ));
    assert!(java_project_context_v6_advertised(&capabilities));
    assert_eq!(context_method(&request, &capabilities), "project.context");

    let snapshot = "a".repeat(64);
    let response = json!({
        "schemaVersion":"java-project-context-v6",
        "status":"available",
        "snapshotHash":snapshot,
        "contextHash":"b".repeat(64),
        "sdk":[{"home":fixture.sdk}],
        "providers":[{"providerId":"maven-effective-v1","status":"available",
            "buildCodeExecution":"denied","credentialsAccess":"denied","networkAccess":"denied"}],
        "modules":[{"providerId":"maven-effective-v1","id":"app","sourceSets":[{"id":"main"}]}],
        "analysis":null,
        "semanticAnalysis":{"availability":"unqualified","refusalCode":"java.context.sourceAnalysisUnqualified"},
        "selectedSource":null,
        "refusal":null
    });
    assert!(normalize(response.clone(), &request, &snapshot, &fixture.sdk, "0.8.0").is_ok());

    let mut owner_request = request.clone();
    owner_request.provider_id = Some("maven-effective-v1".into());
    owner_request.module_id = Some("app".into());
    owner_request.source_set_id = Some("test".into());
    owner_request.source_relative_path = Some("pkg/Runner.java".into());
    let mut owner_only = response.clone();
    owner_only["modules"][0]["providerId"] = json!("maven-effective-v1");
    owner_only["modules"][0]["id"] = json!("app");
    owner_only["modules"][0]["sourceSets"][0]["id"] = json!("test");
    owner_only["modules"][0]["sourceSets"][0]["kind"] = json!("test");
    owner_only["modules"][0]["sourceSets"][0]["sourceRoots"] = json!(["src/test/java"]);
    owner_only["modules"][0]["sourceSets"][0]["generatedSourceRoots"] = json!([]);
    owner_only["selectedSource"] = json!({
        "path":"src/test/java/pkg/Runner.java",
        "symbol":null,
        "providerId":"maven-effective-v1",
        "moduleId":"app",
        "sourceSetId":"test",
        "sourceRoot":"src/test/java",
        "generated":false,
        "bindingKey":null,
        "evidence":"SOURCE_ROOT_OWNERSHIP"
    });
    assert!(normalize(owner_only, &owner_request, &snapshot, &fixture.sdk, "0.8.0").is_err());

    let mut malformed = response;
    malformed["semanticAnalysis"]["refusalCode"] = json!(null);
    assert!(normalize(malformed, &request, &snapshot, &fixture.sdk, "0.8.0").is_err());
}

#[test]
fn v7_context_advertisement_selects_origin_bearing_maven_test_jvm_facts() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    let capabilities = json!({"apiVersion":"0.2","version":"0.8.0","methods":[{
        "name":"project.context.v7","requiresProject":true,"writesWorkspace":false,
        "features":{"typedSchemaV7":true,"providerQualifiedSourceAssociation":true,
            "sourceSetKindSelection":true,"mavenFailsafeExecutionMetadata":true,
            "mavenTestJvmSettings":true,"testJvmSettingsAreSourceSetBound":true,
            "explicitOriginsOnly":true,
            "preservesArgLineLateTokens":true,"standardJpmsDirectives":true,
            "readOnlyBuildDiscovery":true,"metadataOnlyUnqualifiedJavaSourceAnalysis":true}
    }]});
    assert!(advertised(&capabilities));
    assert!(java_project_context_v7_advertised(&capabilities));
    assert!(provider_qualified_source_association_advertised(
        &capabilities
    ));
    assert!(maven_failsafe_context_advertised(&capabilities));
    assert_eq!(context_method(&request, &capabilities), "project.context");
    request.provider_id = Some("maven-effective-v1".into());
    request.module_id = Some("app".into());
    request.source_set_id = Some("test".into());
    assert_eq!(
        context_method(&request, &capabilities),
        "project.context.v7"
    );

    let snapshot = "a".repeat(64);
    let response = json!({
        "schemaVersion":"java-project-context-v7",
        "status":"available",
        "snapshotHash":snapshot,
        "contextHash":"b".repeat(64),
        "sdk":[{"home":fixture.sdk}],
        "providers":[{"providerId":"maven-effective-v1","status":"available",
            "buildCodeExecution":"denied","credentialsAccess":"denied","networkAccess":"denied"}],
        "modules":[{"providerId":"maven-effective-v1","id":"app","sourceSets":[{
            "id":"test","mavenFailsafe":{"availability":"not-declared","refusalCode":null,"executions":[]},
            "mavenTestJvm":{"availability":"complete","mode":"forked","refusalCode":null,
                "executions":[{"pluginId":"org.apache.maven.plugins:maven-surefire-plugin",
                    "pluginVersion":"3.5.3","executionId":"default-test","goals":["test"],
                    "phase":"test","mode":"forked","availability":"complete","refusalCode":null,
                    "forkSettings":[],"argLineLayers":[],"effectiveArgLineTemplate":"@{argLine}"}]}
        }]}],
        "analysis":null,
        "semanticAnalysis":{"availability":"unqualified","refusalCode":"java.context.sourceAnalysisUnqualified"},
        "selectedSource":null,
        "refusal":null
    });
    assert!(maven_test_jvm_fact_valid(
        &response["modules"][0]["sourceSets"][0]["mavenTestJvm"]
    ));
    assert!(normalize(response.clone(), &request, &snapshot, &fixture.sdk, "0.8.0").is_ok());

    let mut owner_request = request.clone();
    owner_request.source_relative_path = Some("pkg/Runner.java".into());
    let mut owner_only = response.clone();
    owner_only["modules"][0]["sourceSets"][0]["kind"] = json!("test");
    owner_only["modules"][0]["sourceSets"][0]["sourceRoots"] = json!(["src/test/java"]);
    owner_only["modules"][0]["sourceSets"][0]["generatedSourceRoots"] = json!([]);
    owner_only["selectedSource"] = json!({
        "path":"src/test/java/pkg/Runner.java",
        "symbol":null,
        "providerId":"maven-effective-v1",
        "moduleId":"app",
        "sourceSetId":"test",
        "sourceRoot":"src/test/java",
        "generated":false,
        "bindingKey":null,
        "evidence":"SOURCE_ROOT_OWNERSHIP"
    });
    assert!(normalize(
        owner_only.clone(),
        &owner_request,
        &snapshot,
        &fixture.sdk,
        "0.8.0"
    )
    .is_ok());

    let mut fabricated_binding = owner_only.clone();
    fabricated_binding["selectedSource"]["bindingKey"] = json!("Lpkg/Runner;");
    assert!(normalize(
        fabricated_binding,
        &owner_request,
        &snapshot,
        &fixture.sdk,
        "0.8.0"
    )
    .is_err());

    let mut semantic_request = owner_request.clone();
    semantic_request.symbol = Some("pkg.Runner".into());
    assert!(normalize(
        owner_only.clone(),
        &semantic_request,
        &snapshot,
        &fixture.sdk,
        "0.8.0"
    )
    .is_err());

    let mut mismatched_path = owner_only;
    mismatched_path["selectedSource"]["path"] = json!("src/test/java/pkg/Other.java");
    assert!(normalize(
        mismatched_path,
        &owner_request,
        &snapshot,
        &fixture.sdk,
        "0.8.0"
    )
    .is_err());

    let mut malformed_fact = response.clone();
    malformed_fact["modules"][0]["sourceSets"][0]["mavenTestJvm"]["executions"][0]
        ["forkSettings"] = json!([{
        "name":"forkCount","value":"1","origin":"pom.xml","availability":"complete"
    }]);
    assert!(normalize(malformed_fact, &request, &snapshot, &fixture.sdk, "0.8.0").is_err());

    let mut malformed = response;
    malformed["semanticAnalysis"] = json!({"availability":"available","refusalCode":null});
    assert!(normalize(malformed, &request, &snapshot, &fixture.sdk, "0.8.0").is_err());
}

#[test]
fn v6_context_request_names_provider_module_and_source_set_without_selecting_a_source_path() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.provider_id = Some("maven-effective-v1".into());
    request.module_id = Some("app".into());
    request.source_set_id = Some("main".into());
    let snapshot = "a".repeat(64);

    let maven = context_params(&request, &snapshot, &fixture.sdk, "project.context.v6");
    assert_eq!(maven["providerId"], "maven-effective-v1");
    assert_eq!(maven["moduleId"], "app");
    assert_eq!(maven["sourceSetId"], "main");
    assert!(maven.get("sourceRelativePath").is_none());

    let mut gradle_request = fixture.request();
    gradle_request.provider_id = Some("gradle-effective-v1".into());
    gradle_request.module_id = Some(":".into());
    gradle_request.source_set_id = Some("main".into());
    gradle_request.gradle = Some(
        serde_json::from_value(json!({
            "executable":"/gradle",
            "userHome":"",
            "projectProperties":{}
        }))
        .unwrap(),
    );
    let gradle = context_params(
        &gradle_request,
        &snapshot,
        &fixture.sdk,
        "project.context.v6",
    );
    assert_eq!(gradle["providerId"], "gradle-effective-v1");
    assert_eq!(gradle["moduleId"], ":");
    assert_eq!(gradle["sourceSetId"], "main");

    let legacy_request = fixture.request();
    let legacy = context_params(
        &legacy_request,
        &snapshot,
        &fixture.sdk,
        "project.context.v5",
    );
    assert!(legacy.get("providerId").is_none());
}

#[test]
fn v3_context_paths_are_qualified_from_the_opened_project_to_the_workspace_root() {
    let mut context = json!({
        "schemaVersion":"java-project-context-v3",
        "modules":[{
            "buildRoot":"included-build",
            "root":"app",
            "sourceSets":[{
                "sourceRoots":["app/src/main/java"],
                "generatedSourceRoots":["app/build/generated"],
                "outputDirectories":["app/build/classes", "."],
                "analysisSourceRoots":["app/src/main/java"],
                "compileClasspath":[{"path":"app/build/classes"}, {"path":"/cache/dependency.jar"}],
                "runtimeClasspath":[{"path":"app/build/classes"}],
                "sourceRootEvidence":[{"path":"app/src/main/java", "descriptorPath":"included-build/build.gradle"}],
                "annotationProcessors":{"processorPath":["app/build/processor", "/cache/processor.jar"]},
                "jpms":{"modulePath":[{"path":"app/module-path"}]}
            }]
        }],
        "buildEvidence":[{"path":"settings.gradle"}],
        "selectedSource":{"path":"app/src/main/java/pkg/Runner.java", "sourceRoot":"app/src/main/java"}
    });

    qualify_context_paths(&mut context, "gradle");

    assert_eq!(context["modules"][0]["buildRoot"], "gradle/included-build");
    assert_eq!(context["modules"][0]["root"], "gradle/app");
    assert_eq!(
        context["modules"][0]["sourceSets"][0]["sourceRoots"][0],
        "gradle/app/src/main/java"
    );
    assert_eq!(
        context["modules"][0]["sourceSets"][0]["outputDirectories"][1],
        "gradle"
    );
    assert_eq!(
        context["modules"][0]["sourceSets"][0]["compileClasspath"][1]["path"],
        "/cache/dependency.jar"
    );
    assert_eq!(
        context["modules"][0]["sourceSets"][0]["sourceRootEvidence"][0]["descriptorPath"],
        "gradle/included-build/build.gradle"
    );
    assert_eq!(
        context["modules"][0]["sourceSets"][0]["annotationProcessors"]["processorPath"][1],
        "/cache/processor.jar"
    );
    assert_eq!(
        context["modules"][0]["sourceSets"][0]["jpms"]["modulePath"][0]["path"],
        "gradle/app/module-path"
    );
    assert_eq!(
        context["buildEvidence"][0]["path"],
        "gradle/settings.gradle"
    );
    assert_eq!(
        context["selectedSource"]["path"],
        "gradle/app/src/main/java/pkg/Runner.java"
    );

    let mut selected_project_root = json!({
        "schemaVersion":"java-project-context-v5",
        "modules":[{"buildRoot":".","root":"","sourceSets":[{"sourceRoots":["src/main/java"]}]}]
    });
    qualify_context_paths(&mut selected_project_root, "gradle");
    assert_eq!(selected_project_root["modules"][0]["buildRoot"], "gradle");
    assert_eq!(selected_project_root["modules"][0]["root"], "gradle");
    assert_eq!(
        selected_project_root["modules"][0]["sourceSets"][0]["sourceRoots"][0],
        "gradle/src/main/java"
    );
}

#[test]
fn available_context_must_resolve_one_requested_module_source_set_and_provider() {
    let fixture = Fixture::new();
    let snapshot = "a".repeat(64);
    let mut request = fixture.request();
    request.module_id = Some("app".into());
    request.source_set_id = Some("main".into());
    request.provider_id = Some("maven-effective-v1".into());
    let providers = json!([
        {"providerId":"maven-effective-v1", "status":"available", "buildCodeExecution":"denied", "credentialsAccess":"denied", "networkAccess":"denied"},
        {"providerId":"gradle-effective-v1", "status":"available", "buildCodeExecution":"denied", "credentialsAccess":"denied", "networkAccess":"denied"}
    ]);
    let modules = json!([
        {"providerId":"maven-effective-v1", "id":"app", "sourceSets":[{"id":"main"}]},
        {"providerId":"gradle-effective-v1", "id":"app", "sourceSets":[{"id":"main"}]}
    ]);
    let available = |schema: &str| {
        json!({"schemaVersion":schema, "status":"available", "snapshotHash":snapshot,
            "contextHash":"b".repeat(64), "sdk":[{"home":fixture.sdk}], "providers":providers,
            "modules":modules, "analysis":{"backend":"eclipse-jdt", "snapshotHash":snapshot}, "refusal":null})
    };
    let response_v3 = available("java-project-context-v3");
    assert!(normalize(
        response_v3.clone(),
        &request,
        &snapshot,
        &fixture.sdk,
        "0.8.0"
    )
    .is_ok());

    let mut legacy_request = request;
    legacy_request.provider_id = None;
    let response_v2 = available("java-project-context-v2");
    assert!(normalize(
        response_v2,
        &legacy_request,
        &snapshot,
        &fixture.sdk,
        "0.8.0"
    )
    .is_err());
}

#[test]
fn operation_context_schema_version_is_closed_to_supported_versions() {
    assert!(valid_context_schema_version("java-project-context-v1"));
    assert!(valid_context_schema_version("java-project-context-v2"));
    assert!(valid_context_schema_version("java-project-context-v3"));
    assert!(valid_context_schema_version("java-project-context-v4"));
    assert!(valid_context_schema_version("java-project-context-v5"));
    assert!(valid_context_schema_version("java-project-context-v6"));
    assert!(valid_context_schema_version("java-project-context-v7"));

    let fixture = Fixture::new();
    let result = validate_operation_settings(
        &fixture.binding,
        1,
        "java-project-context-v3",
        "",
        &fixture.sdk.to_string_lossy(),
        "",
        &[],
        &[],
    );
    assert!(result.is_ok());
}

#[test]
fn maven_failsafe_context_capability_requires_a_typed_read_only_method() {
    let base = json!({"methods":[{"name":"project.context.v4","requiresProject":true,
        "writesWorkspace":false,"features":{"typedSchemaV4":true,"mavenFailsafeExecutionMetadata":true}}]});
    assert!(maven_failsafe_context_advertised(&base));

    let mut unsupported = base.clone();
    unsupported["methods"][0]["writesWorkspace"] = json!(true);
    assert!(!maven_failsafe_context_advertised(&unsupported));
    let mut missing = base;
    missing["methods"][0]["features"]["mavenFailsafeExecutionMetadata"] = json!(false);
    assert!(!maven_failsafe_context_advertised(&missing));

    let v5 = json!({"methods":[{"name":"project.context.v5","requiresProject":true,
        "writesWorkspace":false,"features":{"typedSchemaV5":true,
            "providerQualifiedSourceAssociation":true,"standardJpmsDirectives":true,
            "closedLegacySchemas":true,"mavenFailsafeExecutionMetadata":true}}]});
    assert!(maven_failsafe_context_advertised(&v5));
    let mut incomplete_v5 = v5;
    for feature in [
        "typedSchemaV5",
        "providerQualifiedSourceAssociation",
        "standardJpmsDirectives",
        "closedLegacySchemas",
        "mavenFailsafeExecutionMetadata",
    ] {
        incomplete_v5["methods"][0]["features"][feature] = json!(false);
        assert!(!java_project_context_v5_advertised(&incomplete_v5));
        assert!(!maven_failsafe_context_advertised(&incomplete_v5));
        incomplete_v5["methods"][0]["features"][feature] = json!(true);
    }
}

#[test]
fn selected_context_identity_includes_its_schema_version() {
    let stored = json!({
        "status": "available",
        "schemaVersion": "java-project-context-v2",
        "snapshotHash": "a".repeat(64),
        "contextHash": "b".repeat(64),
        "sdk": [{"identitySha256": "c".repeat(64)}]
    });
    let expected = json!({
        "contextSchemaVersion": "java-project-context-v2",
        "snapshotHash": "a".repeat(64),
        "contextHash": "b".repeat(64),
        "platformIdentities": ["c".repeat(64)]
    });
    assert!(selected_context_matches(&stored, &expected));

    let mut downgraded = expected.clone();
    downgraded["contextSchemaVersion"] = json!("java-project-context-v1");
    assert!(!selected_context_matches(&stored, &downgraded));
}

#[test]
fn required_project_facts_are_bounded_unique_and_scoped_to_one_source_set() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.required_facts = Some(vec!["compiler-options".into()]);
    assert!(valid_required_facts(&request));
    let project_wide = context_params(&request, &"a".repeat(64), &fixture.sdk, "project.context");
    assert_eq!(project_wide["requiredFacts"], json!(["compiler-options"]));
    assert!(project_wide.get("moduleId").is_none());

    request.module_id = Some("app".into());
    request.source_set_id = Some("main".into());
    assert!(valid_required_facts(&request));
    let params = context_params(&request, &"a".repeat(64), &fixture.sdk, "project.context");
    assert_eq!(params["requiredFacts"], json!(["compiler-options"]));
    assert_eq!(params["moduleId"], "app");
    assert_eq!(params["sourceSetId"], "main");

    request.required_facts = Some(vec!["compiler-options".into(), "compiler-options".into()]);
    assert!(!valid_required_facts(&request));
    request.required_facts = Some(vec!["unknown".into()]);
    assert!(!valid_required_facts(&request));
    request.required_facts = Some(vec![
        "source-root-provenance".into(),
        "compiler-options".into(),
        "artifact-coordinates".into(),
        "annotation-processors".into(),
        "jpms".into(),
        "jpms".into(),
    ]);
    assert!(!valid_required_facts(&request));
}

#[cfg(unix)]
#[test]
fn first_context_acquisition_retries_one_fresh_snapshot_but_explicit_context_does_not_rebase() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = super::super::daemon_env_test_lock();
    struct RestoreDaemon(Option<std::ffi::OsString>);
    impl Drop for RestoreDaemon {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }

    let f = Fixture::new();
    let daemon = f.root.join("snapshot-retry-daemon.py");
    let log = f.root.join("snapshot-retry-requests.jsonl");
    let initial = "a".repeat(64);
    let fresh = "b".repeat(64);
    let later = "c".repeat(64);
    let mut available = partial(&f);
    available["snapshotHash"] = json!(fresh);
    let response_dir = f.root.join("responses");
    fs::create_dir_all(&response_dir).unwrap();
    let responses = [
        (
            "capabilities",
            json!({"jsonrpc":"2.0", "id":1, "result":capabilities()}),
        ),
        (
            "open",
            json!({"jsonrpc":"2.0", "id":2, "result":{"root":f.root, "snapshotHash":initial, "indexGeneration":1}}),
        ),
        (
            "stale-first",
            json!({"jsonrpc":"2.0", "id":3, "result":{"schemaVersion":"java-project-context-v1", "status":"refused", "snapshotHash":fresh, "refusal":{"code":"java.context.snapshotStale", "message":"Project inputs changed"}}}),
        ),
        (
            "available",
            json!({"jsonrpc":"2.0", "id":4, "result":available}),
        ),
        (
            "stale-explicit",
            json!({"jsonrpc":"2.0", "id":5, "result":{"schemaVersion":"java-project-context-v1", "status":"refused", "snapshotHash":later, "refusal":{"code":"java.context.snapshotStale", "message":"Project inputs changed"}}}),
        ),
    ];
    for (name, response) in responses {
        fs::write(
            response_dir.join(name),
            format!("{}\n", serde_json::to_string(&response).unwrap()),
        )
        .unwrap();
    }
    let response_path = |name: &str| response_dir.join(name).display().to_string();
    let script = format!(
        "#!/bin/sh\n\
context_calls=0\n\
while IFS= read -r line; do\n\
  printf '%s\\n' \"$line\" >> '{log}'\n\
  case \"$line\" in\n\
    *'\"method\":\"server.capabilities\"'*) cat '{capabilities}' ;;\n\
    *'\"method\":\"project.open\"'*) cat '{open}' ;;\n\
    *'\"method\":\"patch.recover\"'*) cat '{recover}' ;;\n\
    *'\"method\":\"project.context\"'*)\n\
      context_calls=$((context_calls + 1))\n\
      case \"$context_calls\" in\n\
        1) cat '{stale_first}' ;;\n\
        2) cat '{available}' ;;\n\
        *) cat '{stale_explicit}' ;;\n\
      esac ;;\n\
    *) exit 1 ;;\n\
  esac\n\
done\n",
        log = log.display(),
        capabilities = response_path("capabilities"),
        open = response_path("open"),
        recover = response_path("recover"),
        stale_first = response_path("stale-first"),
        available = response_path("available"),
        stale_explicit = response_path("stale-explicit"),
    );
    fs::write(&daemon, script).unwrap();
    let mut permissions = fs::metadata(&daemon).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&daemon, permissions).unwrap();
    let _restore = RestoreDaemon(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", &daemon);

    let state = JavaProjectContextState::default();
    let first = f.request();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let acquired = query_owned(f.binding.clone(), first, state.shared(), ticket).unwrap();
    assert_eq!(acquired["status"], "partial", "{acquired}");
    assert_eq!(acquired["context"]["snapshotHash"], fresh);

    let mut explicit = f.request();
    explicit.expected_snapshot_hash = Some(fresh.clone());
    explicit.expected_context_hash = Some("d".repeat(64));
    explicit.request_id = "explicit-stale-context".into();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let refused = query_owned(f.binding.clone(), explicit, state.shared(), ticket).unwrap();
    assert_eq!(refused["status"], "refused", "{refused}");
    assert_eq!(refused["code"], "java.context.snapshotStale", "{refused}");

    let requests: Vec<Value> = fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let context_requests: Vec<_> = requests
        .iter()
        .filter(|request| request["method"] == "project.context")
        .collect();
    assert_eq!(context_requests.len(), 3);
    assert_eq!(
        context_requests[0]["params"]["expectedSnapshotHash"],
        initial
    );
    assert_eq!(context_requests[1]["params"]["expectedSnapshotHash"], fresh);
    assert_eq!(context_requests[2]["params"]["expectedSnapshotHash"], fresh);
    assert!(context_requests[2]["params"]
        .get("expectedContextHash")
        .is_some());
    state.shutdown_all();

    fs::write(
        response_dir.join("open"),
        format!(
            "{}\n",
            json!({"jsonrpc":"2.0", "id":2, "error":{
                "code":-32006, "message":"Interrupted provider journal"
            }}),
        ),
    )
    .unwrap();
    let state = JavaProjectContextState::default();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let refused = query_owned(f.binding.clone(), f.request(), state.shared(), ticket).unwrap();
    assert_eq!(refused["status"], "refused", "{refused}");
    assert_eq!(refused["code"], "ide.java.context.savedSourceRecoveryUnavailable", "{refused}");
    assert!(refused["context"].is_null());
    assert!(state.0.active.lock().unwrap().is_none());
    let mut advertised = capabilities();
    advertised["methods"].as_array_mut().unwrap().push(json!({
        "name":"patch.recover", "requiresProject":false, "writesWorkspace":true
    }));
    for (name, response) in [
        ("capabilities", json!({"id":1, "jsonrpc":"2.0", "result":advertised})),
        ("recover", json!({"id":3, "jsonrpc":"2.0", "result":{"root":f.root, "recovered":true}})),
    ] {
        fs::write(response_dir.join(name), format!("{response}\n")).unwrap();
    }
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let refused = query_owned(f.binding.clone(), f.request(), state.shared(), ticket).unwrap();
    assert_eq!(refused["code"], SAVED_SOURCE_RECOVERY_REQUIRED, "{refused}");
    let recover = |request_id: &str| SavedSourceRecoveryRequest {
        workspace_id: f.binding.workspace_id.clone(),
        generation: 1,
        project_path: "".into(),
        request_id: request_id.into(),
    };
    let java_language = JavaLanguageServiceState::default();
    assert!(recover_saved_sources_at(recover("obsolete"), f.binding.clone(), &state.0, &java_language).is_err());
    let recovered = recover_saved_sources_at(recover("context-1"), f.binding.clone(), &state.0, &java_language).unwrap();
    assert_eq!(recovered["requestId"], "context-1");
    assert_eq!(recovered["recovered"], true);
    assert!(recover_saved_sources_at(recover("context-1"), f.binding.clone(), &state.0, &java_language).is_err());
    let requests = fs::read_to_string(f.root.join("snapshot-retry-requests.jsonl")).unwrap();
    let recovery_requests: Vec<Value> = requests.lines().map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|message| message["method"] == "patch.recover").collect();
    assert_eq!(recovery_requests.len(), 1);
    assert_eq!(recovery_requests[0]["params"]["root"], json!(f.root));
    state.shutdown_all();
}

#[test]
fn context_requires_readonly_versioned_snapshot_and_shared_analysis_capability() {
    let good = capabilities();
    assert!(advertised(&good));
    for field in [
        "typedSchemaV1",
        "snapshotBound",
        "configuredSdkEvidence",
        "orderedCompileRuntimeClasspaths",
        "sharedJdtBuildContext",
        "staleEvidenceRefusal",
    ] {
        let mut bad = good.clone();
        bad["methods"][0]["features"][field] = json!(false);
        assert!(!advertised(&bad));
    }
    let mut bad = good;
    bad["methods"][0]["writesWorkspace"] = json!(true);
    assert!(!advertised(&bad));
}

#[test]
fn context_accepts_the_advertised_v2_schema_and_still_requires_its_contract_features() {
    let mut v2 = capabilities();
    v2["methods"][0]["features"]["typedSchemaV1"] = json!(false);
    v2["methods"][0]["features"]["typedSchemaV2"] = json!(true);
    assert!(advertised(&v2));

    let mut unsupported_schema = v2.clone();
    unsupported_schema["methods"][0]["features"]["typedSchemaV2"] = json!(false);
    assert!(!advertised(&unsupported_schema));

    for field in [
        "snapshotBound",
        "configuredSdkEvidence",
        "orderedCompileRuntimeClasspaths",
        "sharedJdtBuildContext",
        "staleEvidenceRefusal",
    ] {
        let mut incomplete = v2.clone();
        incomplete["methods"][0]["features"][field] = json!(false);
        assert!(!advertised(&incomplete));
    }
}

#[test]
fn provider_qualified_selection_requires_the_v3_and_provider_association_capabilities() {
    let mut v3 = capabilities();
    v3["methods"][0]["features"]["typedSchemaV1"] = json!(false);
    v3["methods"][0]["features"]["typedSchemaV3"] = json!(true);
    v3["methods"][0]["features"]["providerQualifiedSourceAssociation"] = json!(true);
    assert!(advertised(&v3));
    assert!(provider_qualified_source_association_advertised(&v3));

    v3["methods"][0]["features"]["providerQualifiedSourceAssociation"] = json!(false);
    assert!(advertised(&v3));
    assert!(!provider_qualified_source_association_advertised(&v3));
}

#[test]
fn context_rejects_escaped_project_and_invalid_sdk_and_profile_authority() {
    let f = Fixture::new();
    assert!(validate(&f.request(), &f.binding).is_ok());
    for path in [
        "..",
        "../other",
        "/other",
        "module//child",
        "module/./child",
        "module\\child",
    ] {
        let mut request = f.request();
        request.project_path = path.into();
        assert!(validate(&request, &f.binding).is_err());
    }
    let mut request = f.request();
    request.sdk_home = f.root.to_string_lossy().into_owned();
    assert!(validate(&request, &f.binding).is_err());
    let mut request = f.request();
    request.module_id = Some("app".into());
    assert!(validate(&request, &f.binding).is_err());
    let mut request = f.request();
    request.active_maven_profiles = vec!["alternate".into()];
    request.inactive_maven_profiles = request.active_maven_profiles.clone();
    assert!(validate(&request, &f.binding).is_err());
    let mut request = f.request();
    request.expected_snapshot_hash = Some("stale".into());
    assert!(validate(&request, &f.binding).is_err());
}
#[test]
fn context_cannot_promote_partial_provider_or_accept_different_snapshot_sdk_or_execution_policy() {
    let f = Fixture::new();
    let request = f.request();
    let good = partial(&f);
    assert_eq!(
        normalize(good.clone(), &request, &"a".repeat(64), &f.sdk, "0.7.0").unwrap()["status"],
        "partial"
    );
    for bad in [
        {
            let mut v = good.clone();
            v["status"] = json!("available");
            v
        },
        {
            let mut v = good.clone();
            v["snapshotHash"] = json!("c".repeat(64));
            v
        },
        {
            let mut v = good.clone();
            v["sdk"][0]["home"] = json!(f.root);
            v
        },
        {
            let mut v = good.clone();
            v["providers"][0]["buildCodeExecution"] = json!("allowed");
            v
        },
        {
            let mut v = good.clone();
            v["providers"][0]["networkAccess"] = json!("anonymous-opt-in");
            v
        },
    ] {
        assert!(normalize(bad, &request, &"a".repeat(64), &f.sdk, "0.7.0").is_err());
    }
    let mut stale = request.clone();
    stale.expected_context_hash = Some("c".repeat(64));
    assert!(normalize(good, &stale, &"a".repeat(64), &f.sdk, "0.7.0").is_err());
    let refusal = json!({"schemaVersion":"java-project-context-v1", "status":"refused", "snapshotHash":"a".repeat(64), "refusal":{"code":"java.context.snapshotStale", "message":"Project inputs changed"}});
    let normalized = normalize(refusal, &request, &"a".repeat(64), &f.sdk, "0.7.0").unwrap();
    assert_eq!(normalized["status"], "refused");
    assert_eq!(normalized["workspaceId"], request.workspace_id);
}

#[test]
#[ignore = "Requires IDE_REAL_REFACTORKIT_DAEMON with project.context, real Maven/Gradle/JDK and cached dependencies; run with --test-threads=1"]
fn real_refactorkit_project_context_reads_maven_modules_sources_scopes_and_refuses_stale_evidence()
{
    use std::process::Command;
    let engine =
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set IDE_REAL_REFACTORKIT_DAEMON");
    struct Override(Option<std::ffi::OsString>);
    impl Drop for Override {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _override = Override(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK")
        .unwrap_or_else(|_| "/usr/lib/jvm/java-21-openjdk".into());
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let f = Fixture::new();
    let generated = Command::new("node").current_dir(&repository).args(["--import", "tsx", "--input-type=module", "-e",
        "import{javaEffectiveProjectReference}from'./tests/story/fixtures/java-effective-project-reference.ts';console.log(JSON.stringify(javaEffectiveProjectReference('maven')));"
    ]).output().unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let mut inputs: std::collections::BTreeMap<String, String> =
        serde_json::from_slice(&generated.stdout).unwrap();
    let external_classpath_source = "app/src/test/java/pkg/ExternalClasspathTarget.java";
    inputs.insert(
        external_classpath_source.into(),
        "package pkg;\nimport org.junit.Test;\nfinal class ExternalClasspathTarget {\n  static void dispatch(Test value) {}\n  static void dispatch(String value) {}\n  static void use(Test value) { dispatch(value); }\n  static void use(String value) { dispatch(value); }\n}\n".into(),
    );
    for (relative, contents) in &inputs {
        let path = f.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
    let build = Command::new("mvn")
        .current_dir(&f.root)
        .env("JAVA_HOME", &home)
        .args(["-B", "-o", "-Dstyle.color=never", "verify"])
        .output()
        .unwrap();
    assert!(
        build.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr)
    );
    let state = JavaProjectContextState::default();
    let run = |request: Request| {
        let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
        query_owned(f.binding.clone(), request, state.0.clone(), ticket).unwrap()
    };
    let mut request = f.request();
    request.sdk_home = home;
    request.maven_repository = PathBuf::from(std::env::var_os("HOME").unwrap())
        .join(".m2/repository")
        .to_string_lossy()
        .into_owned();
    let context = run(request.clone());
    assert_eq!(context["status"], "available", "{context}");
    let modules = context["context"]["modules"].as_array().unwrap();
    assert!(modules.len() >= 6, "{context}");
    let app = modules
        .iter()
        .find(|module| module["name"] == "app")
        .expect("app module");
    let main = app["sourceSets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|set| set["kind"] == "main")
        .unwrap();
    let test = app["sourceSets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|set| set["kind"] == "test")
        .unwrap();
    assert!(main["generatedSourceRoots"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p.as_str().unwrap().contains("generated-sources")));
    assert!(!main["compileClasspath"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["dependencyScope"] == "runtime" || p["dependencyScope"] == "test"));
    assert!(test["compileClasspath"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["path"].as_str().unwrap().contains("junit")));
    assert!(test["compileClasspath"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["path"].as_str().unwrap().contains("junit-4.13.2")),
        "the external overload fixture must be backed by the declared JUnit test dependency: {test}"
    );
    let snapshot = context["context"]["snapshotHash"]
        .as_str()
        .unwrap()
        .to_string();
    let identity = context["context"]["contextHash"]
        .as_str()
        .unwrap()
        .to_string();
    let navigation_state = super::super::java_navigation::JavaNavigationState::new(&state);
    let runner = inputs.get("app/src/main/java/pkg/Runner.java").unwrap();
    let (line, text) = runner
        .lines()
        .enumerate()
        .find(|(_, text)| text.contains("service.message(2)"))
        .unwrap();
    let column = text[..text.find("message(2)").unwrap()]
        .encode_utf16()
        .count();
    let mut navigation = json!({"workspaceId":request.workspace_id,"generation":request.generation,"requestId":"context-navigation", "kind":"definition",
        "document":{"path":"app/src/main/java/pkg/Runner.java","text":runner,"version":1},"position":{"line":line,"character":column}, "includeDeclaration":true,"limit":1,
        "projectContext":{"projectPath":"","sdkHome":request.sdk_home,"mavenRepository":request.maven_repository,"activeMavenProfiles":[],"inactiveMavenProfiles":[],
            "snapshotHash":snapshot,"contextHash":identity,"contextSchemaVersion":context["context"]["schemaVersion"],"platformIdentities":context["context"]["sdk"].as_array().unwrap().iter().map(|sdk|sdk["identitySha256"].clone()).collect::<Vec<_>>()}});
    let navigate = |value: &Value| {
        super::super::java_navigation::query_at(
            f.binding.clone(),
            serde_json::from_value(value.clone()).unwrap(),
            &navigation_state,
        )
        .unwrap()
    };
    let definition = navigate(&navigation);
    assert_eq!(definition["status"], "ready", "{definition}");
    assert_eq!(
        definition["locations"][0]["path"],
        "library/src/main/java/fixtures/library/BaseGreeting.java",
        "{definition}"
    );
    assert_eq!(definition["projectContext"]["contextHash"], identity);
    let (type_line, type_text) = runner
        .lines()
        .enumerate()
        .find(|(_, text)| text.contains("GreetingService service"))
        .unwrap();
    let mut hierarchy = navigation.clone();
    hierarchy["requestId"] = json!("context-type-hierarchy");
    hierarchy["kind"] = json!("typeHierarchy");
    hierarchy["direction"] = json!("supertypes");
    hierarchy["limit"] = json!(200);
    hierarchy["position"] = json!({
        "line": type_line,
        "character": type_text[..type_text.find("GreetingService").unwrap()]
            .encode_utf16()
            .count(),
    });
    let type_hierarchy = navigate(&hierarchy);
    assert_eq!(type_hierarchy["status"], "ready", "{type_hierarchy}");
    assert_eq!(type_hierarchy["rootName"], "GreetingService");
    assert_eq!(type_hierarchy["projectContext"]["contextHash"], identity);
    assert!(type_hierarchy["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["label"] == "BaseGreeting"));
    let hierarchy_wire = f.root.join("java-type-hierarchy-wire.json");
    fs::write(
        &hierarchy_wire,
        serde_json::to_vec(&json!({"request":hierarchy,"result":type_hierarchy})).unwrap(),
    )
    .unwrap();
    let normalized_hierarchy = Command::new("node")
        .current_dir(&repository)
        .args([
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            "import fs from'node:fs';import assert from'node:assert/strict';import{normalizeJavaNavigation}from'./packages/tauri-adapters/src/java-navigation-tauri.ts';const wire=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const result=normalizeJavaNavigation(wire.result,wire.request);assert.equal(result.status,'ready');assert.equal(result.rootName,'GreetingService');assert.ok(result.items.some(item=>item.label==='BaseGreeting'));console.log('JAVA_TYPE_HIERARCHY_CODEC_OK');",
        ])
        .arg(&hierarchy_wire)
        .output()
        .unwrap();
    let _ = fs::remove_file(&hierarchy_wire);
    assert!(
        normalized_hierarchy.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&normalized_hierarchy.stdout),
        String::from_utf8_lossy(&normalized_hierarchy.stderr)
    );
    let raw_capabilities = super::super::java_navigation::capabilities_at(&navigation_state);
    let managed = super::super::capability_policy::normalize_server_capabilities(&raw_capabilities)
        .expect("Actual daemon capability metadata must be accepted by the IDE");
    let managed = serde_json::to_value(
        super::super::capability_policy::available_managed_capabilities(managed),
    )
    .unwrap();
    assert_eq!(
        managed["javaContextRefactoring"]["editorPreviewSchemaVersion"],
        "java-editor-refactoring-v1"
    );
    let mut overlay = navigation.clone();
    let dirty_runner = runner.replace("service.message(2)", "service.message(\"editor\")");
    let service_path = "library/src/main/java/fixtures/library/GreetingService.java";
    let dirty_service = format!("// editor declaration\n{}", inputs[service_path]);
    overlay["requestId"] = json!("overlay-definition");
    overlay["document"]["text"] = json!(dirty_runner);
    overlay["document"]["version"] = json!(2);
    overlay["editorOverlay"] = json!({"documents":[
        {"path":"app/src/main/java/pkg/Runner.java","text":dirty_runner,"version":2},
        {"path":service_path,"text":dirty_service,"version":3}]});
    let dirty_definition = navigate(&overlay);
    assert_eq!(dirty_definition["status"], "ready", "{dirty_definition}");
    assert_eq!(dirty_definition["locations"][0]["path"], service_path);
    assert_eq!(dirty_definition["sourceFiles"][0]["text"], dirty_service);
    assert_eq!(
        dirty_definition["editorOverlay"]["baseSnapshotHash"],
        snapshot
    );
    assert_eq!(dirty_definition["projectContext"]["contextHash"], identity);
    let decoded_wire = f
        .root
        .parent()
        .unwrap()
        .join(format!("ide-java-overlay-wire-{}.json", std::process::id()));
    fs::write(
        &decoded_wire,
        serde_json::to_vec(&json!({"request":overlay,"result":dirty_definition})).unwrap(),
    )
    .unwrap();
    let decoded = Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
        "import fs from'node:fs';import assert from'node:assert/strict';import{normalizeJavaNavigation}from'./packages/tauri-adapters/src/java-navigation-tauri.ts';const wire=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const result=normalizeJavaNavigation(wire.result,wire.request);assert.equal(result.status,'ready');assert.equal(result.editorOverlay.documents.length,2);assert.equal(result.sourceFiles[0].text,wire.request.editorOverlay.documents[1].text);console.log('SDK_OVERLAY_CODEC_OK');"
    ]).arg(&decoded_wire).output().unwrap();
    let _ = fs::remove_file(&decoded_wire);
    assert!(
        decoded.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&decoded.stdout),
        String::from_utf8_lossy(&decoded.stderr)
    );
    let mut references = overlay.clone();
    references["requestId"] = json!("overlay-references");
    references["kind"] = json!("references");
    references["limit"] = json!(1000);
    let dirty_references = navigate(&references);
    assert_eq!(dirty_references["status"], "ready", "{dirty_references}");
    assert!(dirty_references["sourceFiles"]
        .as_array()
        .unwrap()
        .iter()
        .any(|file| file["path"] == "app/src/main/java/pkg/Runner.java"
            && file["text"] == dirty_runner));
    let mut draft_review = overlay.clone();
    draft_review["kind"] = json!("mutationSelection");
    draft_review["limit"] = json!(1);
    draft_review["editorOverlay"]["documents"] = json!(inputs
        .iter()
        .filter(|(path, _)| path.ends_with(".java"))
        .map(|(path, saved)| {
            let (text, version) = if path == "app/src/main/java/pkg/Runner.java" {
                (&dirty_runner, 2)
            } else if path == service_path {
                (&dirty_service, 3)
            } else {
                (saved, 1)
            };
            json!({"path":path,"text":text,"version":version})
        })
        .collect::<Vec<_>>());
    for (op, kind, new_name) in [
        ("rename-member", "member", Some("draftMessage")),
        ("rename-class", "class", Some("DraftRunner")),
        ("format-file", "file", None),
    ] {
        draft_review["requestId"] = json!(format!("draft-preview-{op}"));
        let path = "app/src/main/java/pkg/Runner.java";
        if op == "rename-class" {
            let (line, text) = dirty_runner
                .lines()
                .enumerate()
                .find(|(_, t)| t.contains("class Runner"))
                .unwrap();
            draft_review["position"] =
                json!({"line":line,"character":text.find("Runner").unwrap()});
        } else if op == "rename-member" {
            draft_review["position"] = overlay["position"].clone();
        } else {
            draft_review["position"] = json!({"line":0,"character":0});
        }
        draft_review["editorRefactoring"] = json!({"operation":op,"target":{"kind":kind,"path":path,"identity":if kind == "file" {path} else {"@cursor"}},"selectionGeneration":9});
        if let Some(name) = new_name {
            draft_review["editorRefactoring"]["changeIntent"] =
                json!({"operation":op,"newName":name});
        }
        let plan = navigate(&draft_review);
        assert_eq!(plan["status"], "ready", "{op}: {plan}");
        assert_eq!(plan["applyEligibility"]["eligible"], false, "{plan}");
        assert_eq!(plan["editorPreview"]["baseSnapshotHash"], snapshot);
        assert!(!plan["renderedDiff"].as_str().unwrap().is_empty());
        if kind != "file" {
            assert!(plan["editorPreview"]["selectionHash"].as_str().is_some());
        }
        let wire_request = json!({"operation":op,"target":draft_review["editorRefactoring"]["target"],"changeIntent":draft_review["editorRefactoring"]["changeIntent"],
            "projectContext":draft_review["projectContext"],"authority":{"workspaceId":draft_review["workspaceId"],"workspaceGeneration":draft_review["generation"]},
            "selectionGeneration":9,"requestId":draft_review["requestId"],"editorOverlay":{"documents":draft_review["editorOverlay"]["documents"],"position":draft_review["position"]}});
        fs::write(
            &decoded_wire,
            serde_json::to_vec(&json!({"request":wire_request,"result":plan})).unwrap(),
        )
        .unwrap();
        let decoded = Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
            "import fs from'node:fs';import assert from'node:assert/strict';import{normalizeRefactorPreview}from'./packages/tauri-adapters/src/refactorkit-tauri.ts';import{verifyJavaEditorPreview}from'./packages/tauri-adapters/src/java-editor-refactoring-tauri.ts';const wire=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const plan=normalizeRefactorPreview('native-draft-preview',wire.result);await verifyJavaEditorPreview(plan,wire.request);assert.equal(plan.applyEligibility.eligible,false);console.log('SDK_EDITOR_PREVIEW_CODEC_OK');"
        ]).arg(&decoded_wire).output().unwrap();
        let _ = fs::remove_file(&decoded_wire);
        assert!(
            decoded.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&decoded.stdout),
            String::from_utf8_lossy(&decoded.stderr)
        );
    }
    let external_source = inputs.get(external_classpath_source).unwrap();
    let (external_line, external_line_text) = external_source
        .lines()
        .enumerate()
        .find(|(_, line)| line.contains("use(Test value)"))
        .unwrap();
    let mut external_review = navigation.clone();
    external_review["requestId"] = json!("external-test-classpath-overload");
    external_review["kind"] = json!("mutationSelection");
    external_review["document"] =
        json!({"path":external_classpath_source,"text":external_source,"version":1});
    external_review["position"] = json!({
        "line": external_line,
        "character": external_line_text.find("dispatch(").unwrap() + 2
    });
    external_review["editorOverlay"] = json!({"documents":inputs.iter()
        .filter(|(path, _)| path.ends_with(".java"))
        .map(|(path, saved)| {
            let (text, version) = if path == "app/src/main/java/pkg/Runner.java" {
                (&dirty_runner, 2)
            } else if path == service_path {
                (&dirty_service, 3)
            } else {
                (saved, 1)
            };
            json!({"path":path,"text":text,"version":version})
        })
        .collect::<Vec<_>>()});
    external_review["editorRefactoring"] = json!({
        "operation":"rename-member",
        "target":{"kind":"member","path":external_classpath_source,"identity":"@cursor"},
        "changeIntent":{"operation":"rename-member","newName":"dispatchExternal"},
        "selectionGeneration":10
    });
    let external_preview = navigate(&external_review);
    assert_eq!(external_preview["status"], "ready", "{external_preview}");
    assert_eq!(external_preview["applyEligibility"]["eligible"], false);
    assert!(external_preview["editorPreview"]["selectionHash"]
        .as_str()
        .is_some());
    assert_eq!(
        external_preview["editorPreview"]["baseSnapshotHash"],
        snapshot
    );
    let external_diff = external_preview["renderedDiff"].as_str().unwrap();
    assert_eq!(
        external_diff.matches("dispatchExternal").count(),
        2,
        "only the declaration and call bound to JUnit Test should be renamed: {external_diff}"
    );
    assert!(!external_diff.contains("dispatchExternal(String value)"));
    let external_wire = f.root.join("external-classpath-refactor-wire.json");
    fs::write(
        &external_wire,
        serde_json::to_vec(&json!({"request":{
            "operation":"rename-member",
            "target":external_review["editorRefactoring"]["target"],
            "changeIntent":external_review["editorRefactoring"]["changeIntent"],
            "projectContext":external_review["projectContext"],
            "authority":{"workspaceId":external_review["workspaceId"],"workspaceGeneration":external_review["generation"]},
            "selectionGeneration":10,
            "requestId":external_review["requestId"],
            "editorOverlay":{"documents":external_review["editorOverlay"]["documents"],"position":external_review["position"]}
        },"result":external_preview})).unwrap(),
    )
    .unwrap();
    let decoded = Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
        "import fs from'node:fs';import assert from'node:assert/strict';import{normalizeRefactorPreview}from'./packages/tauri-adapters/src/refactorkit-tauri.ts';import{verifyJavaEditorPreview}from'./packages/tauri-adapters/src/java-editor-refactoring-tauri.ts';const wire=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const plan=normalizeRefactorPreview('external-classpath-preview',wire.result);await verifyJavaEditorPreview(plan,wire.request);assert.equal(plan.applyEligibility.eligible,false);assert.ok(plan.editorPreview.selectionHash);console.log('EXTERNAL_CLASSPATH_REFACTOR_CODEC_OK');"
    ]).arg(&external_wire).output().unwrap();
    let _ = fs::remove_file(&external_wire);
    assert!(
        decoded.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&decoded.stdout),
        String::from_utf8_lossy(&decoded.stderr)
    );
    qualify_editor_transaction(&f, &state, &navigation_state, &draft_review);
    for (relative, expected) in &inputs {
        assert_eq!(
            fs::read_to_string(f.root.join(relative)).unwrap(),
            *expected
        );
    }
    overlay["editorOverlay"]["documents"][1]["text"] =
        json!(format!("{dirty_service}\n// same version changed"));
    assert_eq!(navigate(&overlay)["status"], "refused");
    navigation["projectContext"]["activeMavenProfiles"] = json!(["alternate"]);
    let different_profiles = navigate(&navigation);
    assert_eq!(
        different_profiles["status"], "refused",
        "{different_profiles}"
    );
    navigation["projectContext"]["activeMavenProfiles"] = json!([]);
    if let Ok(other) = std::env::var("IDE_JAVA_CONTEXT_OTHER_TEST_JDK") {
        navigation["projectContext"]["sdkHome"] = json!(other);
        let other_sdk = navigate(&navigation);
        assert_eq!(other_sdk["status"], "refused", "{other_sdk}");
        navigation["projectContext"]["sdkHome"] = json!(request.sdk_home);
    }
    request.expected_snapshot_hash = Some(snapshot.clone());
    request.expected_context_hash = Some(identity);
    request.module_id = Some(app["id"].as_str().unwrap().into());
    request.source_set_id = Some(main["id"].as_str().unwrap().into());
    request.source_relative_path = Some("pkg/Runner.java".into());
    request.symbol = Some("pkg.Peer".into());
    let source = run(request.clone());
    assert_eq!(source["status"], "available", "{source}");
    assert_eq!(
        source["context"]["selectedSource"]["path"],
        "app/src/main/java/pkg/Runner.java"
    );
    assert_eq!(source["context"]["selectedSource"]["symbol"], "pkg.Peer");
    // Exercise the actual TypeScript decoder with the real native/provider envelope.
    let sample = f.root.parent().unwrap().join(format!(
        "{}-wire.json",
        f.root.file_name().unwrap().to_string_lossy()
    ));
    let saved_request = json!({"workspaceId":request.workspace_id,"generation":request.generation,"requestId":request.request_id,"projectPath":request.project_path,
        "sdkHome":request.sdk_home,"mavenRepository":request.maven_repository,"activeMavenProfiles":request.active_maven_profiles,"inactiveMavenProfiles":request.inactive_maven_profiles,
        "expectedSnapshotHash":request.expected_snapshot_hash,"expectedContextHash":request.expected_context_hash,"moduleId":request.module_id,"sourceSetId":request.source_set_id,
        "sourceRelativePath":request.source_relative_path,"symbol":request.symbol});
    fs::write(
        &sample,
        serde_json::to_vec(&json!({"request":saved_request,"response":source})).unwrap(),
    )
    .unwrap();
    let decoded=Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
        "import{readFileSync}from'node:fs';import{normalizeJavaProjectContext}from'./packages/tauri-adapters/src/java-project-context-tauri.ts';let d=JSON.parse(readFileSync(process.argv[1],'utf8'));let r=normalizeJavaProjectContext(d.response,d.request);if(r.status!=='available')throw Error('Context not available');", sample.to_str().unwrap()]).output().unwrap();
    let _ = fs::remove_file(&sample);
    assert!(
        decoded.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&decoded.stdout),
        String::from_utf8_lossy(&decoded.stderr)
    );
    request.source_set_id = Some(test["id"].as_str().unwrap().into());
    request.symbol = Some("pkg.Unrelated".into());
    let source = run(request.clone());
    assert_eq!(source["status"], "available", "{source}");
    assert_eq!(
        source["context"]["selectedSource"]["path"],
        "app/src/test/java/pkg/Runner.java"
    );
    let original = inputs.get("pom.xml").unwrap();
    fs::write(
        f.root.join("pom.xml"),
        original.replace(
            "<greeting.fixture.mode>base",
            "<greeting.fixture.mode>alternate",
        ),
    )
    .unwrap();
    let stale = run(request);
    assert_eq!(stale["status"], "refused", "{stale}");
    assert_eq!(stale["code"], "java.context.snapshotStale");
    let stale_navigation = navigate(&navigation);
    assert_eq!(stale_navigation["status"], "refused", "{stale_navigation}");
    fs::write(f.root.join("pom.xml"), original).unwrap();
    for (relative, expected) in inputs {
        assert_eq!(fs::read_to_string(f.root.join(relative)).unwrap(), expected);
    }
    state.shutdown_all();
    navigation_state.shutdown_all();
}

fn qualify_editor_transaction(
    f: &Fixture,
    state: &JavaProjectContextState,
    navigation_state: &super::super::java_navigation::JavaNavigationState,
    navigation: &Value,
) -> Value {
    let mut draft = navigation.clone();
    let path = draft["document"]["path"].as_str().unwrap().to_string();
    let mut documents = draft["editorOverlay"]["documents"].clone();
    let target = documents
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["path"] == path)
        .unwrap();
    target["text"] = json!(target["text"].as_str().unwrap().replacen(
        "package pkg;",
        "package pkg;\nimport java.util.List;",
        1
    ));
    target["version"] = json!(target["version"].as_u64().unwrap() + 1);
    draft["position"]["line"] = json!(draft["position"]["line"].as_u64().unwrap() + 1);
    for operation in [
        "format-file",
        "organize-imports",
        "rename-member",
        "rename-class",
    ] {
        draft["editorOverlay"]["documents"] = documents.clone();
        draft["document"] = documents
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["path"] == path)
            .unwrap()
            .clone();
        draft["requestId"] = json!(format!("durable-editor-{operation}"));
        let kind = match operation {
            "rename-class" => "class",
            "rename-member" => "member",
            _ => "file",
        };
        draft["editorRefactoring"] = json!({"operation":operation,"target":{"kind":kind,"path":path,"identity":if kind == "file" {&path} else {"@cursor"}},"selectionGeneration":9,"mutationMode":"durable-editor-owned"});
        if operation == "rename-class" {
            let (line, text) = draft["document"]["text"]
                .as_str()
                .unwrap()
                .lines()
                .enumerate()
                .find(|(_, line)| line.contains("class Runner"))
                .unwrap();
            draft["position"] = json!({"line":line,"character":text.find("Runner").unwrap()});
            draft["editorRefactoring"]["changeIntent"] =
                json!({"operation":operation,"newName":"DraftRunner"});
        } else if operation == "rename-member" {
            let (line, text) = draft["document"]["text"]
                .as_str()
                .unwrap()
                .lines()
                .enumerate()
                .find(|(_, line)| line.contains("message("))
                .unwrap();
            draft["position"] = json!({"line":line,"character":text.find("message(").unwrap()+2});
            draft["editorRefactoring"]["changeIntent"] =
                json!({"operation":operation,"newName":"draftMessage"});
        }
        documents = qualify_editor_operation(f, state, navigation_state, &draft);
    }
    documents
}

fn qualify_editor_operation(
    f: &Fixture,
    state: &JavaProjectContextState,
    navigation_state: &super::super::java_navigation::JavaNavigationState,
    navigation: &Value,
) -> Value {
    use std::process::Command;
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let wire_file = f.root.parent().unwrap().join(format!(
        "ide-editor-transaction-wire-{}.json",
        std::process::id()
    ));
    let decode = |request: &Value, result: &Value, kind: &str| {
        fs::write(
            &wire_file,
            serde_json::to_vec(&json!({"request":request,"result":result,"kind":kind})).unwrap(),
        )
        .unwrap();
        let output = Command::new("node")
            .current_dir(&repository)
            .args([
                "--import",
                "tsx",
                "tests/native/java-editor-transaction-wire.mjs",
            ])
            .arg(&wire_file)
            .output()
            .unwrap();
        let _ = fs::remove_file(&wire_file);
        assert!(
            output.status.success(),
            "Java editor consumer codec failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<Value>(&output.stdout).unwrap()
    };
    let call = |request: &Value| {
        super::super::java_editor_transaction::call_at(
            f.binding.clone(),
            serde_json::from_value(request.clone()).unwrap(),
            state,
        )
    };
    let mut draft = navigation.clone();
    let original_documents = draft["editorOverlay"]["documents"].clone();
    let saved: Vec<_> = original_documents
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["path"].as_str().unwrap().to_string(),
                fs::read(f.root.join(d["path"].as_str().unwrap())).unwrap(),
            )
        })
        .collect();
    draft["kind"] = json!("mutationSelection");
    let preview = super::super::java_navigation::query_at(
        f.binding.clone(),
        serde_json::from_value(draft.clone()).unwrap(),
        navigation_state,
    )
    .unwrap();
    assert_eq!(
        preview["status"], "ready",
        "{}: {preview}",
        draft["editorRefactoring"]["operation"]
    );
    let preview_request = json!({"operation":draft["editorRefactoring"]["operation"],"changeIntent":draft["editorRefactoring"]["changeIntent"],"target":draft["editorRefactoring"]["target"],"projectContext":draft["projectContext"],"authority":{"workspaceId":draft["workspaceId"],"workspaceGeneration":draft["generation"]},"selectionGeneration":9,"requestId":draft["requestId"],"editorMutationMode":"durable-editor-owned","editorOverlay":{"documents":original_documents,"position":draft["position"]}});
    decode(&preview_request, &preview, "preview");
    let mut request = json!({"workspaceId":draft["workspaceId"],"generation":draft["generation"],"projectContext":draft["projectContext"],"phase":"prepare","planId":preview["planId"],"approvedPlanHash":preview["editorPreview"]["planHash"],"documents":original_documents});
    let mut unreviewed = request.clone();
    unreviewed["planId"] = json!("unreviewed");
    assert!(
        call(&unreviewed).is_err(),
        "Unreviewed plans cannot prepare edits."
    );
    let prepared = call(&request).unwrap();
    let prepared = decode(&request, &prepared, "transaction");
    assert_eq!(prepared["transaction"]["status"], "prepared");
    request["transactionId"] = prepared["transaction"]["transactionId"].clone();
    let original_request = request.clone();
    request["phase"] = json!("apply-files");
    let mut stale_capture = request.clone();
    stale_capture["documents"][0]["text"] = json!("changed before file application");
    assert!(
        call(&stale_capture).is_err(),
        "Changed captures must not move saved files."
    );
    if draft["editorRefactoring"]["operation"] == "rename-class" {
        let (first_path, first_bytes) = &saved[0];
        fs::write(f.root.join(first_path), b"independently changed source").unwrap();
        assert!(
            call(&request).is_err(),
            "Saved source drift must not move files."
        );
        fs::write(f.root.join(first_path), first_bytes).unwrap();
    }
    let files = call(&request).unwrap();
    decode(&request, &files, "transaction");
    assert!(
        call(&request).is_err(),
        "A prepared file proposal cannot execute twice."
    );
    request["documents"] = prepared["staged"]["documents"].clone();
    request["phase"] = json!("confirm");
    let confirmed = call(&request).unwrap();
    let confirmed = decode(&request, &confirmed, "transaction");
    assert_eq!(confirmed["transaction"]["status"], "applied");
    for (path, bytes) in &saved {
        let moved = files["diskSources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["oldPath"] == *path);
        let current = moved.map(|d| d["path"].as_str().unwrap()).unwrap_or(path);
        assert_eq!(
            fs::read(f.root.join(current)).unwrap(),
            *bytes,
            "Apply must not save the draft."
        );
        if moved.is_some() {
            assert!(!f.root.join(path).exists());
        }
    }
    let mut changed = request.clone();
    changed["phase"] = json!("undo.prepare");
    changed["documents"][0]["version"] = json!(999);
    assert!(
        call(&changed).is_err(),
        "Undo must reject changed versions."
    );
    if draft["editorRefactoring"]["operation"] == "rename-class"
        && draft["projectContext"]["gradle"].is_null()
    {
        // Simulate a provider process restart while keeping the IDE service alive.
        // shutdown_all is terminal and must not be used before a fresh synchronization.
        if let Ok(mut active) = state.0.active.lock() {
            super::reset(&mut active);
        }
        let mut synchronized = f.request();
        synchronized.sdk_home = draft["projectContext"]["sdkHome"].as_str().unwrap().into();
        synchronized.maven_repository = draft["projectContext"]["mavenRepository"]
            .as_str()
            .unwrap()
            .into();
        synchronized.active_maven_profiles =
            serde_json::from_value(draft["projectContext"]["activeMavenProfiles"].clone()).unwrap();
        synchronized.inactive_maven_profiles =
            serde_json::from_value(draft["projectContext"]["inactiveMavenProfiles"].clone())
                .unwrap();
        let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let reopened =
            query_owned(f.binding.clone(), synchronized, state.0.clone(), ticket).unwrap();
        assert_eq!(reopened["status"], "available", "{reopened}");
        let mut discover = request.clone();
        discover["phase"] = json!("transactions");
        discover["documents"] = json!([]);
        let found = call(&discover).unwrap();
        let found = decode(&discover, &found, "transaction");
        let discovered = found["transactions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["transactionId"] == request["transactionId"])
            .unwrap();
        let lineage = discovered["documents"].as_array().unwrap();
        assert_eq!(
            lineage.len(),
            saved.len(),
            "Discovery must include clean captured companions."
        );
        for (path, bytes) in &saved {
            use sha2::{Digest, Sha256};
            let document = lineage.iter().find(|d| d["originalPath"] == *path).unwrap();
            assert_eq!(
                document["originalSavedContentSha256"],
                format!("{:x}", Sha256::digest(bytes))
            );
            let expected = prepared["transaction"]["workspaceEdit"]["documentChanges"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["kind"] == "rename" && c["oldPath"] == *path)
                .map(|c| c["path"].clone())
                .unwrap_or_else(|| json!(path));
            assert_eq!(document["finalPath"], expected);
        }
        assert!(found["transactions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["transactionId"] == request["transactionId"]
                && t["status"] == "applied"
                && t["contextHash"] == draft["projectContext"]["contextHash"]));
        let mut unknown = request.clone();
        unknown["phase"] = json!("recover");
        unknown["documents"][0]["text"] = json!("independent unknown editor content");
        let refused = call(&unknown).unwrap();
        let refused = decode(&unknown, &refused, "transaction");
        assert_eq!(refused["transaction"]["status"], "recovery-required");
        assert!(refused["transaction"].get("workspaceEdit").is_none());
        request["phase"] = json!("recover");
    } else {
        request["phase"] = json!("undo.prepare");
    }
    let inverse = call(&request).unwrap();
    let inverse = decode(&request, &inverse, "transaction");
    assert_eq!(inverse["transaction"]["status"], "undo-prepared");
    request["phase"] = json!("apply-files");
    let files = call(&request).unwrap();
    decode(&request, &files, "transaction");
    request["documents"] = inverse["staged"]["documents"].clone();
    request["phase"] = json!("undo.confirm");
    let undone = call(&request).unwrap();
    let undone = decode(&request, &undone, "transaction");
    assert_eq!(undone["transaction"]["status"], "undone");
    for original in original_request["documents"].as_array().unwrap() {
        let restored = request["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["path"] == original["path"])
            .unwrap();
        assert_eq!(restored["text"], original["text"]);
    }
    for (path, bytes) in &saved {
        assert_eq!(
            fs::read(f.root.join(path)).unwrap(),
            *bytes,
            "Undo restores the original draft, not saved source text."
        );
    }
    request["phase"] = json!("transactions");
    request["documents"] = json!([]);
    let discovered = call(&request).unwrap();
    let discovered = decode(&request, &discovered, "transaction");
    assert!(discovered["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["transactionId"] == request["transactionId"] && t["status"] == "undone"));
    request["documents"] = inverse["staged"]["documents"].clone();
    request["documents"].clone()
}

#[test]
#[ignore = "requires RefactorKit test JVM selection, Maven cache, JDK 21 and Java 8"]
fn real_maven_execution_qualifies_surefire_and_failsafe_jvms_before_launch() {
    use super::super::{JavaExecutionProjectSelection, daemon_env_test_lock};
    use crate::commands::java_execution::{JavaExecutionState, Request as ExecutionRequest, SessionRequest};
    let _environment_lock = daemon_env_test_lock();
    let engine = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").unwrap();
    let home = Path::new(&std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").unwrap()).canonicalize().unwrap();
    let legacy = Path::new(&std::env::var("IDE_TEST_JAVA8_HOME").unwrap()).canonicalize().unwrap();
    let repository = std::env::var("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY").unwrap();
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let java_element = |jdk: &Path| format!("<jvm>{}</jvm>", jdk.join("bin/java").display());
    let toolchain = "<jdkToolchain><version>1.8</version></jdkToolchain>";
    let mut cases = vec![
        (format!("{}{toolchain}", java_element(&home)), true, false, false, "integration-test", None),
        (format!("{}{toolchain}", java_element(&home)), false, false, false, "integration-test", None),
        (java_element(&legacy), true, true, false, "integration-test", None),
        (String::new(), true, true, true, "integration-test", None),
        (java_element(&legacy), true, true, false, "integration-coverage", None),
        (java_element(&home), true, false, false, "integration-coverage", None),
        (java_element(&legacy), true, true, false, "debug-integration-test", None),
        (toolchain.to_string(), true, true, false, "integration-test", None),
        (toolchain.to_string(), true, true, false, "debug-integration-test", None),
        ("<jdkToolchain><version>21</version></jdkToolchain>".into(), true, false, true, "integration-coverage", None),
        (toolchain.to_string(), false, true, false, "integration-test", None),
    ];
    if std::env::var_os("IDE_TEST_MAVEN_BUILD_TOOLCHAIN").is_some() {
        cases.extend([
            (String::new(), true, true, false, "debug-integration-test", Some("validate")),
            (String::new(), true, false, false, "integration-test", Some("install")),
        ]);
    }
    for (failsafe, matching_toolchain, legacy_fork, inherited, operation, toolchain_phase) in cases {

        let fixture = Fixture::new();
        let build_jdk = if inherited { &legacy } else { &home };
        let surefire = if inherited || toolchain_phase.is_some() { String::new() } else { java_element(&home) };
        let build_toolchain = toolchain_phase.map(|phase| format!(
            "<plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-toolchains-plugin</artifactId><version>3.3.0</version><executions><execution><id>select-build-jdk</id><phase>{phase}</phase><goals><goal>toolchain</goal></goals></execution></executions><configuration><toolchains><jdk><version>1.8</version></jdk></toolchains></configuration></plugin>"
        )).unwrap_or_default();
        let preserves_argline = legacy_fork || operation == "integration-coverage";
        let fork_argline = if legacy_fork {
            "<argLine>-Dfork.fromPom=preserved -Xmx128m</argLine>"
        } else if preserves_argline {
            "<argLine>@{fixture.fork.options} -Xmx128m</argLine>"
        } else {
            ""
        };
        let literal = "first\nsecond\t'quote\"\\café";
        let descriptor = format!(r#"<project><modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>jvm-selection</artifactId><version>1</version>
          <properties><maven.compiler.release>8</maven.compiler.release><fixture.fork.options>-Dfork.fromPom=preserved</fixture.fork.options></properties>
          <dependencies><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies>
          <build><plugins>
            {build_toolchain}
            <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin>
            <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version><configuration>{surefire}</configuration></plugin>
            <plugin><groupId>org.codehaus.mojo</groupId><artifactId>build-helper-maven-plugin</artifactId><version>3.6.1</version><executions>
              <execution><id>integration-sources</id><phase>generate-test-sources</phase><goals><goal>add-test-source</goal></goals><configuration><sources><source>src/integration-test/java</source></sources></configuration></execution>
            </executions></plugin>
            <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><configuration>{failsafe}{fork_argline}</configuration><executions>
              <execution><id>integration-tests</id><phase>integration-test</phase><goals><goal>integration-test</goal><goal>verify</goal></goals><configuration><includes><include>**/*IT.java</include></includes><reportsDirectory>target/failsafe-reports</reportsDirectory></configuration></execution>
            </executions></plugin>
          </plugins></build></project>"#);
        fs::write(fixture.root.join("pom.xml"), &descriptor).unwrap();
        let main = fixture.root.join("src/main/java/fixture");
        fs::create_dir_all(&main).unwrap();
        fs::write(main.join("Choice.java"),
            "package fixture; public class Choice { public static int pick(boolean yes) { return yes ? 42 : 0; } }",
        ).unwrap();
        let toolchains = fixture.root.join("toolchains.xml");
        let toolchain_file = if matching_toolchain {
            format!(r#"<toolchains>
                <toolchain><type>jdk</type><provides><version>1.8</version></provides><configuration><jdkHome>{}</jdkHome></configuration></toolchain>
                <toolchain><type>jdk</type><provides><version>21</version></provides><configuration><jdkHome>{}</jdkHome></configuration></toolchain>
            </toolchains>"#, legacy.display(), home.display())
        } else {
            "<toolchains/>".into()
        };
        fs::write(&toolchains, toolchain_file).unwrap();
        fs::create_dir(fixture.root.join(".mvn")).unwrap();
        fs::write(fixture.root.join(".mvn/maven.config"), format!(
            "--toolchains\n{}\n--global-toolchains\n{}\n", toolchains.display(), toolchains.display(),
        )).unwrap();
        for (kind, class) in [("test", "ExecutionTest"), ("integration-test", "ExecutionIT")] {
            let folder = fixture.root.join("src").join(kind).join("java");
            fs::create_dir_all(&folder).unwrap();
            let check_runtime = if kind == "integration-test" || toolchain_phase.is_some() {
                let version = if legacy_fork { "1.8" } else { "21" };
                format!(r#"org.junit.Assert.assertEquals("{version}", System.getProperty("java.specification.version"));"#)
            } else { String::new() };
            let check_pom = if preserves_argline && kind == "integration-test" {
                r#"org.junit.Assert.assertEquals("preserved", System.getProperty("fork.fromPom"));
                   org.junit.Assert.assertTrue(Runtime.getRuntime().maxMemory() < 128L * 1024 * 1024);"#
            } else { "" };
            let check_legacy = if legacy_fork && kind == "integration-test" {
                format!(r#"org.junit.Assert.assertEquals({:?}, System.getenv("JAVA_HOME"));"#,
                   legacy.to_str().unwrap())
            } else { String::new() };
            fs::write(folder.join(format!("{class}.java")), format!(
                r#"public class {class} {{ @org.junit.Test public void executes() {{
                    org.junit.Assert.assertEquals("requested", System.getProperty("fork.probe"));
                    org.junit.Assert.assertEquals({literal:?}, System.getProperty("fork.literal"));
                    org.junit.Assert.assertEquals(42, fixture.Choice.pick(true));
                    {check_runtime}
                    {check_pom}
                    {check_legacy}
                }} }}"#
            )).unwrap();
        }
        let state = JavaProjectContextState::default();
        let mut request = fixture.request();
        request.sdk_home = build_jdk.to_string_lossy().into_owned();
        request.maven_repository = repository.clone();
        let query = |request: Request| {
            let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
            let response = query_owned(fixture.binding.clone(), request, state.0.clone(), ticket).unwrap();
            assert_eq!(response["status"], "available", "{response}");
            response
        };
        let initial = query(request.clone());
        request.provider_id = Some("maven-effective-v1".into());
        request.module_id = initial["context"]["modules"][0]["id"].as_str().map(str::to_owned);
        request.source_set_kind = Some("integration-test".into());
        let context = query(request)["context"].clone();
        assert_eq!(context["schemaVersion"], "java-project-context-v7");
        let module = &context["modules"][0];
        let integration = module["sourceSets"].as_array().unwrap().iter()
            .find(|source_set| source_set["kind"] == "integration-test").unwrap();
        let selection: JavaExecutionProjectSelection = serde_json::from_value(json!({
            "context":{"projectPath":"","sdkHome":build_jdk,"mavenRepository":repository,
                "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],
                "contextSchemaVersion":context["schemaVersion"],"contextHash":context["contextHash"],
                "platformIdentities":context["sdk"].as_array().unwrap().iter().map(|sdk|&sdk["identitySha256"]).collect::<Vec<_>>()},
            "providerId":module["providerId"],"moduleId":module["id"],"sourceSetId":integration["id"]
        })).unwrap();
        let debug = operation == "debug-integration-test";
        let source_path = "src/integration-test/java/ExecutionIT.java";
        let source = fs::read_to_string(fixture.root.join(source_path)).unwrap();
        let line = source.lines().position(|line| line.contains("fixture.Choice.pick")).unwrap() + 1;
        let breakpoint = json!({
            "sourcePath":source_path,"line":line,
            "fingerprint":format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(source.as_bytes())),
        });
        let executor = JavaExecutionState::new(&state);
        let launch: ExecutionRequest = serde_json::from_value(json!({
            "workspaceId":fixture.binding.workspace_id,"generation":1,"operation":operation,"trusted":true,
            "configuration":{"buildTool":"auto","mainClass":"","classPath":[],
                "debuggerMode":"jdi","testFilter":if debug { "ExecutionIT#executes" } else { "" },
                "testJvmOptions":["-Dfork.probe=requested", format!("-Dfork.literal={literal}"), "-Xmx96m"]},
            "sourceBreakpoints":if debug { json!([breakpoint]) } else { json!([]) },
        })).unwrap();
        let started = serde_json::to_value(executor.start_project(fixture.binding.clone(), launch, selection).unwrap()).unwrap();
        let session: SessionRequest = serde_json::from_value(json!({
            "workspaceId":fixture.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]
        })).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        let mut hit_breakpoint = false;
        let done = loop {
            let snapshot = serde_json::to_value(executor.snapshot_at(&fixture.binding, &session).unwrap()).unwrap();
            let debugger = &snapshot["debuggerState"];
            if debug && debugger["status"] == "suspended" {
                let selected_test_stopped = debugger["frames"].as_array().is_some_and(|frames|
                    frames.iter().any(|frame| frame["className"] == "ExecutionIT" && frame["line"] == line));
                if selected_test_stopped {
                    assert!(debugger["breakpoints"].as_array().is_some_and(|points|
                        points.iter().any(|point| point["verified"] == true && point["line"] == line)), "{snapshot}");
                    hit_breakpoint = true;
                }
                if debugger["reason"] == "entry" || selected_test_stopped {
                    let command = serde_json::from_value(json!({
                        "workspaceId":fixture.binding.workspace_id,"generation":1,"sessionId":session.session_id,
                        "action":{"type":"continue","stopId":debugger["stopId"]},
                    })).unwrap();
                    executor.debug_action_at(&fixture.binding, &command).unwrap();
                }
            }
            if matches!(snapshot["state"].as_str(), Some("succeeded" | "failed")) { break snapshot; }
            assert!(std::time::Instant::now() < deadline, "{snapshot}");
            std::thread::sleep(Duration::from_millis(30));
        };
        if matching_toolchain {
            assert_eq!(done["state"], "succeeded", "{done}");
            assert_eq!(done["testResults"]["summary"]["passed"], 1);
            if debug {
                assert!(hit_breakpoint, "The Java 8 Failsafe test missed the saved breakpoint: {done}");
            }
            assert!(fixture.root.join("target/surefire-reports/TEST-ExecutionTest.xml").is_file());
            if operation == "integration-coverage" {
                assert_eq!(done["coverage"]["status"], "ready", "{done}");
                assert!(done["coverage"]["counters"]["instructions"]["covered"].as_u64().unwrap() > 0, "{done}");
            }
        } else {
            assert_eq!(done["state"], "failed", "{done}");
            assert_ne!(done["exitCode"], 0);
            assert!(fixture.root.join("target/surefire-reports/TEST-ExecutionTest.xml").is_file());
            assert!(!fixture.root.join("target/failsafe-reports/TEST-ExecutionIT.xml").exists());
            assert!(done["output"].as_str().unwrap().contains(
                "Requested toolchain specification did not match any configured toolchain"
            ), "{done}");
            assert_eq!(
                done["testJvmOptionsError"],
                concat!(
                    "Maven could not find a matching JDK toolchain for the test fork. ",
                    "Configure a matching toolchain in Maven and run again."
                ),
                "{done}"
            );
        }
        assert_eq!(fs::read_to_string(fixture.root.join("pom.xml")).unwrap(), descriptor);
        executor.shutdown_all();
    }
}

#[test]
#[ignore = "requires real RefactorKit daemon, Maven cache and selected full JDK"]
fn real_project_context_execution_runs_module_with_provider_runtime_classpath() {
    use super::super::{JavaExecutionProjectContext, JavaExecutionProjectSelection};
    use crate::commands::java_execution::{
        JavaExecutionState, Request as ExecutionRequest, SessionRequest,
    };
    use std::process::Command;
    let engine =
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set IDE_REAL_REFACTORKIT_DAEMON");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(v) => std::env::set_var("IDE_REFACTORKIT_DAEMON", v),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK")
        .unwrap_or_else(|_| "/usr/lib/jvm/java-21-openjdk".into());
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let tool = std::env::var("IDE_JAVA_CONTEXT_EXECUTION_TOOL").unwrap_or_else(|_| "maven".into());
    let operation =
        std::env::var("IDE_JAVA_CONTEXT_EXECUTION_OPERATION").unwrap_or_else(|_| "run".into());
    let debugger_mode =
        std::env::var("IDE_JAVA_CONTEXT_EXECUTION_DEBUGGER").unwrap_or_else(|_| "jdi".into());
    assert!(["jdi", "jdb"].contains(&debugger_mode.as_str()));
    let debugging_test = operation == "debug-test";
    let debugging = operation == "debug" || debugging_test;
    assert!(!debugging_test || debugger_mode == "jdi");
    let console_debug = operation == "debug" && debugger_mode == "jdb";
    assert!(
        ["build", "run", "test", "debug", "debug-test", "discover", "coverage", "rerun"]
            .contains(&operation.as_str())
    );
    assert!(["maven", "gradle"].contains(&tool.as_str()));
    let custom_source_set = std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_SOURCE_SET").is_some();
    let custom_gradle_test_task =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_CUSTOM_TEST_TASK").is_some();
    let custom_gradle_discovery =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_CUSTOM_DISCOVERY").is_some();
    let custom_gradle_coverage =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_CUSTOM_COVERAGE").is_some();
    let custom_gradle_source_set_task =
        custom_gradle_test_task || custom_gradle_discovery || custom_gradle_coverage;
    let custom_gradle_test_ambiguous =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_CUSTOM_TEST_TASK_AMBIGUOUS").is_some();
    let custom_gradle_test_classpath_mismatch =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_CUSTOM_TEST_TASK_CLASSPATH_MISMATCH")
            .is_some();
    assert!(!(custom_gradle_test_ambiguous && custom_gradle_test_classpath_mismatch));
    assert!(
        !custom_source_set
            || (tool == "gradle" && ["build", "run", "debug"].contains(&operation.as_str())),
        "Custom source-set execution is qualified only for Gradle Build, Run and Debug."
    );
    assert!(
        !custom_gradle_test_task
            || (!custom_source_set && tool == "gradle" && operation == "test"),
        "Custom Gradle Test-task execution is qualified separately from smoke Build, Run and Debug."
    );
    assert!(
        !custom_gradle_discovery
            || (!custom_source_set
                && !custom_gradle_test_task
                && tool == "gradle"
                && operation == "discover"),
        "Custom Gradle discovery is qualified separately from smoke Build, Run, Debug and Test."
    );
    assert!(
        !custom_gradle_coverage
            || (!custom_source_set
                && !custom_gradle_test_task
                && !custom_gradle_discovery
                && tool == "gradle"
                && operation == "coverage"),
        "Custom Gradle coverage is qualified separately from smoke Build, Run, Debug, Test and discovery."
    );
    let missing_test = std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_MISSING_TEST").is_some();
    let separate_working_directory =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_WORKING_DIRECTORY").is_some();
    let application_input =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_APPLICATION_INPUT").is_some();
    let compiler_failure =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_COMPILER_FAILURE").is_some();
    assert!(!compiler_failure || (!custom_source_set && !custom_gradle_source_set_task &&
        !application_input && !separate_working_directory && !missing_test &&
        ["build", "run"].contains(&operation.as_str())),
        "Compiler-failure qualification uses ordinary project Build and Run.");
    assert!(!application_input || (!custom_source_set && !custom_gradle_source_set_task &&
        ["run", "debug"].contains(&operation.as_str())),
        "Application input qualification uses the standard application source set.");
    assert!(!separate_working_directory ||
        (!custom_source_set && !custom_gradle_source_set_task && !missing_test &&
         ["run", "debug", "test"].contains(&operation.as_str())),
        "Separate-directory qualification uses the standard application/test source sets.");
    let f = Fixture::new();
    let release = std::env::var("IDE_JAVA_REFERENCE_RELEASE").unwrap_or_else(|_| "17".into());
    // Run method selection invokes Surefire. Its test JVM option transport
    // still requires argument-file support. Discovery tests the literal
    // options separately through the Java 8 and 11 production launch paths.
    let legacy_maven_discovery = tool == "maven" && operation == "discover" && release == "8";
    let gradle_runtime = (tool == "gradle")
        .then(|| std::env::var("IDE_JAVA_REFERENCE_GRADLE_RUNTIME_JDK").ok())
        .flatten();
    let generated=Command::new("node").current_dir(&repository).args(["--import","tsx","--input-type=module","-e",
        "import{javaEffectiveProjectReference}from'./tests/story/fixtures/java-effective-project-reference.ts';const [tool,release,toolchain]=process.argv.slice(1);console.log(JSON.stringify(javaEffectiveProjectReference(tool,false,false,Number(release),toolchain==='true')));",
        &tool, &release, if gradle_runtime.is_some() { "true" } else { "false" }]).output().unwrap();
    assert!(generated.status.success());
    let mut inputs: std::collections::BTreeMap<String, String> =
        serde_json::from_slice(&generated.stdout).unwrap();
    let test_source = "app/src/test/java/pkg/RunnerTest.java";
    let test_method = "dependenciesOverloadsAndGeneratedSource";
    let test_jdk_proof = "debug-test-jdk.txt";
    if debugging_test {
        let source = inputs.get_mut(test_source).unwrap();
        let signature = format!("{test_method}() throws Exception {{");
        assert!(source.contains(&signature));
        *source = source.replace(&signature, &format!(
            "{signature}\n    java.nio.file.Files.write(java.nio.file.Paths.get(\"{test_jdk_proof}\"), System.getProperty(\"java.home\").getBytes(java.nio.charset.StandardCharsets.UTF_8));"
        ));
    }
    if gradle_runtime.is_some() {
        inputs.get_mut("gradle.properties").unwrap().push_str(&format!(
            "org.gradle.java.installations.paths={home}\norg.gradle.java.installations.auto-detect=false\norg.gradle.java.installations.auto-download=false\n"
        ));
    }
    if custom_source_set {
        inputs
            .get_mut("app/build.gradle")
            .expect("Gradle application build file")
            .push_str("\nsourceSets { smoke }\n");
        inputs.insert(
            "app/src/smoke/java/pkg/SmokeRunner.java".into(),
            "package pkg;\npublic final class SmokeRunner {\n  public static void main(String[] args) {\n    System.out.println(\"PROJECT_LAUNCH_JDK:\" + System.getProperty(\"java.home\"));\n    System.out.println(\"CUSTOM_SOURCE_SET_OK:\" + System.getProperty(\"launch.literal\") + \"|\" + java.util.Arrays.toString(args) + \"|\" + System.getenv(\"LAUNCH_PROOF\"));\n  }\n}\n".into(),
        );
    }
    if custom_gradle_source_set_task {
        let task_classpath = if custom_gradle_test_classpath_mismatch {
            "sourceSets.integrationTest.output"
        } else {
            "sourceSets.integrationTest.runtimeClasspath"
        };
        inputs
            .get_mut("app/build.gradle")
            .expect("Gradle application build file")
            .push_str(&format!("\nsourceSets {{ integrationTest }}\ndependencies {{ integrationTestImplementation 'junit:junit:4.13.2' }}\ntasks.register('integrationTest', Test) {{ testClassesDirs = sourceSets.integrationTest.output.classesDirs; classpath = {task_classpath} }}\n{}", if custom_gradle_test_ambiguous { "tasks.register('integrationTestDuplicate', Test) { testClassesDirs = sourceSets.integrationTest.output.classesDirs; classpath = sourceSets.integrationTest.runtimeClasspath }" } else { "" }));
        inputs.insert(
            "app/src/integrationTest/java/pkg/SmokeTest.java".into(),
            "package pkg;\nimport java.nio.file.Files;\nimport java.nio.file.Path;\nimport org.junit.Test;\nimport static org.junit.Assert.*;\npublic class SmokeTest {\n  @Test public void selected() throws Exception {\n    assertEquals(\"value with spaces\", System.getProperty(\"test.literal\"));\n    assertEquals(\"environment value\", System.getenv(\"LAUNCH_PROOF\"));\n    Files.writeString(Path.of(\"proof-custom-selected.txt\"), System.getProperty(\"java.home\") + \"|\" + System.getProperty(\"test.literal\") + \"|\" + System.getenv(\"LAUNCH_PROOF\"));\n  }\n  @Test public void companion() throws Exception { Files.writeString(Path.of(\"proof-custom-companion.txt\"), \"ran\"); }\n}\n".into(),
        );
    }
    let custom_outputs = std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_CUSTOM_OUTPUTS").is_some();
    let alternate_profile =
        std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_ALTERNATE_PROFILE").is_some();
    assert!(!alternate_profile || tool == "maven");
    if custom_outputs {
        assert_eq!(tool, "maven");
        let parent = inputs.get_mut("pom.xml").unwrap();
        assert!(parent.contains("<build>"));
        *parent=parent.replacen("<build>","<build><outputDirectory>${project.basedir}/products/main</outputDirectory><testOutputDirectory>${project.basedir}/products/test</testOutputDirectory>",1);
    }
    let source = inputs.get_mut("app/src/main/java/pkg/Runner.java").unwrap();
    *source=source.replace("public static void main(String[] args) throws Exception {",
        "public static void main(String[] args) throws Exception {\n    System.out.println(\"PROJECT_LAUNCH_JDK:\" + System.getProperty(\"java.home\"));\n    System.out.println(\"PROJECT_LAUNCH_LITERAL:\" + System.getProperty(\"launch.literal\") + \"|\" + java.util.Arrays.toString(args) + \"|\" + System.getenv(\"LAUNCH_PROOF\"));");
    if application_input {
        *source = source.replace("public static void main(String[] args) throws Exception {", r#"public static void main(String[] args) throws Exception {
    System.out.println("PROJECT_INPUT_READY");
    java.io.ByteArrayOutputStream input = new java.io.ByteArrayOutputStream();
    byte[] buffer = new byte[4096];
    int count;
    while ((count = System.in.read(buffer)) != -1) input.write(buffer, 0, count);
    System.out.println("PROJECT_INPUT_BYTES:" + java.util.Base64.getEncoder().encodeToString(input.toByteArray()));
"#);
    }
    if separate_working_directory {
        let source = inputs.get_mut("app/src/main/java/pkg/Runner.java").unwrap();
        *source = source.replace("public static void main(String[] args) throws Exception {", r#"public static void main(String[] args) throws Exception {
    if (!java.nio.file.Files.readString(java.nio.file.Path.of("settings.txt")).equals("PROJECT_CONTEXT_CWD")) throw new AssertionError("wrong relative resource");
    java.nio.file.Files.writeString(java.nio.file.Path.of("project-application-cwd.txt"), java.nio.file.Path.of("").toRealPath()+"\n"+java.nio.file.Path.of(System.getProperty("user.dir")).toRealPath()+"\n"+java.nio.file.Files.readSymbolicLink(java.nio.file.Path.of("/proc/self/cwd")));
"#);
        let test = inputs.get_mut("app/src/test/java/pkg/RunnerTest.java").unwrap();
        *test = test.replace("dependenciesOverloadsAndGeneratedSource() throws Exception {", r#"dependenciesOverloadsAndGeneratedSource() throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("project-test-cwd.txt"), java.nio.file.Path.of("").toRealPath()+"\n"+java.nio.file.Path.of(System.getProperty("user.dir")).toRealPath()+"\n"+java.nio.file.Files.readSymbolicLink(java.nio.file.Path.of("/proc/self/cwd")));
"#);
    }
    if ["discover", "coverage", "rerun"].contains(&operation.as_str()) {
        let test = inputs
            .get_mut("app/src/test/java/pkg/RunnerTest.java")
            .unwrap();
        for method in [
            "dependenciesOverloadsAndGeneratedSource",
            "testScopeAndSamePathSource",
            "unrelatedModuleIsNotVisible",
        ] {
            let signature = format!(
                "{method}(){} {{",
                if method == "dependenciesOverloadsAndGeneratedSource" {
                    " throws Exception"
                } else {
                    ""
                }
            );
            assert!(test.contains(&signature));
            *test = test.replace(&signature, &format!(
                "{signature}\n    try {{ String proof = System.getProperty(\"java.home\") + \"|\" + System.getProperty(\"test.literal\") + \"|\" + System.getenv(\"LAUNCH_PROOF\"); java.nio.file.Files.write(java.nio.file.Paths.get(\"proof-{method}.txt\"), proof.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }} catch (java.io.IOException error) {{ throw new AssertionError(error); }}"
            ));
        }
        if operation == "rerun" {
            *test = test.replace(
                "assertEquals(\"test-token\", TestToken.VALUE);",
                "assertEquals(\"deliberate-failure\", TestToken.VALUE);",
            );
        }
    }
    for (relative, contents) in &inputs {
        let path = f.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
    let runtime_directory = f.root.join("run assets/café's");
    if separate_working_directory {
        fs::create_dir_all(&runtime_directory).unwrap();
        fs::write(runtime_directory.join("settings.txt"), "PROJECT_CONTEXT_CWD").unwrap();
    }
    let local_repository = PathBuf::from(std::env::var_os("HOME").unwrap()).join(".m2/repository");
    let gradle =
        std::env::var("IDE_JAVA_CONTEXT_TEST_GRADLE").unwrap_or_else(|_| "/usr/bin/gradle".into());
    let gradle_home = std::env::var_os("IDE_JAVA_CONTEXT_TEST_GRADLE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap()).join(".gradle"));
    let cold = std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_COLD").is_some();
    if !cold {
        let build = if tool == "maven" {
            Command::new("mvn")
                .current_dir(&f.root)
                .env("JAVA_HOME", &home)
                .args([
                    "-B",
                    "-o",
                    "-Dstyle.color=never",
                    if ["discover", "coverage", "rerun"].contains(&operation.as_str()) {
                        "test-compile"
                    } else {
                        "verify"
                    },
                ])
                .args(if alternate_profile {
                    vec!["-Palternate"]
                } else {
                    vec![]
                })
                .arg(format!("-Dmaven.repo.local={}", local_repository.display()))
                .output()
                .unwrap()
        } else {
            Command::new(&gradle)
                .current_dir(&f.root)
                .env("JAVA_HOME", gradle_runtime.as_ref().unwrap_or(&home))
                .args(["--offline", "--no-daemon", "--console=plain", "-g"])
                .arg(&gradle_home)
                .arg("classes")
                .output()
                .unwrap()
        };
        assert!(
            build.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&build.stdout),
            String::from_utf8_lossy(&build.stderr)
        );
    }
    if custom_outputs {
        let stale_source = f.root.join(".ide/stale-output-fixture/pkg/Runner.java");
        fs::create_dir_all(stale_source.parent().unwrap()).unwrap();
        fs::write(&stale_source,"package pkg; public final class Runner { public static void main(String[] args) { throw new AssertionError(\"STALE_GRADLE_OUTPUT_LOADED\"); } }").unwrap();
        let stale_output = f.root.join("app/build/classes/java/main");
        fs::create_dir_all(&stale_output).unwrap();
        let compiled = Command::new(Path::new(&home).join("bin/javac"))
            .arg("-d")
            .arg(&stale_output)
            .arg(&stale_source)
            .output()
            .unwrap();
        assert!(
            compiled.status.success(),
            "{}",
            String::from_utf8_lossy(&compiled.stderr)
        );
    }
    if separate_working_directory {
        let proof = f.root.join("app/project-test-cwd.txt");
        if proof.exists() { fs::remove_file(proof).unwrap(); }
    }
    let compiler_fault = if compiler_failure {
        let source = "app/src/main/java/pkg/Runner.java";
        let original = inputs[source].clone();
        let syntax = std::env::var("IDE_JAVA_CONTEXT_EXECUTION_COMPILER_FAILURE").as_deref() == Ok("syntax");
        let broken = if syntax {
            original.replace("public static void main(String[] args) throws Exception {",
                "public static void main(String[] args) throws Exception {\n    int compilerFault = ?;")
        } else { format!("{original}\nclass CompilerFailure {{ int value = missing; }}\n") };
        assert_ne!(broken, original, "The compiler fault must change the source.");
        let marker = if syntax { "int compilerFault" } else { "class CompilerFailure" };
        let line = broken.lines().position(|line| line.contains(marker)).unwrap() + 1;
        fs::write(f.root.join(source), &broken).unwrap();
        Some((source, original, line))
    } else { None };
    let state = JavaProjectContextState::default();
    let mut settings = f.request();
    settings.sdk_home = home.clone();
    settings.maven_repository = local_repository.to_string_lossy().into_owned();
    if alternate_profile {
        settings.active_maven_profiles = vec!["alternate".into()];
    }
    if tool == "gradle" {
        let mut gradle_settings =
            json!({"executable":gradle,"userHome":gradle_home,"projectProperties":{}});
        if let Some(runtime) = &gradle_runtime {
            gradle_settings["gradleRuntimeHome"] = json!(runtime);
        }
        settings.gradle = Some(serde_json::from_value(gradle_settings).unwrap());
        settings.evaluate_gradle = Some(true);
    }
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let observed =
        query_owned(f.binding.clone(), settings.clone(), state.0.clone(), ticket).unwrap();
    assert_eq!(observed["status"], "available", "{observed}");
    let app = observed["context"]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["root"] == "app")
        .unwrap();
    let main = app["sourceSets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| {
            if custom_gradle_source_set_task {
                s["id"] == "integrationTest"
            } else if custom_source_set {
                s["id"] == "smoke"
            } else {
                s["kind"]
                    == if ["test", "debug-test", "discover", "coverage", "rerun"].contains(&operation.as_str())
                        && std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_TEST_FROM_MAIN").is_none()
                    {
                        "test"
                    } else {
                        "main"
                    }
            }
        })
        .unwrap();
    if custom_outputs {
        assert_eq!(
            main["outputDirectories"],
            json!([if main["kind"] == "test" {
                "app/products/test"
            } else {
                "app/products/main"
            }]),
            "{main}"
        );
        assert!(
            !serde_json::to_string(&main["runtimeClasspath"])
                .unwrap()
                .contains("build/classes"),
            "{main}"
        );
    }
    let selection:JavaExecutionProjectSelection=serde_json::from_value(json!({
        "context":{"projectPath":"","sdkHome":home,"mavenRepository":settings.maven_repository,
            "activeMavenProfiles":settings.active_maven_profiles,"inactiveMavenProfiles":settings.inactive_maven_profiles,"gradle":settings.gradle,"snapshotHash":observed["context"]["snapshotHash"],
            "contextSchemaVersion":observed["context"]["schemaVersion"],
            "contextHash":observed["context"]["contextHash"],"platformIdentities":observed["context"]["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()},
        "providerId":app["providerId"],"moduleId":app["id"],"sourceSetId":main["id"]})).unwrap();
    let provider = JavaExecutionProjectContext::new(&state);
    let resolved = provider.captured(&f.binding, 1, &selection).unwrap();
    assert_eq!(resolved.module_root, f.root.join("app"));
    let executor = JavaExecutionState::new(&state);
    struct ExecutionCleanup<'a>(&'a JavaExecutionState);
    impl Drop for ExecutionCleanup<'_> {
        fn drop(&mut self) {
            self.0.shutdown_all();
        }
    }
    let _execution_cleanup = ExecutionCleanup(&executor);
    let debug_source_path = if debugging_test {
        test_source
    } else if custom_source_set {
        "app/src/smoke/java/pkg/SmokeRunner.java"
    } else {
        "app/src/main/java/pkg/Runner.java"
    };
    let debug_class_name = if debugging_test {
        "pkg.RunnerTest"
    } else if custom_source_set {
        "pkg.SmokeRunner"
    } else {
        "pkg.Runner"
    };
    let debug_line = (inputs[debug_source_path]
        .lines()
        .position(|line| line.contains(if debugging_test { test_jdk_proof } else { "PROJECT_LAUNCH_JDK:" }))
        .unwrap()
        + 1) as u32;
    let fingerprint = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(inputs[debug_source_path].as_bytes()))
    };
    let make_request = |trusted| -> ExecutionRequest {
        serde_json::from_value(json!({
        "workspaceId":f.binding.workspace_id,"generation":1,"operation":if operation=="rerun" {"test"} else {&operation},"trusted":trusted,
        "profile":std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_PROFILE_JFR").is_some(),
        "configuration":{"buildTool":"auto","mainClass":if custom_source_set {"pkg.SmokeRunner"} else {"pkg.Runner"},"classPath":[],
        "workingDirectory":if separate_working_directory {"run assets/café's"} else {""},
        "applicationInput":application_input,
        "testFilter":if debugging_test {format!("pkg.RunnerTest#{test_method}")} else if custom_gradle_test_task || custom_gradle_coverage {"pkg.SmokeTest#selected".into()} else if missing_test {"pkg.RunnerTest#missing".into()} else if ["test","coverage","rerun"].contains(&operation.as_str()) {"pkg.RunnerTest".into()} else {"".into()},"debuggerMode":debugger_mode,
            "testJvmOptions":if !legacy_maven_discovery && (custom_gradle_test_task || custom_gradle_discovery || custom_gradle_coverage || ["discover","coverage","rerun"].contains(&operation.as_str())) {json!(["-Dtest.literal=value with spaces"])} else {json!([])},
            "jvmOptions":["-Dlaunch.literal=value with spaces"],"programArguments":["","a b","@literal","both'\"quotes"],
            "environment":[{"name":"LAUNCH_PROOF","value":"environment value"}]},
        "sourceBreakpoints":if debugging && !console_debug {json!([{"sourcePath":debug_source_path,"line":debug_line,"fingerprint":fingerprint}])} else {json!([])}})).unwrap()
    };
    assert!(executor
        .start_project(f.binding.clone(), make_request(false), selection.clone())
        .is_err());
    let started = serde_json::to_value(
        executor
            .start_project(f.binding.clone(), make_request(true), selection.clone())
            .unwrap(),
    )
    .unwrap();
    let session:SessionRequest=serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    let mut debug_continued = false;
    let mut debug_entry_continued = false;
    let mut console_stack_requested = false;
    let input_text = format!("quit\ncont\n\ncafé 𐐀 'quoted' $(false);\0{}", "🙂雪".repeat(1400));
    let mut input_offset = 0;
    let mut input_sequence = 1_u64;
    let mut input_closed = false;
    let completed = loop {
        let snapshot =
            serde_json::to_value(executor.snapshot_at(&f.binding, &session).unwrap()).unwrap();
        if console_debug {
            let output = snapshot["output"].as_str().unwrap();
            let send = |command: &str| {
                let request = serde_json::from_value(json!({
                    "workspaceId":session.workspace_id,"generation":session.generation,
                    "sessionId":session.session_id,"command":command,
                })).unwrap();
                executor.debug_command_at(&f.binding, request).unwrap();
            };
            if !debug_entry_continued && output.contains("VM Started") {
                send(&format!("stop at {debug_class_name}:{debug_line}"));
                send("cont");
                debug_entry_continued = true;
            } else if !console_stack_requested && output.contains("Breakpoint hit") {
                send("where");
                console_stack_requested = true;
            } else if !debug_continued && output.contains(&format!("[1] {debug_class_name}.main")) {
                send("cont");
                debug_continued = true;
            }
        }
        if debugging && !console_debug
            && !debug_entry_continued
            && snapshot["debuggerState"]["status"] == "suspended"
            && snapshot["debuggerState"]["reason"] == "entry"
        {
            executor.debug_action_at(&f.binding,&serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":session.session_id,"action":{"type":"continue","stopId":snapshot["debuggerState"]["stopId"]}})).unwrap()).unwrap();
            debug_entry_continued = true;
        }
        if debugging && !console_debug
            && !debug_continued
            && snapshot["debuggerState"]["status"] == "suspended"
            && snapshot["debuggerState"]["frames"]
                .as_array()
                .is_some_and(|frames| {
                    frames.iter().any(|frame| {
                        frame["className"] == debug_class_name && frame["line"] == debug_line
                    })
                })
        {
            assert!(
                snapshot["debuggerState"]["breakpoints"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|point| point["verified"] == true && point["line"] == debug_line),
                "{snapshot}"
            );
            executor.debug_action_at(&f.binding,&serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":session.session_id,"action":{"type":"continue","stopId":snapshot["debuggerState"]["stopId"]}})).unwrap()).unwrap();
            debug_continued = true;
        }
        if application_input && !input_closed && snapshot["applicationInput"]["state"] == "open"
            && snapshot["output"].as_str().unwrap().contains("PROJECT_INPUT_READY")
        {
            use base64::Engine;
            let bytes = input_text.as_bytes();
            let data = if input_offset == bytes.len() { None }
                else { Some(base64::engine::general_purpose::STANDARD.encode(&bytes[input_offset..(input_offset + 4096).min(bytes.len())])) };
            let request = serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,
                "generation":1,"sessionId":session.session_id,"sequence":input_sequence,"dataBase64":data})).unwrap();
            let result = serde_json::to_value(executor.application_input_at(&f.binding, &request).unwrap()).unwrap();
            let retried = serde_json::to_value(executor.application_input_at(&f.binding, &request).unwrap()).unwrap();
            assert_eq!(result, retried, "An exact retry must only repeat the acknowledgement.");
            assert_eq!(result["sessionId"], session.session_id);
            assert_eq!(result["sequence"], input_sequence);
            assert_eq!(result["input"]["nextSequence"], input_sequence + 1);
            let count = result["acceptedBytes"].as_u64().unwrap() as usize;
            assert!(count <= 4096.min(bytes.len() - input_offset));
            input_offset += count;
            input_sequence += 1;
            input_closed = data.is_none();
        }
        if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) {
            break snapshot;
        }
        assert!(std::time::Instant::now() < deadline, "{snapshot}");
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    assert_eq!(
        completed["state"],
        if operation == "rerun"
            || compiler_failure
            || missing_test
            || custom_gradle_test_ambiguous
            || custom_gradle_test_classpath_mismatch
        {
            "failed"
        } else {
            "succeeded"
        },
        "{completed}"
    );
    if custom_source_set && operation == "build" {
        let selected_output_contains_compiled_class = main["outputDirectories"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .any(|output| f.root.join(output).join("pkg/SmokeRunner.class").is_file());
        assert!(
            selected_output_contains_compiled_class,
            "Gradle Build must compile the selected custom source set into its declared output: {}",
            main["outputDirectories"]
        );
    }
    let output = completed["output"].as_str().unwrap();

    if let Some((source, original, line)) = compiler_fault {
        assert!(completed["exitCode"].as_i64().is_some_and(|value| value > 0), "{completed}");
        assert!(completed["compilerDiagnostics"]["items"].as_array().is_some_and(|items|
            items.iter().any(|item| item["path"] == source && item["line"] == line && item["severity"] == "error")),
            "The synchronized project must reach the build tool and report its source location: {completed}");
        assert!(!output.contains("JAVA_REFERENCE_OK:"), "A failed compile ran stale application classes: {completed}");
        fs::write(f.root.join(source), original).unwrap();
        let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
        let repaired_context = query_owned(f.binding.clone(), settings.clone(), state.0.clone(), ticket).unwrap();
        assert_eq!(repaired_context["status"], "available", "{repaired_context}");
        let mut repaired = serde_json::to_value(&selection).unwrap();
        repaired["context"]["snapshotHash"] = repaired_context["context"]["snapshotHash"].clone();
        repaired["context"]["contextHash"] = repaired_context["context"]["contextHash"].clone();
        repaired["context"]["platformIdentities"] = json!(repaired_context["context"]["sdk"].as_array().unwrap().iter().map(|sdk| sdk["identitySha256"].clone()).collect::<Vec<_>>());
        let repaired = serde_json::from_value(repaired).unwrap();
        let started = serde_json::to_value(executor.start_project(f.binding.clone(), make_request(true), repaired).unwrap()).unwrap();
        let repaired_session: SessionRequest = serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        let repaired = loop {
            let snapshot = serde_json::to_value(executor.snapshot_at(&f.binding, &repaired_session).unwrap()).unwrap();
            if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) { break snapshot; }
            assert!(std::time::Instant::now() < deadline, "{snapshot}");
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        assert_eq!(repaired["state"], "succeeded", "{repaired}");
        assert!(repaired["compilerDiagnostics"]["items"].as_array().is_none_or(Vec::is_empty), "{repaired}");
        if operation == "run" { assert!(repaired["output"].as_str().unwrap().contains("JAVA_REFERENCE_OK:"), "{repaired}"); }
        for (relative, original) in &inputs { assert_eq!(fs::read_to_string(f.root.join(relative)).unwrap(), *original, "{relative}"); }
        executor.shutdown_all();
        return;
    }
    if application_input {
        use base64::Engine;
        assert!(input_closed, "The application completed before input was closed: {completed}");
        assert_eq!(input_offset, input_text.len());
        assert_eq!(completed["applicationInput"]["acceptedBytes"], input_text.len());
        assert_eq!(completed["applicationInput"]["state"], "closed");
        assert!(output.contains(&format!("PROJECT_INPUT_BYTES:{}",
            base64::engine::general_purpose::STANDARD.encode(input_text.as_bytes()))), "{output}");
    }
    if ["run", "debug"].contains(&operation.as_str()) {
        if operation == "debug" {
            assert!(
                debug_continued,
                "No verified source breakpoint was reached: {completed}"
            );
        }
        if custom_source_set {
            assert!(
                output.contains("CUSTOM_SOURCE_SET_OK:value with spaces|[, a b, @literal, both'\"quotes]|environment value"),
                "{output}"
            );
        } else {
            assert!(output.contains("JAVA_REFERENCE_OK:"), "{output}");
            assert!(
                output.contains(&format!(
                    "main-peer|{}",
                    if alternate_profile {
                        "alternate"
                    } else {
                        "base"
                    }
                )),
                "{output}"
            );
        }
        let sdk = Path::new(&home).canonicalize().unwrap();
        let legacy_runtime = sdk.join("jre");
        assert!(
            output.lines()
                .filter_map(|line| line.split_once("PROJECT_LAUNCH_JDK:"))
                .map(|(_, runtime)| Path::new(runtime))
                .any(|actual| actual == sdk || (release == "8" && actual == legacy_runtime)),
            "{output}"
        );
        if !custom_source_set {
            assert!(
                output
                    .contains("PROJECT_LAUNCH_LITERAL:value with spaces|[, a b, @literal, both'\"quotes]|environment value"),
                "{output}"
            );
        }
        if std::env::var_os("IDE_JAVA_CONTEXT_EXECUTION_PROFILE_JFR").is_some() {
            let path = completed["profilePath"].as_str().expect("JFR output path");
            let recording = f.root.join(path);
            assert!(recording.is_file(), "{recording:?}");
            let summary = Command::new(Path::new(&home).join("bin/jfr"))
                .args(["summary", recording.to_str().unwrap()])
                .output()
                .unwrap();
            assert!(
                summary.status.success(),
                "{}",
                String::from_utf8_lossy(&summary.stderr)
            );
        }
    } else if operation == "discover" {
        assert_eq!(completed["testDiscovery"]["status"], "ready", "{completed}");
        let tests = completed["testDiscovery"]["tests"].as_array().unwrap();
        let class_name = if custom_gradle_discovery {
            "pkg.SmokeTest"
        } else {
            "pkg.RunnerTest"
        };
        let methods: &[&str] = if custom_gradle_discovery {
            &["selected", "companion"]
        } else {
            &[
                "dependenciesOverloadsAndGeneratedSource",
                "testScopeAndSamePathSource",
                "unrelatedModuleIsNotVisible",
            ]
        };
        let chosen_method = if custom_gradle_discovery {
            "selected"
        } else {
            "testScopeAndSamePathSource"
        };
        for method in methods {
            assert!(
                tests
                    .iter()
                    .any(|test| test["className"] == class_name && test["methodName"] == *method),
                "{completed}"
            );
            let proof = if custom_gradle_discovery {
                format!("app/proof-custom-{method}.txt")
            } else {
                format!("app/proof-{method}.txt")
            };
            assert!(!f.root.join(proof).exists(), "Discovery executed {method}");
        }
        let chosen = tests
            .iter()
            .find(|test| test["className"] == class_name && test["methodName"] == chosen_method)
            .unwrap();
        let selected:ExecutionRequest=serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"operation":"test","trusted":true,"configuration":{"buildTool":"jdk","mainClass":"unused","classPath":[],"jdkHome":"/unavailable-current-draft"},"testSelection":{"discoverySessionId":session.session_id,"testId":chosen["id"]}})).unwrap();
        let started =
            serde_json::to_value(executor.start(f.binding.clone(), selected).unwrap()).unwrap();
        let selected_session:SessionRequest=serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        let selected = loop {
            let snapshot =
                serde_json::to_value(executor.snapshot_at(&f.binding, &selected_session).unwrap())
                    .unwrap();
            if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) {
                break snapshot;
            }
            assert!(std::time::Instant::now() < deadline, "{snapshot}");
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        assert_eq!(selected["state"], "succeeded", "{selected}");
        assert_eq!(selected["testResults"]["summary"]["total"], 1, "{selected}");
        assert_eq!(
            selected["testResults"]["summary"]["passed"], 1,
            "{selected}"
        );
        if custom_gradle_discovery {
            assert_eq!(
                fs::read_to_string(f.root.join("app/proof-custom-selected.txt")).unwrap(),
                format!(
                    "{}|value with spaces|environment value",
                    Path::new(&home).canonicalize().unwrap().display()
                )
            );
            assert!(!f.root.join("app/proof-custom-companion.txt").exists());
        } else {
            let jdk = Path::new(&home);
            let expected_home = if legacy_maven_discovery { jdk.join("jre") } else { jdk.to_path_buf() };
            let expected_option = if legacy_maven_discovery { "null" } else { "value with spaces" };
            assert_eq!(
                fs::read_to_string(f.root.join("app/proof-testScopeAndSamePathSource.txt"))
                    .unwrap(),
                format!(
                    "{}|{expected_option}|environment value",
                    expected_home.canonicalize().unwrap().display()
                )
            );
            for method in [
                "dependenciesOverloadsAndGeneratedSource",
                "unrelatedModuleIsNotVisible",
            ] {
                assert!(!f.root.join(format!("app/proof-{method}.txt")).exists());
            }
        }
    } else if operation == "rerun" {
        assert_eq!(
            completed["testResults"]["summary"]["failed"], 1,
            "{completed}"
        );
        assert_eq!(
            completed["testResults"]["summary"]["passed"], 2,
            "{completed}"
        );
        let repaired = inputs
            .get_mut("app/src/test/java/pkg/RunnerTest.java")
            .unwrap();
        *repaired = repaired.replace(
            "assertEquals(\"deliberate-failure\", TestToken.VALUE);",
            "assertEquals(\"test-token\", TestToken.VALUE);",
        );
        fs::write(
            f.root.join("app/src/test/java/pkg/RunnerTest.java"),
            &repaired,
        )
        .unwrap();
        for method in [
            "dependenciesOverloadsAndGeneratedSource",
            "testScopeAndSamePathSource",
            "unrelatedModuleIsNotVisible",
        ] {
            fs::remove_file(f.root.join(format!("app/proof-{method}.txt"))).unwrap();
        }
        let rerun = |trusted| {
            serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":session.session_id,"trusted":trusted})).unwrap()
        };
        assert!(executor
            .rerun_failed(f.binding.clone(), rerun(false))
            .is_err());
        let started = serde_json::to_value(
            executor
                .rerun_failed(f.binding.clone(), rerun(true))
                .unwrap(),
        )
        .unwrap();
        let rerun_session:SessionRequest=serde_json::from_value(json!({"workspaceId":f.binding.workspace_id,"generation":1,"sessionId":started["sessionId"]})).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        let rerun = loop {
            let snapshot =
                serde_json::to_value(executor.snapshot_at(&f.binding, &rerun_session).unwrap())
                    .unwrap();
            if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) {
                break snapshot;
            }
            assert!(std::time::Instant::now() < deadline, "{snapshot}");
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        assert_eq!(rerun["state"], "succeeded", "{rerun}");
        assert_eq!(rerun["testResults"]["summary"]["total"], 1, "{rerun}");
        assert_eq!(rerun["testResults"]["summary"]["passed"], 1, "{rerun}");
        assert_eq!(
            fs::read_to_string(f.root.join("app/proof-testScopeAndSamePathSource.txt")).unwrap(),
            format!(
                "{}|value with spaces|environment value",
                Path::new(&home).canonicalize().unwrap().display()
            )
        );
        for method in [
            "dependenciesOverloadsAndGeneratedSource",
            "unrelatedModuleIsNotVisible",
        ] {
            assert!(!f.root.join(format!("app/proof-{method}.txt")).exists());
        }
    } else if missing_test {
        assert_eq!(
            completed["testResults"]["status"], "unavailable",
            "{completed}"
        );
        assert_eq!(
            completed["testResults"]["summary"]["total"], 0,
            "{completed}"
        );
    } else if custom_gradle_test_task {
        if custom_gradle_test_ambiguous || custom_gradle_test_classpath_mismatch {
            assert_eq!(
                completed["testResults"]["status"], "unavailable",
                "{completed}"
            );
            let expected = if custom_gradle_test_ambiguous {
                "exactly one Gradle Test task"
            } else {
                "does not contain the source set runtime classpath"
            };
            assert!(
                completed["output"].as_str().unwrap().contains(expected),
                "{completed}"
            );
            assert!(!f.root.join("app/proof-custom-selected.txt").exists());
            assert!(!f.root.join("app/proof-custom-companion.txt").exists());
        } else {
            assert_eq!(completed["testResults"]["status"], "ready", "{completed}");
            assert_eq!(
                completed["testResults"]["summary"]["total"], 1,
                "{completed}"
            );
            assert_eq!(
                completed["testResults"]["summary"]["passed"], 1,
                "{completed}"
            );
            assert_eq!(
                completed["testResults"]["summary"]["failed"], 0,
                "{completed}"
            );
            assert_eq!(
                fs::read_to_string(f.root.join("app/proof-custom-selected.txt")).unwrap(),
                format!(
                    "{}|value with spaces|environment value",
                    Path::new(&home).canonicalize().unwrap().display()
                )
            );
            assert!(
                !f.root.join("app/proof-custom-companion.txt").exists(),
                "The Gradle test filter must exclude the companion method."
            );
            let repeat_ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
            let refreshed = query_owned(
                f.binding.clone(),
                settings.clone(),
                state.0.clone(),
                repeat_ticket,
            )
            .unwrap();
            assert_eq!(refreshed["status"], "available", "{refreshed}");
            let refreshed_app = refreshed["context"]["modules"]
                .as_array()
                .unwrap()
                .iter()
                .find(|module| module["root"] == "app")
                .unwrap();
            let refreshed_source = refreshed_app["sourceSets"]
                .as_array()
                .unwrap()
                .iter()
                .find(|source_set| source_set["id"] == "integrationTest")
                .unwrap();
            let repeated_selection: JavaExecutionProjectSelection = serde_json::from_value(json!({
                "context": {
                    "projectPath":"",
                    "sdkHome":home,
                    "mavenRepository":settings.maven_repository,
                    "activeMavenProfiles":settings.active_maven_profiles,
                    "inactiveMavenProfiles":settings.inactive_maven_profiles,
                    "gradle":settings.gradle,
                    "snapshotHash":refreshed["context"]["snapshotHash"],
                    "contextHash":refreshed["context"]["contextHash"],
                    "contextSchemaVersion":refreshed["context"]["schemaVersion"],
                    "platformIdentities":refreshed["context"]["sdk"].as_array().unwrap().iter().map(|sdk|sdk["identitySha256"].clone()).collect::<Vec<_>>()
                },
                "providerId":refreshed_app["providerId"],
                "moduleId":refreshed_app["id"],
                "sourceSetId":refreshed_source["id"]
            }))
            .unwrap();
            let repeated = serde_json::to_value(
                executor
                    .start_project(f.binding.clone(), make_request(true), repeated_selection)
                    .unwrap(),
            )
            .unwrap();
            let repeated_session: SessionRequest = serde_json::from_value(json!({
                "workspaceId":f.binding.workspace_id,
                "generation":1,
                "sessionId":repeated["sessionId"]
            }))
            .unwrap();
            let repeat_deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
            let repeated = loop {
                let snapshot = serde_json::to_value(
                    executor.snapshot_at(&f.binding, &repeated_session).unwrap(),
                )
                .unwrap();
                if !matches!(snapshot["state"].as_str(), Some("starting" | "running")) {
                    break snapshot;
                }
                assert!(std::time::Instant::now() < repeat_deadline, "{snapshot}");
                std::thread::sleep(std::time::Duration::from_millis(50));
            };
            assert_eq!(repeated["state"], "succeeded", "{repeated}");
            assert_eq!(repeated["testResults"]["status"], "ready", "{repeated}");
            assert_eq!(repeated["testResults"]["summary"]["total"], 1, "{repeated}");
            assert_eq!(
                repeated["testResults"]["summary"]["passed"], 1,
                "{repeated}"
            );
        }
    } else if custom_gradle_coverage {
        if custom_gradle_test_ambiguous || custom_gradle_test_classpath_mismatch {
            assert_eq!(
                completed["testResults"]["status"], "unavailable",
                "{completed}"
            );
            assert_eq!(
                completed["coverage"]["status"], "unavailable",
                "{completed}"
            );
            let expected = if custom_gradle_test_ambiguous {
                "exactly one Gradle Test task"
            } else {
                "does not contain the source set runtime classpath"
            };
            assert!(
                completed["output"].as_str().unwrap().contains(expected),
                "{completed}"
            );
            assert!(!f.root.join("app/proof-custom-selected.txt").exists());
            assert!(!f.root.join("app/proof-custom-companion.txt").exists());
        } else {
            assert_eq!(completed["testResults"]["status"], "ready", "{completed}");
            assert_eq!(
                completed["testResults"]["summary"]["total"], 1,
                "{completed}"
            );
            assert_eq!(
                completed["testResults"]["summary"]["passed"], 1,
                "{completed}"
            );
            assert_eq!(completed["coverage"]["status"], "ready", "{completed}");
            assert!(
                completed["coverage"]["counters"]["instructions"]["covered"]
                    .as_u64()
                    .unwrap()
                    > 0,
                "{completed}"
            );
            assert!(
                completed["coverage"]["files"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|file| file["packageName"] == "pkg"
                        && file["name"] == "SmokeTest.java"
                        && file["counters"]["instructions"]["covered"]
                            .as_u64()
                            .unwrap()
                            > 0),
                "{completed}"
            );
            assert_eq!(
                fs::read_to_string(f.root.join("app/proof-custom-selected.txt")).unwrap(),
                format!(
                    "{}|value with spaces|environment value",
                    Path::new(&home).canonicalize().unwrap().display()
                )
            );
            assert!(!f.root.join("app/proof-custom-companion.txt").exists());
        }
    } else if debugging_test {
        assert_eq!(completed["testResults"]["status"], "ready", "{completed}");
        assert!(debug_continued, "The selected test did not reach the saved breakpoint: {completed}");
        assert_eq!(completed["testResults"]["summary"]["total"], 1, "{completed}");
        assert_eq!(completed["testResults"]["summary"]["passed"], 1, "{completed}");
        let sdk = Path::new(&home).canonicalize().unwrap();
        let runtime = if release == "8" { sdk.join("jre") } else { sdk };
        let reported = fs::read_to_string(f.root.join("app").join(test_jdk_proof)).unwrap();
        assert_eq!(Path::new(&reported).canonicalize().unwrap(), runtime);
    } else if operation == "build" {
        assert!(completed["testResults"].is_null(), "{completed}");
    } else {
        assert_eq!(completed["testResults"]["status"], "ready", "{completed}");
        assert_eq!(
            completed["testResults"]["summary"]["total"], 3,
            "{completed}"
        );
        assert_eq!(
            completed["testResults"]["summary"]["passed"], 3,
            "{completed}"
        );
        if operation == "coverage" {
            assert_eq!(completed["coverage"]["status"], "ready", "{completed}");
            assert!(
                completed["coverage"]["counters"]["instructions"]["covered"]
                    .as_u64()
                    .unwrap()
                    > 0,
                "{completed}"
            );
            assert!(
                completed["coverage"]["files"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|file| file["packageName"] == "pkg"
                        && file["name"] == "Runner.java"
                        && file["counters"]["instructions"]["covered"]
                            .as_u64()
                            .unwrap()
                            > 0),
                "{completed}"
            );
            for method in [
                "dependenciesOverloadsAndGeneratedSource",
                "testScopeAndSamePathSource",
                "unrelatedModuleIsNotVisible",
            ] {
                assert_eq!(
                    fs::read_to_string(f.root.join(format!("app/proof-{method}.txt"))).unwrap(),
                    format!(
                        "{}|value with spaces|environment value",
                        Path::new(&home).canonicalize().unwrap().display()
                    )
                );
            }
        }
    }
    if separate_working_directory {
        let expected_directory = if operation == "test" { f.root.join("app") } else { runtime_directory.clone() };
        let proof_name = if operation == "test" { "project-test-cwd.txt" } else { "project-application-cwd.txt" };
        let expected = std::iter::repeat(expected_directory.to_string_lossy().to_string()).take(3).collect::<Vec<_>>().join("\n");
        assert_eq!(fs::read_to_string(expected_directory.join(proof_name)).unwrap(), expected);
        assert_eq!(fs::read_to_string(runtime_directory.join("settings.txt")).unwrap(), "PROJECT_CONTEXT_CWD");
        assert!(!f.root.join(proof_name).exists());
        if operation == "test" {
            assert!(!runtime_directory.join(proof_name).exists());
            assert!(!runtime_directory.join("project-application-cwd.txt").exists());
        } else {
            assert!(!f.root.join("app").join(proof_name).exists());
        }
        let output = if custom_outputs { "app/products/main/pkg/Runner.class" } else if tool == "maven" { "app/target/classes/pkg/Runner.class" } else { "app/build/classes/java/main/pkg/Runner.class" };
        assert!(f.root.join(output).is_file());
        assert!(!runtime_directory.join("target").exists());
        assert!(!runtime_directory.join("build").exists());
    }
    for (relative, contents) in &inputs {
        assert_eq!(
            fs::read_to_string(f.root.join(relative)).unwrap(),
            *contents
        );
    }
    executor.shutdown_all();
    state.shutdown_all();
}

#[test]
fn gradle_preview_targets_require_complete_uniform_options_matching_the_selected_jdk() {
    let root = std::env::temp_dir().join(format!(
        "ide-gradle-preview-targets-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let project = root.join("project");
    let module = project.join("module-a");
    let sdk = root.join("jdk");
    fs::create_dir_all(module.join("src/main/java")).unwrap();
    fs::create_dir_all(&sdk).unwrap();
    let context = json!({
        "schemaVersion": "java-project-context-v3",
        "status": "available",
        "providers": [{"providerId":"gradle-effective-v1", "status":"available"}],
        "sdk": [{"home":sdk, "platformRelease":25}],
        "modules": [{
            "providerId":"gradle-effective-v1",
            "id":":module-a",
            "buildRoot":".",
            "projectPath":":module-a",
            "root":"project/module-a",
            "sourceSets": [
                {
                    "id":"main",
                    "kind":"main",
                    "sourceRoots":["src/main/java"],
                    "compilerOptionsAvailability":"complete",
                    "compilerOptions":[{"name":"compilerArg", "value":"--enable-preview", "origin":"gradle-java-compile::compileJava:sourceSet=main:compilerArgs[0]", "redacted":false}],
                    "release":25
                },
                {
                    "id":"test",
                    "kind":"test",
                    "sourceRoots":["src/test/java"],
                    "compilerOptionsAvailability":"complete",
                    "compilerOptions":[{"name":"compilerArg", "value":"--enable-preview", "origin":"gradle-java-compile::compileTestJava:sourceSet=test:compilerArgs[0]", "redacted":false}],
                    "release":25
                }
            ]
        }]
    });
    let root = root.canonicalize().unwrap();
    let project = project.canonicalize().unwrap();
    let sdk = sdk.canonicalize().unwrap();

    let (targets, release) = gradle_preview_targets(&context, &root, &project, &sdk).unwrap();
    assert_eq!(targets, vec![module.canonicalize().unwrap()]);
    assert_eq!(release, 25);

    let composite_module = root.join("custom-project-dir");
    fs::create_dir_all(composite_module.join("src/main/java")).unwrap();
    fs::create_dir_all(root.join("included-build")).unwrap();
    let mut composite = context.clone();
    composite["schemaVersion"] = json!("java-project-context-v3");
    composite["modules"][0]["id"] = json!("gradle-abc::lib");
    composite["modules"][0]["buildRoot"] = json!("included-build");
    composite["modules"][0]["projectPath"] = json!(":lib");
    composite["modules"][0]["root"] = json!("custom-project-dir");
    let (targets, release) = gradle_preview_targets(&composite, &root, &project, &sdk).unwrap();
    assert_eq!(targets, vec![composite_module.canonicalize().unwrap()]);
    assert_eq!(release, 25);

    let mut escaped = composite.clone();
    escaped["modules"][0]["root"] = json!("../outside-module");
    assert!(gradle_preview_targets(&escaped, &root, &project, &sdk).is_err());

    let mut changed = context.clone();
    changed["modules"][0]["sourceSets"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "sourceRoots":["src/test/java"],
            "compilerOptionsAvailability":"complete",
            "compilerOptions":[],
            "sourceLevel":25
        }));
    assert!(gradle_preview_targets(&changed, &root, &project, &sdk).is_err());

    changed = context.clone();
    changed["modules"][0]["sourceSets"][0]["compilerOptionsAvailability"] = json!("partial");
    assert!(gradle_preview_targets(&changed, &root, &project, &sdk).is_err());

    changed = context.clone();
    changed["modules"][0]["sourceSets"][0]["release"] = json!(26);
    assert!(gradle_preview_targets(&changed, &root, &project, &sdk).is_err());

    changed = context.clone();
    for source_set in changed["modules"][0]["sourceSets"].as_array_mut().unwrap() {
        source_set["compilerOptions"] = json!([]);
    }
    assert!(gradle_preview_targets(&changed, &root, &project, &sdk)
        .unwrap()
        .0
        .is_empty());

    changed = context.clone();
    changed["modules"][0]["sourceSets"][0]["compilerOptions"][0]["redacted"] = json!(true);
    assert!(gradle_preview_targets(&changed, &root, &project, &sdk).is_err());

    changed = context.clone();
    changed["modules"][0]["sourceSets"][0]["compilerOptions"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "name":"compilerArg",
            "value":"--enable-preview",
            "origin":"gradle-java-compile::compileJava:sourceSet=main:compilerArgs[1]",
            "redacted":false
        }));
    assert!(gradle_preview_targets(&changed, &root, &project, &sdk).is_err());

    let _ = fs::remove_dir_all(root);
}
