use super::*;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAIN: &str = "package example;\npublic class Main { public int run() { String marker = \"😀\"; return new Helper().sum(1); } }\n";
const HELPER: &str = "package example;\npublic class Helper extends BaseHelper { public int sum(int value) { return value + 1; } public String sum(String value) { return value; } }\n";
const BASE: &str = "package example;\npublic class BaseHelper {}\n";
const MAIN_PATH: &str = "src/main/java/example/Main.java";
const HELPER_PATH: &str = "src/main/java/example/Helper.java";
const BASE_PATH: &str = "src/main/java/example/BaseHelper.java";

fn verification_context(schema: &str) -> ProjectContext {
    ProjectContext {
        project_path: "maven".into(),
        sdk_home: "/sdk".into(),
        maven_repository: String::new(),
        active_maven_profiles: Vec::new(),
        inactive_maven_profiles: Vec::new(),
        snapshot_hash: "a".repeat(64),
        context_hash: "b".repeat(64),
        context_schema_version: schema.into(),
        platform_identities: vec!["c".repeat(64)],
        gradle: None,
    }
}

fn stale_context_response(context: &ProjectContext) -> Value {
    json!({"schemaVersion":context.context_schema_version,"status":"refused","snapshotHash":"d".repeat(64),
        "contextHash":null,"analysis":null,"selectedSource":null,"sdk":[],"modules":[],"providers":[],"buildEvidence":[],
        "refusal":{"code":"java.context.snapshotStale","message":"Project inputs changed during context acquisition"}})
}

#[test]
fn kotlin_definition_toolchain_is_opt_in_and_requires_an_advertised_saved_gradle_definition() {
    let fixture = Fixture::new();
    let mut request = fixture.request("definition");
    let capability = json!({
        "methods":[{"name":"intelligence.query","features":{"kotlinDefinitionToolchain":true}}]
    });
    assert!(!supports_kotlin_definition(&request, &capability));
    let mut context = verification_context("java-project-context-v3");
    context.gradle = Some(serde_json::from_value(json!({
        "executable":"/tools/gradle","userHome":"","projectProperties":{}
    })).unwrap());
    request.project_context = Some(context);
    assert!(supports_kotlin_definition(&request, &capability));
    assert!(!supports_kotlin_definition(&request, &json!({"methods":[]})));
    request.editor_overlay = Some(EditorOverlay { documents: vec![] });
    assert!(!supports_kotlin_definition(&request, &capability));
    request.editor_overlay = None;
    request.kind = "references".into();
    assert!(!supports_kotlin_definition(&request, &capability));

    let sdk = fixture.root.join("jdk");
    let compiler = fixture.root.join("compiler.jar");
    let dependency = fixture.root.join("dependency.jar");
    fs::write(&compiler, []).unwrap();
    fs::write(&dependency, []).unwrap();
    let classpath = std::env::join_paths([&dependency]).unwrap();
    assert_eq!(kotlin_definition_toolchain(&sdk, None, None).unwrap(), None);
    assert!(kotlin_definition_toolchain(&sdk, Some(compiler.as_os_str()), None).is_err());
    assert!(kotlin_definition_toolchain(&sdk, Some(OsStr::new("compiler.jar")), Some(&classpath)).is_err());
    assert_eq!(
        kotlin_definition_toolchain(&sdk, Some(compiler.as_os_str()), Some(&classpath)).unwrap(),
        Some(json!({"jdkHome":sdk,"compilerJar":compiler,"compilerClasspath":[dependency]})),
    );
}

#[test]
fn typed_snapshot_refusal_is_distinct_from_current_context_and_untrusted_context_failures() {
    let context = verification_context("java-project-context-v7");
    let stale = stale_context_response(&context);
    assert_eq!(
        context_verification_result(&stale, &context).unwrap(),
        ContextVerification::SnapshotStale
    );
    let valid = json!({"schemaVersion":context.context_schema_version,"status":"available","snapshotHash":context.snapshot_hash,
        "contextHash":context.context_hash,"sdk":[{"identitySha256":context.platform_identities[0]}]});
    assert_eq!(
        context_verification_result(&valid, &context).unwrap(),
        ContextVerification::Current
    );
    for field in ["schemaVersion", "snapshotHash", "contextHash"] {
        let mut changed = valid.clone();
        changed[field] = json!("wrong");
        assert!(context_verification_result(&changed, &context).is_err());
    }
    let mut sdk = valid;
    sdk["sdk"][0]["identitySha256"] = json!("e".repeat(64));
    assert!(context_verification_result(&sdk, &context).is_err());
    let invalid = [
        ("schemaVersion", json!("java-project-context-v6")),
        ("snapshotHash", json!("invalid")),
        ("snapshotHash", json!(context.snapshot_hash)),
        ("status", json!("partial")),
        ("contextHash", json!(context.context_hash)),
        ("analysis", json!({"backend":"unexpected"})),
        ("selectedSource", json!({"path":"Source.java"})),
        (
            "sdk",
            json!([{"identitySha256":context.platform_identities[0]}]),
        ),
        ("modules", json!([{}])),
        ("providers", json!([{}])),
        ("buildEvidence", json!([{}])),
        (
            "refusal",
            json!({"code":"java.context.other","message":"not a snapshot refusal"}),
        ),
        (
            "refusal",
            json!({"code":"java.context.snapshotStale","message":"x".repeat(4097)}),
        ),
        (
            "refusal",
            json!({"code":"java.context.snapshotStale","message":""}),
        ),
    ];
    for (field, value) in invalid {
        let mut changed = stale.clone();
        changed[field] = value;
        assert!(
            context_verification_result(&changed, &context).is_err(),
            "{changed}"
        );
    }
    for field in ["sdk", "modules", "providers", "buildEvidence"] {
        let mut missing = stale.clone();
        missing.as_object_mut().unwrap().remove(field);
        assert!(context_verification_result(&missing, &context).is_err());
    }
}

#[test]
fn typed_query_snapshot_refusal_requires_correlated_request_and_no_navigation_evidence() {
    let fixture = Fixture::new();
    let mut request = fixture.request("mutationSelection");
    let context = verification_context("java-project-context-v2");
    let snapshot_hash = context.snapshot_hash.clone();
    let refusal = json!({
        "schemaVersion":1,
        "status":"refused",
        "requestId":request.request_id,
        "kind":request.kind,
        "snapshotHash":"d".repeat(64),
        "indexGeneration":4,
        "error":{"code":"java.context.snapshotStale","message":"Project inputs changed"}
    });
    assert!(!navigation_reports_stale_snapshot(&refusal, &request, &snapshot_hash, 3));
    request.project_context = Some(context);
    assert!(navigation_reports_stale_snapshot(&refusal, &request, &snapshot_hash, 3));
    for (key, value) in [
        ("requestId", json!("another-request")),
        ("kind", json!("definition")),
        ("indexGeneration", json!(2)),
        ("snapshotHash", json!(snapshot_hash)),
        ("locations", json!([{"path":MAIN_PATH}])),
        ("selection", json!({"path":MAIN_PATH})),
        ("error", json!({"code":"java.context.snapshotStale","message":""})),
    ] {
        let mut invalid = refusal.clone();
        invalid[key] = value;
        assert!(!navigation_reports_stale_snapshot(&invalid, &request, &snapshot_hash, 3), "{invalid}");
    }
}

#[test]
fn saved_input_recovery_retires_only_read_only_sdk_contexts_and_never_admits_editor_plans() {
    let fixture = Fixture::new();
    let mut request = fixture.request("definition");
    assert!(saved_inputs_refusal(&request, "source changed").is_err());
    request.project_context = Some(verification_context("java-project-context-v7"));
    let refusal = saved_inputs_refusal(&request, "source changed").unwrap();
    assert_eq!(refusal["status"], "refused");
    assert_eq!(refusal["projectContextRetired"], true);
    assert!(refusal.get("locations").is_none());
    assert!(refusal.get("editorPreview").is_none());
    for mutation_mode in [None, Some("durable-editor-owned")] {
        request.editor_refactoring = Some(serde_json::from_value(json!({
            "operation":"format-file", "target":{"kind":"file","path":MAIN_PATH,"identity":"@cursor"},
            "selectionGeneration":1, "mutationMode":mutation_mode,
        })).unwrap());
        assert!(saved_inputs_refusal(&request, "source changed").is_err());
    }
}

#[test]
fn navigation_context_verification_preserves_v7_scope_and_pins_current_authority() {
    let context = verification_context("java-project-context-v7");
    let selected = (
        "project.context.v7".into(),
        json!({
            "providerId":"maven-effective-v1", "moduleId":"app", "sourceSetId":"main",
            "sourceRelativePath":"pkg/Runner.java", "expectedSnapshotHash":"old",
            "expectedContextHash":"old", "sdkHome":"/old-sdk"
        }),
    );
    let (method, params) =
        navigation_context_verification_request(&context, Path::new("/sdk"), Some(&selected))
            .unwrap();
    assert_eq!(method, "project.context.v7");
    assert_eq!(params["providerId"], "maven-effective-v1");
    assert_eq!(params["moduleId"], "app");
    assert_eq!(params["sourceSetId"], "main");
    assert_eq!(params["sourceRelativePath"], "pkg/Runner.java");
    assert_eq!(params["sdkHome"], "/sdk");
    assert_eq!(params["expectedSnapshotHash"], context.snapshot_hash);
    assert_eq!(params["expectedContextHash"], context.context_hash);
}

#[test]
fn navigation_aggregate_verification_uses_supported_fields_and_preserves_required_facts() {
    let context = verification_context("java-project-context-v3");
    let selected = (
        "project.context.aggregate".into(),
        json!({"sdkHome":"/old-sdk", "expectedSnapshotHash":"old", "requiredFacts":["runtime"]}),
    );
    let (method, params) =
        navigation_context_verification_request(&context, Path::new("/sdk"), Some(&selected))
            .unwrap();
    assert_eq!(method, "project.context.aggregate");
    assert_eq!(
        params,
        json!({"sdkHome":"/sdk", "expectedSnapshotHash":context.snapshot_hash,
        "requiredFacts":["runtime"]})
    );
}

#[test]
fn navigation_context_verification_never_downgrades_versioned_contexts() {
    for schema in [
        "java-project-context-v3",
        "java-project-context-v4",
        "java-project-context-v5",
        "java-project-context-v6",
        "java-project-context-v7",
    ] {
        let context = verification_context(schema);
        assert!(
            navigation_context_verification_request(&context, Path::new("/sdk"), None).is_err()
        );
        let legacy = ("project.context".into(), json!({}));
        assert!(navigation_context_verification_request(
            &context,
            Path::new("/sdk"),
            Some(&legacy)
        )
        .is_err());
    }
}

#[test]
fn navigation_context_verification_keeps_the_legacy_route_for_v1_and_v2() {
    for schema in ["java-project-context-v1", "java-project-context-v2"] {
        let context = verification_context(schema);
        let (method, params) =
            navigation_context_verification_request(&context, Path::new("/sdk"), None).unwrap();
        assert_eq!(method, "project.context");
        assert_eq!(params["expectedSnapshotHash"], context.snapshot_hash);
        assert_eq!(params["expectedContextHash"], context.context_hash);
    }
}

struct Fixture {
    root: PathBuf,
    binding: CurrentWorkspaceBinding,
    state: JavaNavigationState,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-java-navigation-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("src/main/java/example")).unwrap();
        fs::write(root.join(MAIN_PATH), MAIN).unwrap();
        fs::write(root.join(HELPER_PATH), HELPER).unwrap();
        fs::write(root.join(BASE_PATH), BASE).unwrap();
        fs::write(root.join("pom.xml"), "<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>navigation</artifactId><version>1</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>").unwrap();
        let registry = root.join("registry.json");
        crate::commands::workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = current_workspace_binding_at(&root, &registry).unwrap();
        Self {
            root,
            binding,
            state: JavaNavigationState::default(),
        }
    }
    fn request(&self, kind: &str) -> JavaNavigationRequest {
        let line = MAIN.lines().nth(1).unwrap();
        let character = line[..line.find("sum(1)").unwrap()].encode_utf16().count() as u64;
        let mut value = json!({"workspaceId": self.binding.workspace_id, "generation": 1, "requestId": format!("test-{kind}"), "kind": kind,
            "document": {"path": MAIN_PATH, "text": MAIN, "version": 7}, "position": {"line": 1, "character": character}, "includeDeclaration": true,
            "limit": if kind == "definition" || kind == "typeDefinition" {1} else if kind == "typeHierarchy" || kind == "implementations" {200} else if kind == "callHierarchy" {500} else {1000}});
        if kind == "typeHierarchy" {
            value["direction"] = json!("supertypes");
        } else if kind == "callHierarchy" {
            value["direction"] = json!("incoming");
        }
        serde_json::from_value(value).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.state.shutdown_all();
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn provider_rpc_failures_report_the_required_recovery_action() {
    use super::super::transport::SessionCallErrorKind;

    assert!(rpc_failure_message(SessionCallErrorKind::Session, true)
        .contains("synchronize the Java project and retry"));
    assert!(rpc_failure_message(SessionCallErrorKind::Protocol, true)
        .contains("invalid Java navigation response"));
    assert!(
        rpc_failure_message(SessionCallErrorKind::RequestTooLarge, true)
            .contains("Reduce the unsaved Java overlay")
    );
    assert!(rpc_failure_message(SessionCallErrorKind::Rejected, true)
        .contains("synchronize the Java project and retry"));
    assert!(rpc_failure_message(SessionCallErrorKind::Session, false).contains("retry the query"));
}

#[test]
fn provider_refusal_preserves_a_bounded_typed_reason_code() {
    let fixture = Fixture::new();
    let request = fixture.request("definition");
    let raw = json!({
        "schemaVersion": 1,
        "requestId": request.request_id,
        "kind": request.kind,
        "status": "refused",
        "snapshotHash": "a".repeat(64),
        "indexGeneration": 2,
        "error": {
            "code": "java.context.sourceAnalysisUnqualified",
            "message": "Build metadata is available, but Java source analysis is unqualified for this context"
        }
    });

    let normalized = normalize(
        raw,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(normalized["status"], "refused");
    assert_eq!(
        normalized["refusalCode"],
        "java.context.sourceAnalysisUnqualified"
    );

    let malformed = json!({
        "schemaVersion": 1,
        "requestId": request.request_id,
        "kind": request.kind,
        "status": "refused",
        "snapshotHash": "a".repeat(64),
        "indexGeneration": 2,
        "error": {"code": "java.context/sourceAnalysis", "message": "Unqualified"}
    });
    let normalized_without_code = normalize(
        malformed,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert!(normalized_without_code.get("refusalCode").is_none());
}

#[test]
fn internal_json_rpc_error_refuses_only_the_query_and_preserves_selected_context() {
    use super::super::transport::{SessionCallError, SessionCallErrorKind};

    let fixture = Fixture::new();
    let mut request = fixture.request("definition");
    request.project_context = Some(
        serde_json::from_value(json!({
            "projectPath": "",
            "sdkHome": "/configured-jdk",
            "mavenRepository": "/repository",
            "activeMavenProfiles": [],
            "inactiveMavenProfiles": [],
            "snapshotHash": "a".repeat(64),
            "contextHash": "c".repeat(64),
            "platformIdentities": ["d".repeat(64)]
        }))
        .unwrap(),
    );
    let error = SessionCallError {
        kind: SessionCallErrorKind::Rejected,
        rpc_code: Some(JSON_RPC_INTERNAL_ERROR),
        rpc_message: None,
        rpc_refusal_code: None,
    };

    let response = recoverable_internal_query_error(&request, &error).unwrap();
    assert_eq!(response["status"], "refused");
    assert!(response.get("projectContextRetired").is_none());
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("retry the query"));

    let unrelated_rpc_error = SessionCallError {
        rpc_code: Some(-32602),
        ..error
    };
    assert!(recoverable_internal_query_error(&request, &unrelated_rpc_error).is_none());
}

#[test]
fn selected_context_refusal_reports_retirement_only_when_context_was_selected() {
    let fixture = Fixture::new();
    let message = "The Java project session was retired.";
    let mut request = fixture.request("definition");

    let no_context = selected_context_refusal(&request, message, true);
    assert_eq!(no_context["status"], "refused");
    assert!(no_context.get("projectContextRetired").is_none());

    request.project_context = Some(
        serde_json::from_value(json!({
            "projectPath": "",
            "sdkHome": "/configured-jdk",
            "mavenRepository": "/repository",
            "activeMavenProfiles": [],
            "inactiveMavenProfiles": [],
            "snapshotHash": "a".repeat(64),
            "contextHash": "c".repeat(64),
            "platformIdentities": ["d".repeat(64)]
        }))
        .unwrap(),
    );

    let retired = selected_context_refusal(&request, message, true);
    assert_eq!(retired["projectContextRetired"], true);
    let exited_session = selected_context_refusal(
        &request,
        super::super::java_project_context::SESSION_RETIRED_MESSAGE,
        false,
    );
    assert_eq!(exited_session["projectContextRetired"], true);
    let changed_maven_runtime = selected_context_refusal(
        &request,
        super::super::java_project_context::MAVEN_RUNTIME_CHANGED_MESSAGE,
        false,
    );
    assert_eq!(changed_maven_runtime["projectContextRetired"], true);
    let still_selected = selected_context_refusal(&request, message, false);
    assert!(still_selected.get("projectContextRetired").is_none());
}

#[test]
fn cancellation_requires_the_exact_workspace_generation_and_request_id() {
    let fixture = Fixture::new();
    let request = fixture.request("definition");
    let (cancelled, registration) = fixture.state.2.register(&request).unwrap();

    assert!(!fixture
        .state
        .2
        .cancel(&request.workspace_id, 2, &request.request_id));
    assert!(!fixture
        .state
        .2
        .cancel(&request.workspace_id, request.generation, "another-request"));
    assert!(!cancelled.load(Ordering::SeqCst));
    assert!(fixture.state.2.cancel(
        &request.workspace_id,
        request.generation,
        &request.request_id
    ));
    assert!(cancelled.load(Ordering::SeqCst));

    drop(registration);
    assert!(!fixture.state.2.cancel(
        &request.workspace_id,
        request.generation,
        &request.request_id
    ));
}

fn definition_raw(request: &JavaNavigationRequest) -> Value {
    json!({"schemaVersion": 1, "requestId": request.request_id, "kind": request.kind, "status": "ready",
        "snapshotHash": "a".repeat(64), "indexGeneration": 2, "providerId": "java-jdt-bindings-v1", "backend": BACKEND,
        "evidence": "compiler", "completeness": "semantic", "provenanceHash": "b".repeat(64),
        "sourceAuthority": {"kind": "saved-snapshot", "path": MAIN_PATH, "contentSha256": digest(MAIN.as_bytes())},
        "locations": [{"path": HELPER_PATH, "range": {"start": {"line": 1, "character": 33}, "end": {"line": 1, "character": 36}}}]})
}

#[test]
fn utf16_positions_reject_surrogate_splits_and_handle_crlf() {
    let text = "a😀b\r\nnext\n";
    assert!(valid_position(
        text,
        &Position {
            line: 0,
            character: 3
        }
    ));
    assert!(!valid_position(
        text,
        &Position {
            line: 0,
            character: 2
        }
    ));
    assert!(valid_position(
        text,
        &Position {
            line: 0,
            character: 4
        }
    ));
    assert!(!valid_position(
        text,
        &Position {
            line: 0,
            character: 5
        }
    ));
    assert!(valid_position(
        text,
        &Position {
            line: 2,
            character: 0
        }
    ));
    assert!(!valid_position(
        text,
        &Position {
            line: 3,
            character: 0
        }
    ));
}

#[test]
fn configured_navigation_requires_exact_context_schema_and_platform_attestation() {
    let f = Fixture::new();
    let mut request = f.request("definition");
    request.project_context = Some(serde_json::from_value(json!({"projectPath":"","sdkHome":"/configured-jdk","mavenRepository":"/repository",
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":"a".repeat(64),"contextHash":"c".repeat(64),"platformIdentities":["d".repeat(64)]})).unwrap());
    let mut raw = definition_raw(&request);
    let check = |value: Value| {
        normalize(
            value,
            &request,
            &f.root,
            &"a".repeat(64),
            2,
            &digest(MAIN.as_bytes()),
            "0.7.0",
        )
    };
    assert!(check(raw.clone()).is_err());
    raw["contextHash"] = json!("c".repeat(64));
    raw["contextSchemaVersion"] = json!("java-project-context-v1");
    raw["platformIdentities"] = json!(["d".repeat(64)]);
    assert_eq!(
        check(raw.clone()).unwrap()["projectContext"]["contextHash"],
        "c".repeat(64)
    );
    let mut v2_request = request.clone();
    v2_request
        .project_context
        .as_mut()
        .unwrap()
        .context_schema_version = "java-project-context-v2".into();
    let mut v2_raw = raw.clone();
    v2_raw["contextSchemaVersion"] = json!("java-project-context-v2");
    let v2_result = normalize(
        v2_raw,
        &v2_request,
        &f.root,
        &"a".repeat(64),
        2,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(
        v2_result["projectContext"]["contextSchemaVersion"],
        "java-project-context-v2"
    );
    let mut v3_request = request.clone();
    v3_request
        .project_context
        .as_mut()
        .unwrap()
        .context_schema_version = "java-project-context-v3".into();
    let mut v3_raw = raw.clone();
    v3_raw["contextSchemaVersion"] = json!("java-project-context-v3");
    let v3_result = normalize(
        v3_raw,
        &v3_request,
        &f.root,
        &"a".repeat(64),
        2,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(
        v3_result["projectContext"]["contextSchemaVersion"],
        "java-project-context-v3"
    );
    for (key, value) in [
        ("contextHash", json!("e".repeat(64))),
        ("contextSchemaVersion", json!("other")),
        ("platformIdentities", json!(["e".repeat(64)])),
    ] {
        let mut wrong = raw.clone();
        wrong[key] = value;
        assert!(check(wrong).is_err());
    }
}

#[test]
fn java_context_authority_preserves_the_selected_schema_version() {
    for schema in [
        "java-project-context-v1",
        "java-project-context-v2",
        "java-project-context-v3",
    ] {
        let context: ProjectContext = serde_json::from_value(json!({
            "projectPath": "",
            "sdkHome": "/configured-jdk",
            "mavenRepository": "/repository",
            "activeMavenProfiles": [],
            "inactiveMavenProfiles": [],
            "snapshotHash": "a".repeat(64),
            "contextHash": "c".repeat(64),
            "contextSchemaVersion": schema,
            "platformIdentities": ["d".repeat(64)]
        }))
        .unwrap();

        assert_eq!(
            java_context_authority(&context, Path::new("/configured-jdk")),
            json!({
                "sdkHome": "/configured-jdk",
                "expectedContextHash": "c".repeat(64),
                "contextSchemaVersion": schema
            })
        );
    }
}

#[test]
fn immutable_navigation_requires_exact_document_versions_hashes_and_overlay_ranges() {
    let f = Fixture::new();
    let mut request = f.request("definition");
    request.project_context = Some(serde_json::from_value(json!({"projectPath":"","sdkHome":"/jdk","mavenRepository":"",
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":"a".repeat(64),"contextHash":"c".repeat(64),"platformIdentities":["d".repeat(64)]})).unwrap());
    let dirty_helper = format!("// declaration draft\n{HELPER}");
    request.editor_overlay = Some(EditorOverlay {
        documents: vec![
            request.document.clone(),
            Document {
                path: HELPER_PATH.into(),
                text: dirty_helper.clone(),
                version: 2,
            },
        ],
    });
    assert!(validate_request(&request, &f.root).is_ok());
    let mut raw = definition_raw(&request);
    raw["contextHash"] = json!("c".repeat(64));
    raw["contextSchemaVersion"] = json!("java-project-context-v1");
    raw["platformIdentities"] = json!(["d".repeat(64)]);
    raw["providerSnapshotHash"] = json!("e".repeat(64));
    raw["sourceAuthority"] = json!({"kind":"immutable-editor-overlay","baseSnapshotHash":"a".repeat(64),"overlayHash":"f".repeat(64),"documents":
        request.editor_overlay.as_ref().unwrap().documents.iter().map(|document|json!({"path":document.path,"version":document.version,"contentSha256":digest(document.text.as_bytes())})).collect::<Vec<_>>()});
    raw["locations"][0]["range"]["start"]["line"] = json!(2);
    raw["locations"][0]["range"]["end"]["line"] = json!(2);
    let check = |raw| {
        normalize(
            raw,
            &request,
            &f.root,
            &"a".repeat(64),
            2,
            &digest(MAIN.as_bytes()),
            "0.7.0",
        )
    };
    let normalized = check(raw.clone()).unwrap();
    assert_eq!(normalized["sourceFiles"][0]["text"], dirty_helper);
    for key in ["version", "contentSha256", "path"] {
        let mut stale = raw.clone();
        stale["sourceAuthority"]["documents"][0][key] = json!("invalid");
        assert!(check(stale).is_err());
    }
    assert_eq!(
        fs::read_to_string(f.root.join(HELPER_PATH)).unwrap(),
        HELPER
    );
}

#[test]
fn immutable_navigation_refuses_missing_sdk_authority_or_missing_saved_documents() {
    let f = Fixture::new();
    let mut request = f.request("definition");
    request.editor_overlay = Some(EditorOverlay {
        documents: vec![request.document.clone()],
    });
    assert!(validate_request(&request, &f.root).is_err());
    request.project_context = Some(serde_json::from_value(json!({"projectPath":"","sdkHome":"/jdk","mavenRepository":"",
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":"a".repeat(64),"contextHash":"c".repeat(64),"platformIdentities":["d".repeat(64)]})).unwrap());
    request
        .editor_overlay
        .as_mut()
        .unwrap()
        .documents
        .push(Document {
            path: "../outside.java".into(),
            text: "class Outside {}".into(),
            version: 1,
        });
    assert!(validate_request(&request, &f.root).is_err());
}

#[test]
fn requests_refuse_unsaved_text_and_unsafe_source_paths() {
    let fixture = Fixture::new();
    let mut request = fixture.request("definition");
    assert!(validate_request(&request, &fixture.root).is_ok());
    let mut type_hierarchy = fixture.request("typeHierarchy");
    type_hierarchy.limit = 201;
    assert!(validate_request(&type_hierarchy, &fixture.root).is_err());
    let mut call_hierarchy = fixture.request("callHierarchy");
    call_hierarchy.limit = 501;
    assert!(validate_request(&call_hierarchy, &fixture.root).is_err());
    let mut implementations = fixture.request("implementations");
    assert!(validate_request(&implementations, &fixture.root).is_ok());
    implementations.limit = 201;
    assert!(validate_request(&implementations, &fixture.root).is_err());
    request.document.text.push_str("// unsaved");
    assert!(validate_request(&request, &fixture.root).is_err());
    for path in [
        "../Main.java",
        "/Main.java",
        "C:/Main.java",
        "src\\Main.java",
        "src/./Main.java",
    ] {
        assert!(source(&fixture.root, path).is_err());
    }
}

#[test]
fn normalization_binds_compiler_evidence_to_snapshot_source_and_utf16_ranges() {
    let fixture = Fixture::new();
    let request = fixture.request("definition");
    let raw = definition_raw(&request);
    let parsed = normalize(
        raw.clone(),
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(parsed["sourceFiles"][0]["text"], HELPER);
    assert_eq!(parsed["documentVersion"], 7);
    for (field, value) in [
        ("requestId", json!("another")),
        ("snapshotHash", json!("c".repeat(64))),
        ("evidence", json!("structural")),
        ("providerId", json!("other-provider")),
    ] {
        let mut invalid = raw.clone();
        invalid[field] = value;
        assert!(normalize(
            invalid,
            &request,
            &fixture.root,
            &"a".repeat(64),
            1,
            &digest(MAIN.as_bytes()),
            "0.7.0"
        )
        .is_err());
    }
    let mut invalid = raw.clone();
    invalid["sourceAuthority"]["contentSha256"] = json!("c".repeat(64));
    assert!(normalize(
        invalid,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0"
    )
    .is_err());
    let mut invalid = raw.clone();
    invalid["locations"][0]["range"]["end"]["character"] = json!(9999);
    assert!(normalize(
        invalid,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0"
    )
    .is_err());
    let mut invalid = raw;
    invalid["locations"][0]["path"] = json!("../outside.java");
    assert!(normalize(
        invalid,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0"
    )
    .is_err());
}

#[test]
fn semantic_type_and_call_navigation_normalize_direction_partial_coverage_and_locations() {
    let fixture = Fixture::new();
    let source_hash = digest(MAIN.as_bytes());
    let mut type_definition = fixture.request("typeDefinition");
    let mut raw = definition_raw(&type_definition);
    raw["kind"] = json!("typeDefinition");
    raw["target"] = json!({"name":"Helper"});
    raw["scope"] = json!("workspace-source");
    let decoded = normalize(
        raw,
        &type_definition,
        &fixture.root,
        &"a".repeat(64),
        1,
        &source_hash,
        "0.8.0",
    )
    .unwrap();
    assert_eq!(decoded["rootName"], "Helper");
    assert_eq!(decoded["returned"], 1);
    assert_eq!(decoded["items"], json!([]));

    let mut type_hierarchy = fixture.request("typeHierarchy");
    type_hierarchy.direction = Some("supertypes".into());
    let helper_line = HELPER.lines().nth(1).unwrap();
    let helper_start = helper_line.find("Helper").unwrap() as u64;
    let raw = json!({"schemaVersion":1,"requestId":type_hierarchy.request_id,"kind":"typeHierarchy","status":"ready",
        "snapshotHash":"a".repeat(64),"indexGeneration":2,"providerId":"java-jdt-bindings-v1","backend":BACKEND,
        "evidence":"compiler","completeness":"semantic","provenanceHash":"b".repeat(64),
        "sourceAuthority":{"kind":"saved-snapshot","path":MAIN_PATH,"contentSha256":source_hash},
        "root":{"name":"Main"},"direction":"supertypes","scope":"workspace-source","complete":true,
        "warningCount":0,"total":1,"returned":1,"truncated":false,
        "items":[{"relation":"supertype","symbol":{"name":"Helper","location":{"path":HELPER_PATH,
            "range":{"start":{"line":1,"character":helper_start},"end":{"line":1,"character":helper_start+6}}}}}]});
    let decoded = normalize(
        raw,
        &type_hierarchy,
        &fixture.root,
        &"a".repeat(64),
        1,
        &source_hash,
        "0.8.0",
    )
    .unwrap();
    assert_eq!(decoded["direction"], "supertypes");
    assert_eq!(decoded["items"][0]["relation"], "supertype");

    let mut call_hierarchy = fixture.request("callHierarchy");
    call_hierarchy.direction = Some("incoming".into());
    let main_line = MAIN.lines().nth(1).unwrap();
    let method_start = main_line.find("run").unwrap() as u64;
    let call_start = call_hierarchy.position.character;
    let raw = json!({
        "schemaVersion": 1,
        "requestId": call_hierarchy.request_id,
        "kind": "callHierarchy",
        "status": "ready",
        "snapshotHash": "a".repeat(64),
        "indexGeneration": 2,
        "providerId": "java-jdt-bindings-v1",
        "backend": BACKEND,
        "evidence": "compiler",
        "completeness": "partial",
        "provenanceHash": "b".repeat(64),
        "sourceAuthority": {"kind": "saved-snapshot", "path": MAIN_PATH, "contentSha256": source_hash},
        "root": {"name": "sum"},
        "direction": "incoming",
        "scope": "workspace-direct-invocations",
        "complete": false,
        "warningCount": 1,
        "total": 1,
        "returned": 1,
        "truncated": false,
        "items": [{
            "method": {"name": "run", "location": {"path": MAIN_PATH, "range": {
                "start": {"line": 1, "character": method_start},
                "end": {"line": 1, "character": method_start + 3},
            }}},
            "callSites": [{"path": MAIN_PATH, "range": {
                "start": {"line": 1, "character": call_start},
                "end": {"line": 1, "character": call_start + 3},
            }}],
        }],
    });
    let decoded = normalize(
        raw,
        &call_hierarchy,
        &fixture.root,
        &"a".repeat(64),
        1,
        &source_hash,
        "0.8.0",
    )
    .unwrap();
    assert_eq!(decoded["complete"], false);
    assert_eq!(decoded["items"][0]["label"], "run");
    assert_eq!(
        decoded["items"][0]["callSites"].as_array().unwrap().len(),
        1
    );
    assert_eq!(decoded["locations"].as_array().unwrap().len(), 2);

    type_definition.kind = "typeHierarchy".into();
    type_definition.direction = None;
    assert!(validate_request(&type_definition, &fixture.root).is_err());
}

#[test]
fn classpath_call_hierarchy_preserves_binary_identity_without_fabricating_source() {
    let fixture = Fixture::new();
    let source_hash = digest(MAIN.as_bytes());
    let mut request = fixture.request("callHierarchy");
    request.direction = Some("outgoing".into());
    let main_line = MAIN.lines().nth(1).unwrap();
    let method_start = main_line.find("run").unwrap() as u64;
    let call_start = request.position.character;
    let method_location = json!({"path": MAIN_PATH, "range": {
        "start": {"line": 1, "character": method_start},
        "end": {"line": 1, "character": method_start + 3}
    }});
    let call_site = json!({"path": MAIN_PATH, "range": {
        "start": {"line": 1, "character": call_start},
        "end": {"line": 1, "character": call_start + 3}
    }});
    let method_identity = json!({
        "schemaVersion": "java-method-binding-identity-v1",
        "name": "pick",
        "qualifiedName": "dependency.Overloads#pick(java.lang.String)",
        "bindingKey": "Ldependency/Overloads;.pick(Ljava/lang/String;)Ljava/lang/String;",
        "jvmIdentity": {
            "kind": "callable",
            "ownerBinaryName": "dependency.Overloads",
            "memberName": "pick",
            "descriptor": "(Ljava/lang/String;)Ljava/lang/String;"
        }
    });
    let raw = json!({
        "schemaVersion": 1,
        "requestId": request.request_id,
        "kind": "callHierarchy",
        "status": "ready",
        "snapshotHash": "a".repeat(64),
        "indexGeneration": 2,
        "providerId": "java-jdt-bindings-v1",
        "backend": BACKEND,
        "evidence": "compiler",
        "completeness": "partial",
        "provenanceHash": "b".repeat(64),
        "sourceAuthority": {"kind": "saved-snapshot", "path": MAIN_PATH, "contentSha256": source_hash},
        "root": {"name": "Caller#invoke()"},
        "direction": "outgoing",
        "scope": "workspace-direct-invocations",
        "targetScope": "workspace-source+resolved-classpath",
        "complete": false,
        "warningCount": 1,
        "total": 2,
        "returned": 2,
        "truncated": false,
        "items": [
            {
                "method": {"name": "run", "location": method_location},
                "methodIdentity": {
                    "schemaVersion": "java-method-binding-identity-v1",
                    "name": "run",
                    "qualifiedName": "example.Main#run()",
                    "bindingKey": "Lexample/Main;.run()V",
                    "jvmIdentity": null
                },
                "sourceNavigation": {"status": "available", "location": method_location},
                "callSites": [call_site]
            },
            {
                "method": null,
                "methodIdentity": method_identity,
                "sourceNavigation": {"status": "unavailable", "reason": "classpathSourceUnavailable", "location": null},
                "callSites": [call_site]
            }
        ]
    });
    let decoded = normalize(
        raw.clone(),
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &source_hash,
        "0.8.0",
    )
    .unwrap();

    assert_eq!(
        decoded["targetScope"],
        "workspace-source+resolved-classpath"
    );
    assert_eq!(decoded["returned"], 2);
    assert_eq!(
        decoded["items"][0]["sourceNavigation"]["status"],
        "available"
    );
    assert_eq!(
        decoded["items"][1]["label"],
        method_identity["qualifiedName"]
    );
    assert_eq!(decoded["items"][1]["methodIdentity"], method_identity);
    assert_eq!(
        decoded["items"][1]["sourceNavigation"]["status"],
        "unavailable"
    );
    assert_eq!(
        decoded["items"][1]["sourceNavigation"]["location"],
        Value::Null
    );
    assert!(decoded["items"][1].get("location").is_none());
    assert_eq!(decoded["locations"].as_array().unwrap().len(), 3);

    let mut invalid = raw;
    invalid["items"][1]["sourceNavigation"]["location"] = json!({"path": MAIN_PATH});
    assert!(normalize(
        invalid,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &source_hash,
        "0.8.0",
    )
    .is_err());
}

#[test]
fn hierarchy_capabilities_require_the_specific_saved_query_and_position_flags() {
    let capability = json!({"name":"RefactorKit","apiVersion":"0.2","protocol":"json-rpc-2.0","transport":"stdio","version":"0.8.0",
    "methods":[
        {"name":"intelligence.query","stability":"experimental","requiresProject":true,"writesWorkspace":false,
            "features":{"javaSavedSnapshotTypeDefinition":true,"typeDefinitionAtPosition":true,"javaSavedSnapshotTypeHierarchy":true,
                "typeHierarchyAtPosition":true,"javaSavedSnapshotCallHierarchy":true,"callHierarchyAtPosition":true,
                "javaSavedSnapshotImplementations":true,"implementationsAtPosition":true,
                "snapshotBound":true,"typedRefusal":true,"bounded":true}},
        {"name":"project.open","writesWorkspace":false}
    ]});
    assert!(advertised(&capability, "typeDefinition"));
    assert!(advertised(&capability, "typeHierarchy"));
    assert!(advertised(&capability, "callHierarchy"));
    assert!(advertised(&capability, "implementations"));
    let mut missing = capability;
    missing["methods"][0]["features"]["callHierarchyAtPosition"] = json!(false);
    assert!(!advertised(&missing, "callHierarchy"));
    missing["methods"][0]["features"]["javaSavedSnapshotImplementations"] = json!(false);
    assert!(!advertised(&missing, "implementations"));
}

#[test]
fn implementation_results_require_exact_target_kind_scope_and_concrete_relations() {
    let fixture = Fixture::new();
    let request = fixture.request("implementations");
    let method_line = HELPER.lines().nth(1).unwrap();
    let method_start = method_line.find("sum(int").unwrap() as u64;
    let source_hash = digest(MAIN.as_bytes());
    let mut raw = definition_raw(&request);
    raw["completeness"] = json!("semantic");
    raw["root"] = json!({"name":"example.Base#sum(int)"});
    raw["targetKind"] = json!("method");
    raw["scope"] = json!("workspace-source");
    raw["complete"] = json!(true);
    raw["warningCount"] = json!(0);
    raw["total"] = json!(1);
    raw["returned"] = json!(1);
    raw["truncated"] = json!(false);
    raw["items"] = json!([{
        "relation":"concreteMethod",
        "symbol":{"name":"example.Helper#sum(int)","location":{"path":HELPER_PATH,"range":{
            "start":{"line":1,"character":method_start},
            "end":{"line":1,"character":method_start+3}
        }}}
    }]);
    let decoded = normalize(
        raw.clone(),
        &request,
        &fixture.root,
        &"a".repeat(64),
        2,
        &source_hash,
        "0.8.0",
    )
    .unwrap();
    assert_eq!(decoded["targetKind"], "method");
    assert_eq!(decoded["scope"], "workspace-source");
    assert_eq!(decoded["items"][0]["relation"], "concreteMethod");
    assert_eq!(decoded["complete"], true);

    let mut partial = raw.clone();
    partial["completeness"] = json!("partial");
    partial["complete"] = json!(false);
    partial["warningCount"] = json!(1);
    let decoded_partial = normalize(
        partial,
        &request,
        &fixture.root,
        &"a".repeat(64),
        2,
        &source_hash,
        "0.8.0",
    )
    .unwrap();
    assert_eq!(decoded_partial["complete"], false);
    assert_eq!(decoded_partial["warningCount"], 1);

    let mut wrong_relation = raw.clone();
    wrong_relation["targetKind"] = json!("type");
    assert!(normalize(
        wrong_relation,
        &request,
        &fixture.root,
        &"a".repeat(64),
        2,
        &source_hash,
        "0.8.0",
    )
    .is_err());
    let mut wrong_scope = raw;
    wrong_scope["scope"] = json!("workspace-direct-invocations");
    assert!(normalize(
        wrong_scope,
        &request,
        &fixture.root,
        &"a".repeat(64),
        2,
        &source_hash,
        "0.8.0",
    )
    .is_err());
}

#[test]
fn reference_limits_preserve_semantic_completeness_separately_from_truncation() {
    let fixture = Fixture::new();
    let request = fixture.request("references");
    let mut raw = definition_raw(&request);
    raw["references"] = raw["locations"].take();
    raw["total"] = json!(2);
    raw["returned"] = json!(1);
    raw["truncated"] = json!(true);
    raw["complete"] = json!(true);
    raw["warningCount"] = json!(0);
    let result = normalize(
        raw,
        &request,
        &fixture.root,
        &"a".repeat(64),
        1,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(result["complete"], true);
    assert_eq!(result["truncated"], true);
}

#[test]
#[cfg(unix)]
fn source_symlinks_outside_the_workspace_are_refused() {
    let fixture = Fixture::new();
    let outside = Fixture::new();
    std::os::unix::fs::symlink(
        outside.root.join(MAIN_PATH),
        fixture.root.join("Escaped.java"),
    )
    .unwrap();
    assert!(source(&fixture.root, "Escaped.java").is_err());
}

#[test]
#[ignore = "requires IDE_REAL_REFACTORKIT_DAEMON pointing to an installed daemon; run separately with --test-threads=1"]
fn installed_refactorkit_java_navigation_uses_utf16_and_exact_bindings() {
    let engine = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON")
        .expect("Set IDE_REAL_REFACTORKIT_DAEMON to the installed daemon");
    let previous = std::env::var_os("IDE_REFACTORKIT_DAEMON");
    struct Override(Option<std::ffi::OsString>);
    impl Drop for Override {
        fn drop(&mut self) {
            if let Some(value) = &self.0 {
                std::env::set_var("IDE_REFACTORKIT_DAEMON", value);
            } else {
                std::env::remove_var("IDE_REFACTORKIT_DAEMON");
            }
        }
    }
    let _override = Override(previous);
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let fixture = Fixture::new();
    let definition = query_owned(
        fixture.binding.clone(),
        fixture.request("definition"),
        fixture.state.0.clone(),
        fixture.state.1.clone(),
    )
    .unwrap();
    assert_eq!(definition["status"], "ready", "{definition}");
    assert_eq!(definition["locations"][0]["path"], HELPER_PATH);
    assert_eq!(
        definition["locations"][0]["range"]["start"]["character"],
        HELPER.lines().nth(1).unwrap().find("sum(int").unwrap()
    );
    assert_eq!(definition["provider"]["evidence"], "compiler");
    let mut type_request = fixture.request("typeDefinition");
    let source_line = MAIN.lines().nth(1).unwrap();
    let helper_start = source_line.find("Helper").unwrap();
    type_request.position.character = source_line[..helper_start].encode_utf16().count() as u64;
    let type_definition = query_owned(
        fixture.binding.clone(),
        type_request,
        fixture.state.0.clone(),
        fixture.state.1.clone(),
    )
    .unwrap();
    assert_eq!(type_definition["status"], "ready", "{type_definition}");
    assert_eq!(type_definition["rootName"], "Helper");
    assert_eq!(type_definition["locations"][0]["path"], HELPER_PATH);

    let mut hierarchy_request = fixture.request("typeHierarchy");
    hierarchy_request.position.character =
        source_line[..helper_start].encode_utf16().count() as u64;
    hierarchy_request.direction = Some("supertypes".into());
    let hierarchy = query_owned(
        fixture.binding.clone(),
        hierarchy_request,
        fixture.state.0.clone(),
        fixture.state.1.clone(),
    )
    .unwrap();
    assert_eq!(hierarchy["status"], "ready", "{hierarchy}");
    assert_eq!(hierarchy["direction"], "supertypes");
    assert!(hierarchy["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["label"] == "BaseHelper"));

    let calls = query_owned(
        fixture.binding.clone(),
        fixture.request("callHierarchy"),
        fixture.state.0.clone(),
        fixture.state.1.clone(),
    )
    .unwrap();
    assert_eq!(calls["status"], "ready", "{calls}");
    assert_eq!(calls["direction"], "incoming");
    assert!(calls["items"].as_array().unwrap().iter().any(|item| {
        item["label"] == "run" && !item["callSites"].as_array().unwrap().is_empty()
    }));
    let mut request = fixture.request("references");
    request.include_declaration = false;
    let references = query_owned(
        fixture.binding.clone(),
        request,
        fixture.state.0.clone(),
        fixture.state.1.clone(),
    )
    .unwrap();
    assert_eq!(references["status"], "ready", "{references}");
    assert_eq!(references["total"], 1);
    assert_eq!(references["locations"][0]["path"], MAIN_PATH);
    assert_eq!(
        references["locations"][0]["range"]["start"]["character"],
        fixture.request("references").position.character
    );
    let mut request = fixture.request("references");
    request.limit = 1;
    let bounded = query_owned(
        fixture.binding.clone(),
        request,
        fixture.state.0.clone(),
        fixture.state.1.clone(),
    )
    .unwrap();
    assert_eq!(bounded["status"], "ready", "{bounded}");
    assert_eq!(bounded["total"], 2);
    assert_eq!(bounded["truncated"], true);
    assert_eq!(bounded["complete"], true);
    let mut unsaved = fixture.request("definition");
    unsaved.document.text.push_str("// unsaved");
    assert_eq!(
        query_owned(
            fixture.binding.clone(),
            unsaved,
            fixture.state.0.clone(),
            fixture.state.1.clone()
        )
        .unwrap()["status"],
        "refused"
    );
    assert_eq!(
        fs::read_to_string(fixture.root.join(MAIN_PATH)).unwrap(),
        MAIN
    );
    fs::write(
        fixture.root.join(MAIN_PATH),
        MAIN.replace("sum(1)", "sum(2)"),
    )
    .unwrap();
    assert_eq!(
        query_owned(
            fixture.binding.clone(),
            fixture.request("definition"),
            fixture.state.0.clone(),
            fixture.state.1.clone()
        )
        .unwrap()["status"],
        "refused"
    );
    fixture.state.shutdown_all();
    assert!(fixture.state.0.lock().unwrap().is_none());
}

#[test]
fn project_path_prefixing_does_not_create_an_absent_editor_overlay() {
    let mut value = json!({
        "locations": [{"path": "src/main/java/example/Helper.java"}],
        "sourceFiles": [{"path": "src/main/java/example/Helper.java", "text": HELPER}],
    });

    prefix_project_paths(&mut value, "project");

    assert_eq!(
        value["locations"][0]["path"],
        "project/src/main/java/example/Helper.java"
    );
    assert_eq!(
        value["sourceFiles"][0]["path"],
        "project/src/main/java/example/Helper.java"
    );
    assert!(value.get("editorOverlay").is_none());
}

#[test]
fn project_path_prefixing_updates_nested_hierarchy_and_call_site_locations() {
    let mut value = json!({
        "locations": [{"path": "src/main/java/example/BaseHelper.java"}],
        "sourceFiles": [{"path": "src/main/java/example/BaseHelper.java", "text": BASE}],
        "items": [
            {
                "label": "BaseHelper",
                "relation": "supertype",
                "location": {"path": "src/main/java/example/BaseHelper.java"}
            },
            {
                "label": "run",
                "location": {"path": "src/main/java/example/Runner.java"},
                "sourceNavigation": {"status": "available", "location": {"path": "src/main/java/example/Runner.java"}},
                "callSites": [{"path": "src/main/java/example/Runner.java"}]
            }
        ]
    });

    prefix_project_paths(&mut value, "project");

    assert_eq!(
        value["items"][0]["location"]["path"],
        "project/src/main/java/example/BaseHelper.java"
    );
    assert_eq!(
        value["items"][1]["location"]["path"],
        "project/src/main/java/example/Runner.java"
    );
    assert_eq!(
        value["items"][1]["sourceNavigation"]["location"]["path"],
        "project/src/main/java/example/Runner.java"
    );
    assert_eq!(
        value["items"][1]["callSites"][0]["path"],
        "project/src/main/java/example/Runner.java"
    );
}

#[test]
fn project_path_prefixing_updates_overlay_document_paths_when_present() {
    let mut value = json!({
        "locations": [],
        "sourceFiles": [],
        "editorOverlay": {
            "documents": [{"path": "src/main/java/example/Main.java", "version": 3}]
        }
    });

    prefix_project_paths(&mut value, "project");

    assert_eq!(
        value["editorOverlay"]["documents"][0]["path"],
        "project/src/main/java/example/Main.java"
    );
}

#[test]
fn provider_qualified_v3_context_still_returns_project_relative_navigation_paths() {
    let mut value = json!({
        "locations": [{"path": "included/src/main/java/example/Helper.java"}],
        "sourceFiles": [{"path": "included/src/main/java/example/Helper.java", "text": HELPER}],
    });
    let context = ProjectContext {
        project_path: "selected".into(),
        sdk_home: "/sdk".into(),
        maven_repository: String::new(),
        active_maven_profiles: Vec::new(),
        inactive_maven_profiles: Vec::new(),
        snapshot_hash: "a".repeat(64),
        context_hash: "b".repeat(64),
        context_schema_version: "java-project-context-v3".into(),
        platform_identities: vec!["c".repeat(64)],
        gradle: None,
    };

    qualify_project_paths(&mut value, &context);

    assert_eq!(
        value["locations"][0]["path"],
        "selected/included/src/main/java/example/Helper.java"
    );
    assert_eq!(
        value["sourceFiles"][0]["path"],
        "selected/included/src/main/java/example/Helper.java"
    );
}

fn editor_diagnostics_fixture(f: &Fixture) -> (JavaNavigationRequest, Value) {
    let mut request = f.request("diagnostics");
    request.limit = 500;
    request.project_context = Some(serde_json::from_value(json!({"projectPath":"","sdkHome":"/jdk","mavenRepository":"",
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":"a".repeat(64),"contextHash":"c".repeat(64),"platformIdentities":["d".repeat(64)]})).unwrap());
    request.document.text = MAIN.replace("sum(1)", "missing(1)");
    request.editor_overlay = Some(EditorOverlay {
        documents: vec![
            request.document.clone(),
            Document {
                path: HELPER_PATH.into(),
                text: HELPER.into(),
                version: 2,
            },
            Document {
                path: BASE_PATH.into(),
                text: BASE.into(),
                version: 3,
            },
        ],
    });
    let documents = &request.editor_overlay.as_ref().unwrap().documents;
    let raw = json!({"schemaVersion":1,"requestId":request.request_id,"kind":"diagnostics","status":"ready",
        "snapshotHash":"a".repeat(64),"indexGeneration":2,"providerId":"java-jdt-bindings-v1","backend":BACKEND,
        "evidence":"compiler","coverage":"compiler-errors","complete":true,"provenanceHash":"b".repeat(64),
        "contextHash":"c".repeat(64),"contextSchemaVersion":"java-project-context-v1","platformIdentities":["d".repeat(64)],
        "providerSnapshotHash":"e".repeat(64),"analyzedSourceCount":documents.len(),"total":1,
        "sourceAuthority":{"kind":"immutable-editor-overlay","baseSnapshotHash":"a".repeat(64),"overlayHash":"f".repeat(64),
            "documents":documents.iter().map(|d|json!({"path":d.path,"version":d.version,"contentSha256":digest(d.text.as_bytes())})).collect::<Vec<_>>()},
        "items":[{"severity":"error","code":"java.jdt.typeResolution","message":"The method missing(int) is undefined",
            "location":{"path":MAIN_PATH,"range":{"start":{"line":1,"character":0},"end":{"line":1,"character":6}}}}]});
    (request, raw)
}

#[test]
fn editor_diagnostics_require_sdk_buffers_and_the_dedicated_capability() {
    let f = Fixture::new();
    let (mut request, _) = editor_diagnostics_fixture(&f);
    assert!(validate_request(&request, &f.root).is_ok());
    let inbound = json!({"workspaceId":request.workspace_id,"generation":request.generation,
        "requestId":request.request_id,"projectContext":request.project_context,"document":request.document,
        "editorOverlay":{"documents":request.editor_overlay.as_ref().unwrap().documents},"limit":500});
    assert!(
        serde_json::from_value::<super::super::java_editor_diagnostics::Request>(inbound.clone())
            .is_ok()
    );
    let mut missing_schema = inbound;
    missing_schema["projectContext"]
        .as_object_mut()
        .unwrap()
        .remove("contextSchemaVersion");
    assert!(
        serde_json::from_value::<super::super::java_editor_diagnostics::Request>(missing_schema)
            .is_err()
    );
    request.limit = 501;
    assert!(validate_request(&request, &f.root).is_err());
    request.limit = 500;
    request.editor_overlay = None;
    assert!(validate_request(&request, &f.root).is_err());
    let mut caps = json!({"name":"RefactorKit","apiVersion":"0.2","protocol":"json-rpc-2.0","transport":"stdio","version":"0.7.0",
        "methods":[{"name":"intelligence.query","stability":"experimental","requiresProject":true,"writesWorkspace":false,
            "features":{"snapshotBound":true,"typedRefusal":true,"bounded":true}}, {"name":"project.open","writesWorkspace":false}]});
    assert!(!advertised(&caps, "diagnostics"));
    caps["methods"][0]["features"]["javaImmutableEditorOverlayDiagnostics"] = json!(true);
    assert!(advertised(&caps, "diagnostics"));
    caps["methods"][0]["writesWorkspace"] = json!(true);
    assert!(!advertised(&caps, "diagnostics"));
}

#[test]
fn editor_diagnostics_publish_exact_errors_and_accept_an_attested_empty_result() {
    let f = Fixture::new();
    let (request, mut raw) = editor_diagnostics_fixture(&f);
    let check = |raw| {
        normalize(
            raw,
            &request,
            &f.root,
            &"a".repeat(64),
            2,
            &digest(MAIN.as_bytes()),
            "0.7.0",
        )
    };
    let normalized = check(raw.clone()).unwrap();
    assert_eq!(normalized["items"][0]["severity"], "error");
    assert_eq!(normalized["editorOverlay"]["documents"][0]["version"], 7);
    assert_eq!(normalized["coverage"], "compiler-errors");
    raw["items"] = json!([]);
    raw["total"] = json!(0);
    assert_eq!(check(raw).unwrap()["total"], 0);
    assert_eq!(fs::read_to_string(f.root.join(MAIN_PATH)).unwrap(), MAIN);
}

#[test]
fn editor_diagnostics_preserve_distinct_sdk_and_aggregate_compiler_identities() {
    let f = Fixture::new();
    for (id, backend) in [
        (
            "java-sdk-compiler-diagnostics-v1",
            "jdk25-javac-compiler-errors-v1",
        ),
        (
            "java-sdk-and-jdt-compiler-diagnostics-v1",
            "jdk25-javac-compiler-errors-v1+eclipse-jdt-3.44-bindings-v1",
        ),
    ] {
        let (mut request, mut raw) = editor_diagnostics_fixture(&f);
        request
            .project_context
            .as_mut()
            .unwrap()
            .context_schema_version = "java-project-context-v2".into();
        raw["contextSchemaVersion"] = json!("java-project-context-v2");
        raw["providerId"] = json!(id);
        raw["backend"] = json!(backend);
        raw["items"][0]["code"] = json!("java.javac.compiler.err.cant.resolve.location");
        let result = normalize(
            raw,
            &request,
            &f.root,
            &"a".repeat(64),
            2,
            &digest(MAIN.as_bytes()),
            "0.7.0",
        )
        .unwrap();
        assert_eq!(result["provider"]["id"], id);
        assert_eq!(result["provider"]["backend"], backend);
        assert_eq!(
            result["items"][0]["code"],
            "java.javac.compiler.err.cant.resolve.location"
        );
    }
}

#[test]
fn editor_diagnostics_admit_sdk26_only_with_v7_and_single_native_provenance() {
    let f = Fixture::new();
    for version in 1..=7 {
        let (mut request, mut raw) = editor_diagnostics_fixture(&f);
        let schema = format!("java-project-context-v{version}");
        request
            .project_context
            .as_mut()
            .unwrap()
            .context_schema_version = schema.clone();
        raw["contextSchemaVersion"] = json!(schema);
        raw["providerId"] = json!("java-sdk-compiler-diagnostics-v1");
        raw["backend"] = json!("jdk26-javac-compiler-errors-v1");
        raw["items"][0]["code"] = json!("java.javac.compiler.err.cant.resolve.location");
        let check = |raw| {
            normalize(
                raw,
                &request,
                &f.root,
                &"a".repeat(64),
                2,
                &digest(MAIN.as_bytes()),
                "0.7.0",
            )
        };
        assert_eq!(check(raw.clone()).is_ok(), version == 7, "v{version}");
        if version == 7 {
            let mut aggregate = raw.clone();
            aggregate["providerId"] = json!("java-sdk-and-jdt-compiler-diagnostics-v1");
            aggregate["backend"] =
                json!("jdk26-javac-compiler-errors-v1+eclipse-jdt-3.44-bindings-v1");
            assert!(check(aggregate).is_err());
            raw["items"][0]["code"] = json!("java.jdt.typeResolution");
            assert!(check(raw).is_err());
        }
    }
}

#[test]
fn editor_diagnostics_refuse_mixed_provenance_codes_and_unbounded_source_claims() {
    let f = Fixture::new();
    for (pointer, value) in [
        ("/providerId", json!("unknown-compiler")),
        ("/backend", json!(BACKEND)),
        ("/items/0/code", json!("java.jdt.typeResolution")),
        ("/items/0/code", json!("java.javac.compiler.warn.unused")),
        ("/analyzedSourceCount", json!(10001)),
    ] {
        let (mut request, mut raw) = editor_diagnostics_fixture(&f);
        request
            .project_context
            .as_mut()
            .unwrap()
            .context_schema_version = "java-project-context-v2".into();
        raw["contextSchemaVersion"] = json!("java-project-context-v2");
        raw["providerId"] = json!("java-sdk-compiler-diagnostics-v1");
        raw["backend"] = json!("jdk25-javac-compiler-errors-v1");
        raw["items"][0]["code"] = json!("java.javac.compiler.err.cant.resolve.location");
        *raw.pointer_mut(pointer).unwrap() = value;
        assert!(
            normalize(
                raw,
                &request,
                &f.root,
                &"a".repeat(64),
                2,
                &digest(MAIN.as_bytes()),
                "0.7.0"
            )
            .is_err(),
            "{pointer}"
        );
    }
    let (request, mut raw) = editor_diagnostics_fixture(&f);
    raw["providerId"] = json!("java-sdk-compiler-diagnostics-v1");
    raw["backend"] = json!("jdk25-javac-compiler-errors-v1");
    raw["items"][0]["code"] = json!("java.javac.compiler.err.cant.resolve.location");
    assert!(normalize(
        raw,
        &request,
        &f.root,
        &"a".repeat(64),
        2,
        &digest(MAIN.as_bytes()),
        "0.7.0"
    )
    .is_err());
}

#[test]
fn editor_diagnostics_reject_stale_incomplete_or_out_of_inventory_errors() {
    let f = Fixture::new();
    let (request, raw) = editor_diagnostics_fixture(&f);
    for (pointer, value) in [
        ("/requestId", json!("other")),
        ("/snapshotHash", json!("0".repeat(64))),
        ("/contextHash", json!("0".repeat(64))),
        ("/platformIdentities", json!([])),
        ("/coverage", json!("all")),
        ("/complete", json!(false)),
        ("/analyzedSourceCount", json!(2)),
        ("/total", json!(0)),
        ("/items/0/severity", json!("warning")),
        ("/items/0/message", json!("")),
        ("/items/0/location/path", json!("../outside.java")),
        ("/items/0/location/range/start/character", json!(5000)),
        ("/sourceAuthority/documents/1/version", json!(20)),
        (
            "/sourceAuthority/documents/1/contentSha256",
            json!("0".repeat(64)),
        ),
        ("/sourceAuthority/documents", json!([])),
        ("/providerSnapshotHash", json!("invalid")),
    ] {
        let mut changed = raw.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            normalize(
                changed,
                &request,
                &f.root,
                &"a".repeat(64),
                2,
                &digest(MAIN.as_bytes()),
                "0.7.0"
            )
            .is_err(),
            "{pointer}"
        );
    }
    let mut refused = raw;
    refused["status"] = json!("refused");
    refused["error"] = json!({"code":"java.diagnostics.limitExceeded","message":"Complete compiler errors exceed limit"});
    let result = normalize(
        refused,
        &request,
        &f.root,
        &"a".repeat(64),
        2,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(result["status"], "refused");
    assert_eq!(result["refusalCode"], "java.diagnostics.limitExceeded");
    assert!(result.get("items").is_none());
}

#[test]
fn editor_diagnostics_validate_saved_closed_sources_without_fabricating_overlay_documents() {
    let f = Fixture::new();
    let (mut request, mut raw) = editor_diagnostics_fixture(&f);
    request.editor_overlay.as_mut().unwrap().documents.pop();
    raw["sourceAuthority"]["documents"]
        .as_array_mut()
        .unwrap()
        .pop();
    raw["items"][0]["location"] = json!({"path":BASE_PATH,"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":6}}});
    let result = normalize(
        raw,
        &request,
        &f.root,
        &"a".repeat(64),
        2,
        &digest(MAIN.as_bytes()),
        "0.7.0",
    )
    .unwrap();
    assert_eq!(result["analyzedSourceCount"], 3);
    assert_eq!(
        result["editorOverlay"]["documents"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(result["sourceFiles"][0]["path"], BASE_PATH);
    assert_eq!(result["sourceFiles"][0]["text"], BASE);
    assert_eq!(
        result["sourceFiles"][0]["contentSha256"],
        digest(BASE.as_bytes())
    );
}

#[test]
fn position_navigation_and_editor_diagnostics_use_their_respective_document_versions() {
    let f = Fixture::new();
    let (mut request, _) = editor_diagnostics_fixture(&f);
    request.editor_overlay.as_mut().unwrap().documents[0].version = 99;
    // Diagnostics are requested from the captured editor inventory itself.
    assert!(validate_request(&request, &f.root).is_err());
    // A position query can also carry a distinct view/model version. Its text,
    // inventory versions and response correlation still have to match exactly.
    request.kind = "definition".into();
    request.limit = 1;
    assert!(validate_request(&request, &f.root).is_ok());
    request.editor_overlay.as_mut().unwrap().documents[0]
        .text
        .push_str("changed");
    assert!(validate_request(&request, &f.root).is_err());
}
