use super::*;
use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn typed_parameter_removal_refusal_explains_effects_without_provider_text() {
    let mut error = SessionCallError {
        kind: SessionCallErrorKind::Rejected,
        rpc_code: Some(-32001),
        rpc_message: None,
        rpc_refusal_code: Some("java.changeSignature.removedArgumentMayHaveEffects".into()),
    };
    let message = rpc_error_message("refactor.preview", &error);
    assert!(message.contains("Removing this argument could remove a side effect"));
    assert!(message.ends_with("No source changes were made."));
    assert!(!rpc_error_message("patch.rollback", &error)
        .contains(PARAMETER_REMOVAL_EFFECTS_MESSAGE));

    error.rpc_refusal_code = Some("java.changeSignature.otherRefusal".into());
    assert!(!rpc_error_message("refactor.preview", &error)
        .contains(PARAMETER_REMOVAL_EFFECTS_MESSAGE));
}

#[test]
fn only_the_typed_missing_output_refusal_keeps_gradle_available_for_build() {
    let mut error = SessionCallError {
        kind: SessionCallErrorKind::Rejected,
        rpc_code: Some(-32001),
        rpc_message: Some("Compile the affected source sets and synchronize Gradle.".into()),
        rpc_refusal_code: Some("java.moveClass.gradleCompilerOutputsMissing".into()),
    };
    assert!(preserve_gradle_context_after_preview_refusal(RefactoringOperation::MoveClass, &error));
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::MovePackage, &error));

    error.rpc_message = Some("Project inputs changed.".into());
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::MoveClass, &error));
    error.rpc_message = Some("Compile the affected source sets and synchronize Gradle.".into());
    error.rpc_refusal_code = Some("java.moveClass.crossModuleContextUnavailable".into());
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::MoveClass, &error));
    error.rpc_refusal_code = None;
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::MoveClass, &error));
}

#[test]
fn gradle_delegate_dependency_refusal_retains_context_for_a_corrected_group() {
    let mut error = SessionCallError {
        kind: SessionCallErrorKind::Rejected,
        rpc_code: Some(-32001),
        rpc_message: Some("A selected method uses unselected member OFFSET.".into()),
        rpc_refusal_code: Some("java.extractDelegate.dependencyUnsupported".into()),
    };
    assert!(preserve_gradle_context_after_preview_refusal(RefactoringOperation::ExtractDelegate, &error));
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::ExtractMethod, &error));

    error.rpc_message = Some("Project inputs changed.".into());
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::ExtractDelegate, &error));

    error.rpc_message = None;
    error.rpc_code = None;
    assert!(!preserve_gradle_context_after_preview_refusal(RefactoringOperation::ExtractDelegate, &error));
}

struct Fixture {
    root: PathBuf,
    project: PathBuf,
    binding: CurrentWorkspaceBinding,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-java-sdk-refactoring-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = root.join("maven");
        fs::create_dir_all(&project).unwrap();
        let registry = root.join("registry.json");
        crate::commands::workspace_registry::ensure_workspace_at(&root, &registry).unwrap();
        let binding = current_workspace_binding_at(&root, &registry).unwrap();
        Self {
            root,
            project,
            binding,
        }
    }
    fn context(&self) -> ProjectContext {
        serde_json::from_value(json!({"projectPath": "maven", "sdkHome": "/sdk", "mavenRepository": "",
        "activeMavenProfiles": [], "inactiveMavenProfiles": [], "snapshotHash": "a".repeat(64), "contextHash": "b".repeat(64), "contextSchemaVersion": "java-project-context-v1", "platformIdentities": ["c".repeat(64)]})).unwrap()
    }
    fn request(&self, context: &ProjectContext) -> EnginePreviewRequest {
        serde_json::from_value(json!({"operation": "format-file", "target": {"kind": "file", "path": "maven/Example.java", "identity": "maven/Example.java"},
        "authority": {"workspaceId": self.binding.workspace_id, "workspaceGeneration": 1}, "selectionGeneration": 1, "requestId": "sdk-preview", "projectContext": context})).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn sdk_project_context_requires_an_explicit_schema_version() {
    let f = Fixture::new();
    let mut context = serde_json::to_value(f.context()).unwrap();
    context
        .as_object_mut()
        .unwrap()
        .remove("contextSchemaVersion");
    assert!(serde_json::from_value::<ProjectContext>(context).is_err());
}

fn capabilities() -> Value {
    let runtime = json!({"executionMode":"in-process", "supportsTimeout":false,
        "supportsCancellation":false, "usesWorkspaceOverlay":false,
        "recordsProcessProvenance":false,
        "limits":{"requestTimeoutMillis":null,"maxInputBytes":null,"maxOutputBytes":null,"maxProcesses":null}});
    json!({"apiVersion":"0.2", "version":"0.7.0", "javaContextRefactoring": {"schemaVersion":1,
    "operations":["formatFile"], "requiresExplicitContext":true, "sourceAuthority":"saved-snapshot", "rollbackAuthority":false,"renderedDiff":true},
    "languageKernel":{"schemaVersion":1,"adapters":[{"languageId":"java","extensions":["java"],"backend":"java-test-backend",
        "runtime":runtime,"capabilities":[{"operation":"formatFile","stability":"stable","evidence":"structural-parse","mutationAuthority":"managed-stable",
            "backend":"java-test-backend","runtime":runtime,"extensions":["java"]}]}],
        "vocabulary":{"stability":["stable","experimental","structural","refused","not-applicable"],
            "evidence":["compiler","language-server","native-ast","structural-parse","lexical","none"],
            "mutationAuthority":["managed-stable","proposal-only","none"],
            "executionMode":["in-process","external-process"]}},
    "methods":[{"name":"project.context", "features":{"javaRefactoringsUseContextAuthority":true,"managedMutationAuthority":true}},
        {"name":"refactor.preview","requiresProject":true,"writesWorkspace":false},{"name":"refactor.apply","requiresProject":true,"writesWorkspace":true},
        {"name":"patch.rollback","requiresProject":true,"writesWorkspace":true}]})
}

#[test]
fn inline_operations_bind_the_exact_saved_identifier_without_change_intent() {
    let f = Fixture::new();
    let source = "class Example { private static final int ANSWER = 42; static int calculate() { int local = 41; return local + ANSWER; } }";
    fs::write(f.project.join("Example.java"), source).unwrap();
    let context = f.context();

    for (operation, provider_name, target_kind, identifier) in [
        (
            RefactoringOperation::InlineVariable,
            "inlineVariable",
            "local-binding",
            "local",
        ),
        (
            RefactoringOperation::InlineConstant,
            "inlineConstant",
            "member",
            "ANSWER",
        ),
    ] {
        let byte_start = source.rfind(identifier).unwrap();
        let start = source[..byte_start].encode_utf16().count() as u64;
        let end = start + identifier.encode_utf16().count() as u64;
        let mut request = f.request(&context);
        request.operation = operation;
        request.target.kind = target_kind.into();
        request.target.identity = identifier.into();
        request.target.selection =
            Some(serde_json::from_value(json!({"start": start, "end": end})).unwrap());
        request.change_intent = None;

        let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
        assert_eq!(params["operation"], provider_name);
        assert_eq!(params["symbol"], identifier);
        assert_eq!(params["arguments"]["file"], "Example.java");
        assert_eq!(params["arguments"]["name"], identifier);
        assert!(params.get("changeIntent").is_none());

        request.target.identity = "changedIdentifier".into();
        assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
    }
}

#[test]
fn inline_method_preview_binds_the_saved_method_selection_without_intent() {
    let f = Fixture::new();
    let source = "class Example { private static int twice() { return 2; } static int value() { return twice(); } }";
    fs::write(f.project.join("Example.java"), source).unwrap();
    let context = f.context();
    let offset = source.find("twice").unwrap() as u64;
    let mut request = f.request(&context);
    request.operation = RefactoringOperation::InlineMethod;
    request.target.kind = "member".into();
    request.target.identity = "@cursor".into();
    request.target.selection =
        Some(serde_json::from_value(json!({"start": offset, "end": offset})).unwrap());
    request.change_intent = None;
    let selection =
        json!({"symbolKind":"method", "symbolId":"Example#twice()I", "path":"Example.java"});

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "inlineMethod");
    assert_eq!(params["symbol"], "Example#twice()I");
    assert_eq!(params["arguments"]["file"], "Example.java");
    assert_eq!(params["javaSelection"], selection);
    assert!(params.get("changeIntent").is_none());
}

#[test]
fn parameter_object_preview_requires_a_saved_method_and_preserves_parameter_order() {
    let f = Fixture::new();
    let source = "class Example { private static int value(int width, int height) { return width * height; } }";
    fs::write(f.project.join("Example.java"), source).unwrap();
    let mut request = f.request(&f.context());
    let position = source.find("value").unwrap() as u64;
    request.operation = RefactoringOperation::IntroduceParameterObject;
    request.target.kind = "member".into();
    request.target.identity = "@cursor".into();
    request.target.selection =
        Some(serde_json::from_value(json!({"start": position, "end": position})).unwrap());
    request.change_intent = Some(serde_json::from_value(json!({
        "operation":"introduce-parameter-object",
        "typeName":"Dimensions",
        "parameters":["width","height"]
    })).unwrap());
    let selection =
        json!({"symbolKind":"method", "symbolId":"Example#value(II)I", "path":"Example.java"});
    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "introduceParameterObject");
    assert_eq!(params["symbol"], "Example#value(II)I");
    assert_eq!(params["arguments"], json!({"typeName":"Dimensions","parameters":["width","height"]}));
    assert_eq!(params["javaSelection"], selection);

    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
    let constructor = json!({"symbolKind":"constructor", "symbolId":"Example#Example(II)V", "path":"Example.java"});
    assert!(preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&constructor)).is_err());
    request.change_intent.as_mut().unwrap().parameters = Some(["width".into(), "width".into()]);
    assert!(preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).is_err());
}

#[test]
fn extract_delegate_binds_the_saved_method_and_the_exact_member_group() {
    let f = Fixture::new();
    let source = "class Example { private static int helper(int n) { return n + 1; } private static int compute(int n) { return helper(n); } }";
    fs::write(f.project.join("Example.java"), source).unwrap();
    let mut request = f.request(&f.context());
    let position = source.find("compute").unwrap() as u64;
    request.operation = RefactoringOperation::ExtractDelegate;
    request.target.kind = "member".into();
    request.target.identity = "@cursor".into();
    request.target.selection =
        Some(serde_json::from_value(json!({"start": position, "end": position})).unwrap());
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "extract-delegate",
            "typeName": "Calculation",
            "members": ["helper", "compute"]
        }))
        .unwrap(),
    );
    let selection =
        json!({"symbolKind": "method", "symbolId": "Example#compute(I)I", "path": "Example.java"});
    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "extractDelegate");
    assert_eq!(params["symbol"], "Example#compute(I)I");
    assert_eq!(
        params["arguments"],
        json!({"typeName": "Calculation", "members": ["helper", "compute"]})
    );
    assert_eq!(params["javaSelection"], selection);
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
    request.change_intent.as_mut().unwrap().members = Some(vec!["helper".into(), "helper".into()]);
    assert!(preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
        .is_err());
}

#[test]
fn stale_project_open_refusal_is_reported_as_a_resynchronization_request() {
    assert_eq!(
        rpc_rejection_message("project.open", None, Some("Project inputs changed.")),
        "Project inputs changed; synchronize and preview again."
    );
    assert_eq!(
        rpc_rejection_message("project.open", None, Some("snapshot is stale")),
        "Project inputs changed; synchronize and preview again."
    );
    assert_eq!(
        rpc_rejection_message("project.open", None, Some("unsupported build descriptor")),
        "RefactorKit refused this Java operation. Synchronize and review a new plan."
    );
    assert_eq!(
        rpc_rejection_message(
            "refactor.preview",
            Some(-32009),
            Some("Project inputs changed.")
        ),
        "Project inputs changed; synchronize and preview again."
    );
    assert_eq!(
        rpc_rejection_message("refactor.preview", None, None),
        "RefactorKit refused this Java operation. No source changes were made."
    );
}

#[test]
fn provider_refactor_preview_reason_is_preserved_for_the_user() {
    let reason =
        "Staged cross-module declaration or observer closure does not retain exact JDT bindings";
    assert_eq!(
        rpc_rejection_message("refactor.preview", None, Some(reason)),
        format!("RefactorKit refused this Java operation. {reason}. No source changes were made.")
    );
}

#[test]
fn gradle_module_preview_uses_build_root_and_nested_project_path_without_a_symbol() {
    let f = Fixture::new();
    fs::write(
        f.project.join("settings.gradle"),
        "rootProject.name = 'sample'\n",
    )
    .unwrap();
    let mut context = f.context();
    context.gradle = Some(
        serde_json::from_value(json!({
            "executable": "/opt/gradle/bin/gradle",
            "userHome": "",
            "projectProperties": {}
        }))
        .unwrap(),
    );
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "create-gradle-module",
        "target": {
            "kind": "file",
            "path": "maven/settings.gradle",
            "identity": "maven/settings.gradle"
        },
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 1,
        "requestId": "gradle-create-module",
        "changeIntent": {
            "operation": "create-gradle-module",
            "buildRoot": "maven",
            "projectPath": ":services:catalog"
        },
        "projectContext": context
    }))
    .unwrap();

    let params =
        preview_params_with_workspace_root(&request, &f.project, &f.root, Path::new("/sdk"), None)
            .unwrap();
    assert_eq!(params["operation"], "createGradleModule");
    assert_eq!(params["languageId"], "java");
    assert_eq!(params["arguments"]["buildRoot"], ".");
    assert_eq!(params["arguments"]["projectPath"], ":services:catalog");
    assert_eq!(params["javaContext"]["expectedContextHash"], "b".repeat(64));
    assert!(params.get("symbol").is_none());

    fs::create_dir_all(f.project.join("included")).unwrap();
    fs::write(
        f.project.join("included/settings.gradle.kts"),
        "rootProject.name = \"included\"\n",
    )
    .unwrap();
    request.target.path = "maven/included/settings.gradle.kts".into();
    request.target.identity = request.target.path.clone();
    request.change_intent.as_mut().unwrap().build_root = Some("maven/included".into());
    let nested_params =
        preview_params_with_workspace_root(&request, &f.project, &f.root, Path::new("/sdk"), None)
            .unwrap();
    assert_eq!(nested_params["arguments"]["buildRoot"], "included");

    let mut invalid = request;
    invalid.target.path = "maven/custom.gradle".into();
    invalid.target.identity = invalid.target.path.clone();
    assert!(preview_params_with_workspace_root(
        &invalid,
        &f.project,
        &f.root,
        Path::new("/sdk"),
        None,
    )
    .is_err());
}

#[test]
fn gradle_module_is_offered_only_with_the_complete_stable_provider_contract() {
    let mut caps = capabilities();
    caps["methods"].as_array_mut().unwrap().push(json!({
        "name": "java.createGradleModule",
        "stability": "stable",
        "requiresProject": true,
        "writesWorkspace": false,
        "features": {
            "preview": true,
            "renderedDiff": true,
            "apply": true,
            "rollback": true,
            "workspaceRelativeBuildRoot": true,
            "canonicalNestedProjectPath": true,
            "settingsInferredDsl": true
        }
    }));
    assert!(offered(&caps, "java.createGradleModule", "preview"));
    assert!(offered(&caps, "java.createGradleModule", "apply"));
    assert!(offered(&caps, "java.createGradleModule", "rollback"));

    caps["methods"].as_array_mut().unwrap().last_mut().unwrap()["features"]
        ["settingsInferredDsl"] = json!(false);
    assert!(!offered(&caps, "java.createGradleModule", "preview"));
    assert!(!offered(&caps, "java.createGradleModule", "apply"));
}

#[test]
fn formatter_profile_preview_payload_is_workspace_scoped_and_apply_detects_changed_xml() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example {}\n").unwrap();
    let formatter_path = f.root.join("config/team.xml");
    fs::create_dir_all(formatter_path.parent().unwrap()).unwrap();
    let xml = r#"<?xml version="1.0"?><profiles><profile name="Team"/></profiles>"#;
    fs::write(&formatter_path, xml).unwrap();
    let context = f.context();
    let mut request = f.request(&context);
    request.formatter_profile = Some(
        serde_json::from_value(json!({"path":"config/team.xml","profileName":"Team"})).unwrap(),
    );

    let params =
        preview_params_with_workspace_root(&request, &f.project, &f.root, Path::new("/sdk"), None)
            .unwrap();
    assert_eq!(params["formatterProfile"]["path"], "config/team.xml");
    assert_eq!(params["formatterProfile"]["profileName"], "Team");
    assert_eq!(params["formatterProfile"]["xml"], xml);
    let (_, _, _, approved_hash) = crate::commands::java_language::formatter_profile_payload(
        &f.root,
        request.formatter_profile.as_ref().unwrap(),
    )
    .unwrap();

    fs::write(
        &formatter_path,
        xml.replace(
            "<profile name=\"Team\"/>",
            "<profile name=\"Team\"><setting value=\"changed\"/></profile>",
        ),
    )
    .unwrap();
    let apply: EngineApplyRequest = serde_json::from_value(json!({
        "projectContext": context,
        "formatterProfile": {"path":"config/team.xml","profileName":"Team"},
        "formatterProfileSha256": approved_hash,
        "planId": "formatter-plan",
        "operation": "format-file",
        "target": {"kind":"file","path":"maven/Example.java","identity":"maven/Example.java"},
        "authority": {"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration": 1,
        "requestId": "formatter-apply",
        "approval": {"approvalId":"formatter-approval","approvedPlanId":"formatter-plan","approvedAt":"2026-10-24T00:00:00Z"}
    }))
    .unwrap();
    assert!(
        validate_formatter_profile_approval(&f.root, &apply, Some(&approved_hash))
            .unwrap_err()
            .contains("changed after preview")
    );
}

#[test]
fn provider_refactor_preview_json_rpc_code_is_preserved_for_diagnostics() {
    assert_eq!(
        rpc_rejection_message("refactor.preview", Some(-32013), Some("Unsupported target")),
        "RefactorKit refused this Java operation (JSON-RPC error -32013). Unsupported target. No source changes were made."
    );
    assert_eq!(
        rpc_rejection_message("refactor.preview", Some(-32013), None),
        "RefactorKit refused this Java operation (JSON-RPC error -32013). No source changes were made."
    );
}

fn plan(context: &ProjectContext) -> Value {
    json!({"planId":"sdk-plan", "operation":"formatFile", "status":"PREVIEW", "summary":"Format saved Java source", "confidence":1.0,
    "riskLevel":"LOW", "evidence":"STRUCTURAL_PARSE", "affectedFiles":["Example.java"], "structuredDiff":[{"type":"modifyFile","path":"Example.java"}],
    "renderedDiff":"--- a/Example.java\n+++ b/Example.java\n@@ -1 +1 @@\n-class Example{}\n+class Example {}\n", "diffTruncated":false, "diffTruncationReasons":[], "warnings":[], "diagnosticsAfterPreview":[],
    "snapshot":{"hash":context.snapshot_hash,"validatedOnApply":true},"provider":{"name":"refactorkit-java","version":"0.7.0"},
    "contextHash":context.context_hash, "contextSchemaVersion":context.context_schema_version, "platformIdentities":context.platform_identities})
}

#[test]
fn sdk_admission_requires_explicit_operation_metadata_and_context_flags() {
    let good = capabilities();
    assert!(offered(&good, "formatFile", "preview"));
    assert!(offered(&good, "formatFile", "apply"));
    assert!(!offered(&good, "renameClass", "preview"));
    assert!(!offered(&good, "formatFile", "rollback"));
    let mut rollback = good.clone();
    rollback["javaContextRefactoring"]["rollbackAuthority"] = json!(true);
    rollback["methods"]
        .as_array_mut()
        .unwrap()
        .push(json!({"name":"patch.rollback","requiresProject":true,"writesWorkspace":true}));
    assert!(offered(&rollback, "formatFile", "rollback"));
    let mut bad = good.clone();
    bad.as_object_mut()
        .unwrap()
        .remove("javaContextRefactoring");
    assert!(!offered(&bad, "formatFile", "apply"));
    let mut bad = good.clone();
    bad["methods"][0]["features"]["managedMutationAuthority"] = json!(false);
    assert!(!offered(&bad, "formatFile", "apply"));
    let mut bad = good;
    bad["methods"][2]["writesWorkspace"] = json!(false);
    assert!(!offered(&bad, "formatFile", "apply"));
}

#[test]
fn add_parameter_discovery_retains_only_an_explicit_instance_reference_flag() {
    let operation = json!({
        "operation": "changeSignature.addParameter",
        "features": {"thisMethodReferenceMigration": true, "other": true}
    });
    let normalize = super::super::capability_policy::normalize_operation_capabilities;
    assert_eq!(
        normalize(Some(&json!({"operationCapabilities": [operation]}))),
        Some(json!([{
            "operation": "changeSignature.addParameter",
            "features": {"thisMethodReferenceMigration": true}
        }]))
    );
    assert_eq!(
        normalize(Some(&json!({"operationCapabilities": [operation, operation]}))),
        None
    );
    assert_eq!(
        normalize(Some(&json!({"operationCapabilities": [{
            "operation": "changeSignature.addParameter",
            "features": {"thisMethodReferenceMigration": "true"}
        }]}))),
        None
    );
}

#[test]
fn safe_delete_apply_requires_complete_project_reference_analysis_at_native_boundary() {
    let mut safe_delete = capabilities();
    safe_delete["javaContextRefactoring"]["operations"] = json!(["safeDelete"]);
    safe_delete["languageKernel"]["adapters"][0]["capabilities"] = json!([{
        "operation":"safeDelete",
        "stability":"stable",
        "evidence":"compiler",
        "mutationAuthority":"managed-stable",
        "backend":"java-test-backend",
        "runtime":safe_delete["languageKernel"]["adapters"][0]["capabilities"][0]["runtime"].clone(),
        "extensions":["java"]
    }]);
    safe_delete["javaContextRefactoring"]["operationCapabilities"] = json!([{
        "operation":"safeDelete",
        "referenceAnalysis":{
            "schemaVersion":"java-safe-delete-reference-analysis-v1",
            "scope":"workspace-text-v1",
            "resultField":"referenceAnalysis",
            "statusValues":["complete","incomplete"],
            "managedApplyAuthority":"none",
            "completeProject":false
        }
    }]);

    assert!(offered(&safe_delete, "safeDelete", "preview"));
    assert!(!offered(&safe_delete, "safeDelete", "apply"));
    assert!(super::super::capability_policy::safe_delete_reference_analysis_offered(&safe_delete));
    let normalized = super::super::capability_policy::normalize_operation_capabilities(
        safe_delete.get("javaContextRefactoring"),
    )
    .unwrap();
    assert_eq!(normalized[0]["operation"], "safeDelete");
    assert_eq!(normalized[0]["referenceAnalysis"]["completeProject"], false);
    let normalized_context = super::super::capability_policy::normalize_java_context_refactoring(
        safe_delete.get("javaContextRefactoring"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        normalized_context["operationCapabilities"][0]["referenceAnalysis"]
            ["managedApplyAuthority"],
        "none"
    );
    assert!(validate_safe_delete_reference_analysis_advertisement(
        &json!({}),
        &safe_delete,
        "safeDelete"
    )
    .is_err());
    assert!(validate_safe_delete_reference_analysis_advertisement(
        &json!({}),
        &capabilities(),
        "safeDelete"
    )
    .is_ok());

    let mut review = json!({"applyEligibility":{"eligible":true,"blockers":[]}});
    enforce_apply_advertisement(&mut review, &safe_delete, "safeDelete");
    assert_eq!(review["applyEligibility"]["eligible"], false);
    assert!(review["applyEligibility"]["blockers"][0]
        .as_str()
        .unwrap()
        .contains("complete-project reference analysis"));

    safe_delete["safeDeleteReferenceAnalysis"] = json!("java-sources-only");
    assert!(!offered(&safe_delete, "safeDelete", "apply"));
    safe_delete["safeDeleteReferenceAnalysis"] = json!("complete-project");
    assert!(offered(&safe_delete, "safeDelete", "apply"));
    safe_delete["javaContextRefactoring"]["operationCapabilities"][0]["referenceAnalysis"]
        ["managedApplyAuthority"] = json!("managed-stable");
    assert!(!super::super::capability_policy::safe_delete_reference_analysis_offered(&safe_delete));
}

#[test]
fn safe_delete_text_scan_evidence_is_snapshot_bound_and_never_project_complete() {
    let f = Fixture::new();
    let context = f.context();
    let mut request = f.request(&context);
    request.operation = RefactoringOperation::SafeDelete;
    let mut raw = json!({
        "referenceAnalysis":{
            "schemaVersion":"java-safe-delete-reference-analysis-v1",
            "operation":"safeDelete",
            "scope":"workspace-text-v1",
            "status":"complete",
            "inputCount":12,
            "verifiedBytes":4096,
            "snapshotHash":context.snapshot_hash,
            "managedApplyAuthority":"none",
            "completeProject":false,
            "referenceClosure":"incomplete"
        }
    });
    let normalized = normalize_safe_delete_reference_analysis(&raw, &request)
        .unwrap()
        .unwrap();
    assert_eq!(normalized["status"], "complete");
    assert_eq!(normalized["inputCount"], 12);
    assert_eq!(normalized["completeProject"], false);
    assert_eq!(normalized["managedApplyAuthority"], "none");
    assert_eq!(normalized["referenceClosure"], "incomplete");

    raw["referenceAnalysis"]["status"] = json!("incomplete");
    raw["referenceAnalysis"]["inputCount"] = Value::Null;
    raw["referenceAnalysis"]["verifiedBytes"] = Value::Null;
    assert!(normalize_safe_delete_reference_analysis(&raw, &request).is_ok());

    raw["referenceAnalysis"]["snapshotHash"] = json!("d".repeat(64));
    assert!(normalize_safe_delete_reference_analysis(&raw, &request).is_err());
    raw["referenceAnalysis"]["snapshotHash"] = json!(context.snapshot_hash);
    raw["referenceAnalysis"]["completeProject"] = json!(true);
    assert!(normalize_safe_delete_reference_analysis(&raw, &request).is_err());

    request.operation = RefactoringOperation::FormatFile;
    assert!(normalize_safe_delete_reference_analysis(&raw, &request).is_err());
}

#[test]
fn incomplete_typed_jpql_references_are_preserved_but_disable_managed_apply() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("src/main/java/com/example")).unwrap();
    fs::write(
        f.project.join("src/main/java/com/example/User.java"),
        "package com.example; class User {}\n",
    )
    .unwrap();
    fs::write(
        f.project
            .join("src/main/java/com/example/UserRepository.java"),
        "package com.example; interface UserRepository {}\n",
    )
    .unwrap();
    let context = f.context();
    let mut request = f.request(&context);
    request.operation = RefactoringOperation::RenameMember;
    request.target.kind = "member".into();
    request.target.path = "maven/src/main/java/com/example/User.java".into();
    request.target.identity = "com.example.User#amount".into();
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation":"rename-member", "newName":"total"
        }))
        .unwrap(),
    );

    let mut raw = plan(&context);
    raw["operation"] = json!("renameMember");
    raw["evidence"] = json!("COMPILER");
    raw["riskLevel"] = json!("HIGH");
    raw["affectedFiles"] = json!([
        "src/main/java/com/example/User.java",
        "src/main/java/com/example/UserRepository.java"
    ]);
    raw["structuredDiff"] = json!([
        {"type":"modifyFile", "path":"src/main/java/com/example/User.java"},
        {"type":"modifyFile", "path":"src/main/java/com/example/UserRepository.java"}
    ]);
    raw["renderedDiff"] = json!(
        "--- a/User.java\n+++ b/User.java\n--- a/UserRepository.java\n+++ b/UserRepository.java\n"
    );
    raw["managedWriteEligibility"] = json!("INELIGIBLE");
    raw["referenceAnalysis"] = json!({
        "schemaVersion":"refactorkit-reference-analysis-v1",
        "scope":"java-spring-data-jpql-static-property-path-v1",
        "completeness":"INCOMPLETE",
        "completeProject":false,
        "managedWriteAuthority":"none",
        "warnings":["Only direct static Spring Data @Query JPQL property paths are inspected."],
        "references":[
            {
                "languageId":"java",
                "kind":"framework.entity-property",
                "targetOwner":"com.example.User",
                "targetMember":"amount",
                "resourceKind":"java.annotation-string",
                "provenance":"spring-data.query-jpql",
                "completeness":"COMPLETE",
                "location":{"path":"src/main/java/com/example/UserRepository.java","range":{
                    "start":{"line":2,"character":74},"end":{"line":2,"character":80}
                }}
            }
        ]
    });
    raw["snapshot"]["hash"] = json!(context.snapshot_hash);
    raw["contextHash"] = json!(context.context_hash);
    raw["contextSchemaVersion"] = json!(context.context_schema_version);
    raw["platformIdentities"] = json!(context.platform_identities);

    let normalized = normalize_preview(&raw, &request, &f.project, &f.root).unwrap();
    assert_eq!(
        normalized["referenceAnalysis"]["completeness"],
        "INCOMPLETE"
    );
    assert_eq!(
        normalized["referenceAnalysis"]["references"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        normalized["referenceAnalysis"]["references"][0]["location"]["path"],
        "maven/src/main/java/com/example/UserRepository.java"
    );
    assert_eq!(normalized["riskLevel"], "high");
    assert_eq!(normalized["applyEligibility"]["eligible"], false);
    assert!(normalized["applyEligibility"]["blockers"][0]
        .as_str()
        .unwrap()
        .contains("incomplete typed reference analysis"));
}

#[test]
fn sdk_safe_delete_preview_preserves_text_scan_evidence_and_remains_read_only() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example {}\n").unwrap();
    let context = f.context();
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation":"safe-delete",
        "target":{"kind":"class","path":"maven/Example.java","identity":"example.Example"},
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":1,"requestId":"safe-delete-preview",
        "projectContext":context
    }))
    .unwrap();
    let mut raw = plan(request.project_context.as_ref().unwrap());
    raw["operation"] = json!("safeDelete");
    raw["referenceAnalysis"] = json!({
        "schemaVersion":"java-safe-delete-reference-analysis-v1",
        "operation":"safeDelete",
        "scope":"workspace-text-v1",
        "status":"complete",
        "inputCount":12,
        "verifiedBytes":4096,
        "snapshotHash":context.snapshot_hash,
        "managedApplyAuthority":"none",
        "completeProject":false,
        "referenceClosure":"incomplete"
    });
    let mut normalized = normalize_preview(&raw, &request, &f.project, &f.root).unwrap();
    assert_eq!(normalized["referenceAnalysis"]["inputCount"], 12);
    assert_eq!(normalized["referenceAnalysis"]["completeProject"], false);
    let mut safe_delete_capabilities = capabilities();
    safe_delete_capabilities["javaContextRefactoring"]["operations"] = json!(["safeDelete"]);
    enforce_apply_advertisement(&mut normalized, &safe_delete_capabilities, "safeDelete");
    assert_eq!(normalized["applyEligibility"]["eligible"], false);
    assert!(normalized["applyEligibility"]["blockers"][0]
        .as_str()
        .unwrap()
        .contains("complete-project reference analysis"));

    request.operation = RefactoringOperation::FormatFile;
    assert!(normalize_safe_delete_reference_analysis(&raw, &request).is_err());
}

#[test]
fn stable_maven_module_creation_uses_project_operation_capability_and_exact_parent_pom() {
    let mut advertised = capabilities();
    advertised["methods"].as_array_mut().unwrap().extend([
        json!({"name":"patch.rollback","requiresProject":true,"writesWorkspace":true}),
        json!({"name":"java.createMavenModule","stability":"stable","requiresProject":true,
            "writesWorkspace":false,"features":{"preview":true,"renderedDiff":true,"apply":true,"rollback":true}}),
    ]);
    assert!(offered(&advertised, "java.createMavenModule", "preview"));
    assert!(offered(&advertised, "java.createMavenModule", "apply"));
    assert!(offered(&advertised, "java.createMavenModule", "rollback"));

    let f = Fixture::new();
    fs::write(f.project.join("pom.xml"), "<project/>\n").unwrap();
    let context = f.context();
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation":"create-maven-module",
        "target":{"kind":"file","path":"maven/pom.xml","identity":"maven/pom.xml"},
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":1,"requestId":"add-module-preview",
        "projectContext":context,
        "changeIntent":{"operation":"create-maven-module","moduleName":"catalog-domain"}
    }))
    .unwrap();
    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "createMavenModule");
    assert_eq!(params["arguments"]["moduleName"], "catalog-domain");
    assert_eq!(params["arguments"]["parentPom"], "pom.xml");

    request.project_context.as_mut().unwrap().gradle = Some(
        serde_json::from_value(
            json!({"executable":"/gradle","userHome":"","projectProperties":{}}),
        )
        .unwrap(),
    );
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());

    let mut stale = advertised;
    stale["methods"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|method| method["name"] == "java.createMavenModule")
        .unwrap()["stability"] = json!("experimental");
    assert!(!offered(&stale, "java.createMavenModule", "preview"));
}

#[test]
fn saved_mutation_selection_requires_its_exact_read_only_capability() {
    let mut advertised = capabilities();
    advertised["javaContextRefactoring"]["selectionQueryKind"] = json!("mutationSelection");
    advertised["javaContextRefactoring"]["selectionSchemaVersion"] =
        json!("java-mutation-selection-v1");
    advertised["methods"].as_array_mut().unwrap().push(json!({
        "name": "intelligence.query",
        "requiresProject": true,
        "writesWorkspace": false
    }));
    assert!(selection_query_offered(&advertised));

    let mut writable_query = advertised.clone();
    writable_query["methods"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|method| method["name"] == "intelligence.query")
        .unwrap()["writesWorkspace"] = json!(true);
    assert!(!selection_query_offered(&writable_query));

    let mut duplicate_query = advertised.clone();
    duplicate_query["methods"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "name": "intelligence.query",
            "requiresProject": true,
            "writesWorkspace": false
        }));
    assert!(!selection_query_offered(&duplicate_query));

    let mut unknown_schema = advertised;
    unknown_schema["javaContextRefactoring"]["selectionSchemaVersion"] =
        json!("future-selection-v2");
    assert!(!selection_query_offered(&unknown_schema));
}

#[test]
fn saved_cursor_offsets_map_crlf_and_utf16_positions() {
    let source = "class A { String emoji = \"😀\"; }\r\nvoid run() {}";
    let next_line = source.find("void").unwrap();
    let next_line_offset = source[..next_line].encode_utf16().count();
    assert_eq!(
        utf16_position(source, (next_line_offset + 1) as u64).unwrap(),
        (1, 1)
    );
    let emoji_start = source.find("😀").unwrap();
    let emoji_offset = source[..emoji_start].encode_utf16().count() + 1;
    assert_eq!(
        utf16_position(source, emoji_offset as u64).unwrap_err(),
        "Selection boundary splits a UTF-16 surrogate pair."
    );
}

#[test]
fn extract_method_selection_requires_complete_non_empty_lines() {
    let source = "class A {\r\n  void run() {\r\n    int total = 1;\r\n  }\r\n}";
    let line_start = source.find("    int total").unwrap();
    let line_text = "int total = 1;";
    let start = source[..line_start + 4].encode_utf16().count() as u64;
    let end = start + line_text.encode_utf16().count() as u64;

    assert_eq!(
        complete_line_range_selection(source, start, end).unwrap(),
        (3, 3)
    );
    assert!(complete_line_range_selection(source, start + 1, end).is_err());
    assert!(complete_line_range_selection(source, start, end - 1).is_err());
    assert!(complete_line_range_selection(source, start, end + 1).is_err());
    assert!(complete_line_range_selection(source, start, start).is_err());
}

#[test]
fn extract_method_selection_maps_multiple_complete_saved_statement_lines() {
    let f = Fixture::new();
    let source = "class A {\n  int value() {\n    int base = 6;\n    int doubled = base * 7;\n    return doubled;\n  }\n}\n";
    let source_path = f.project.join("src/main/java/Example.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    fs::write(&source_path, source).unwrap();
    let selected = "int doubled = base * 7;\n    return doubled;";
    let start = source.find(selected).unwrap();
    let end = start + selected.len();
    let start_utf16 = source[..start].encode_utf16().count() as u64;
    let end_utf16 = source[..end].encode_utf16().count() as u64;
    let context = f.context();
    let request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "extract-method",
        "target": {
            "kind": "file",
            "path": "maven/src/main/java/Example.java",
            "identity": "maven/src/main/java/Example.java",
            "selection": {"start": start_utf16, "end": end_utf16}
        },
        "changeIntent": {"operation": "extract-method", "methodName": "calculateTotal"},
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "extract-method-multiple-lines-preview",
        "projectContext": context
    }))
    .unwrap();

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "extractMethod");
    assert_eq!(params["arguments"]["file"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["startLine"], 4);
    assert_eq!(params["arguments"]["endLine"], 5);
    assert_eq!(params["arguments"]["methodName"], "calculateTotal");

    let first_line_start = source.find("int doubled").unwrap();
    let first_line_start_utf16 = source[..first_line_start].encode_utf16().count() as u64;
    let mut partial_selection = request;
    partial_selection.target.selection.as_mut().unwrap().start = first_line_start_utf16 + 1;
    assert!(preview_params(&partial_selection, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn extract_method_intent_rejects_missing_unbounded_or_nul_names() {
    for method_name in [
        String::new(),
        "   ".into(),
        "x".repeat(257),
        "bad\0name".into(),
    ] {
        let intent: crate::commands::refactorkit_daemon::contract::RefactorKitChangeIntent =
            serde_json::from_value(json!({
                "operation": "extract-method",
                "methodName": method_name
            }))
            .unwrap();
        assert!(intent
            .validate(RefactoringOperation::ExtractMethod)
            .is_err());
    }
}

#[test]
fn extract_interface_intent_requires_bounded_class_and_method_names() {
    for (interface_name, method_name) in [
        (String::new(), "calculate".to_string()),
        ("Calculations".to_string(), " ".to_string()),
        ("I".repeat(257), "calculate".to_string()),
        ("Calculations".to_string(), "bad\0name".to_string()),
    ] {
        let intent: crate::commands::refactorkit_daemon::contract::RefactorKitChangeIntent =
            serde_json::from_value(json!({
                "operation": "extract-interface",
                "interfaceName": interface_name,
                "methodName": method_name
            }))
            .unwrap();
        assert!(intent
            .validate(RefactoringOperation::ExtractInterface)
            .is_err());
    }
}

#[test]
fn proposal_only_java_operations_keep_preview_but_cannot_apply_or_rollback() {
    let mut capabilities = capabilities();
    capabilities["javaContextRefactoring"]["operations"] =
        json!(["changeSignature.renameParameter"]);
    capabilities["javaContextRefactoring"]["rollbackAuthority"] = json!(true);
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["operation"] =
        json!("changeSignature.renameParameter");
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["stability"] =
        json!("experimental");
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["evidence"] =
        json!("compiler");
    capabilities["languageKernel"]["adapters"][0]["capabilities"][0]["mutationAuthority"] =
        json!("proposal-only");
    capabilities["methods"]
        .as_array_mut()
        .unwrap()
        .push(json!({"name":"patch.rollback","requiresProject":true,"writesWorkspace":true}));

    assert!(offered(
        &capabilities,
        "changeSignature.renameParameter",
        "preview"
    ));
    assert!(!offered(
        &capabilities,
        "changeSignature.renameParameter",
        "apply"
    ));
    assert!(!offered(
        &capabilities,
        "changeSignature.renameParameter",
        "rollback"
    ));

    let mut review = json!({"applyEligibility":{"eligible":true,"blockers":[]}});
    enforce_apply_advertisement(
        &mut review,
        &capabilities,
        "changeSignature.renameParameter",
    );
    assert_eq!(review["applyEligibility"]["eligible"], false);
    assert!(review["applyEligibility"]["blockers"][0]
        .as_str()
        .unwrap()
        .contains("stable managed Apply authority"));
}
#[test]
fn sdk_plan_requires_attested_saved_context_and_provider_text_diff() {
    let f = Fixture::new();
    let context = f.context();
    let request = f.request(&context);
    let good = plan(&context);
    let normalized = normalize_preview(&good, &request, &f.project, &f.root).unwrap();
    assert_eq!(normalized["affectedFiles"][0]["path"], "maven/Example.java");
    assert_eq!(normalized["renderedDiff"], good["renderedDiff"]);
    let mut v2_context = context.clone();
    v2_context.context_schema_version = "java-project-context-v2".into();
    let v2_request = f.request(&v2_context);
    let v2_plan = plan(&v2_context);
    let v2_normalized = normalize_preview(&v2_plan, &v2_request, &f.project, &f.root).unwrap();
    assert_eq!(
        v2_normalized["projectContext"]["contextSchemaVersion"],
        "java-project-context-v2"
    );
    let mut v3_context = context.clone();
    v3_context.context_schema_version = "java-project-context-v3".into();
    let v3_request = f.request(&v3_context);
    let v3_plan = plan(&v3_context);
    let v3_normalized = normalize_preview(&v3_plan, &v3_request, &f.project, &f.root).unwrap();
    assert_eq!(
        v3_normalized["projectContext"]["contextSchemaVersion"],
        "java-project-context-v3"
    );
    for field in [
        "renderedDiff",
        "contextHash",
        "platformIdentities",
        "snapshot",
    ] {
        let mut bad = good.clone();
        bad.as_object_mut().unwrap().remove(field);
        assert!(
            normalize_preview(&bad, &request, &f.project, &f.root).is_err(),
            "{field}"
        );
    }
    let mut bad = good.clone();
    bad["operation"] = json!("safeDelete");
    assert!(normalize_preview(&bad, &request, &f.project, &f.root).is_err());
    let mut bad = good;
    bad["structuredDiff"][0]["path"] = json!("../outside.java");
    assert!(normalize_preview(&bad, &request, &f.project, &f.root).is_err());
}
fn batch_request(f: &Fixture) -> EnginePreviewRequest {
    for name in ["Example", "Other"] {
        fs::write(f.project.join(format!("{name}.java")), format!("class {name}{{}}\n")).unwrap();
    }
    let mut request = f.request(&f.context());
    request.operation = RefactoringOperation::BatchCleanup;
    request.change_intent = Some(serde_json::from_value(json!({"operation":"batch-cleanup","actions":[
        {"operation":"format-file","path":"maven/Example.java"},
        {"operation":"organize-imports","path":"maven/Other.java"}
    ]})).unwrap());
    request
}

#[test]
fn batch_cleanup_maps_only_distinct_saved_java_files_inside_the_selected_project() {
    let f = Fixture::new();
    let mut request = batch_request(&f);
    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "batchCleanup");
    assert_eq!(params["arguments"]["actions"], json!([
        {"operation":"formatFile","arguments":{"file":"Example.java"}},
        {"operation":"organizeImports","arguments":{"file":"Other.java"}}
    ]));
    assert!(params.get("symbol").is_none());
    for path in ["outside/Other.java", "maven/Example.java", "maven/../Other.java", "maven/Missing.java"] {
        request.change_intent.as_mut().unwrap().actions.as_mut().unwrap()[1].path = path.into();
        assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err(), "{path}");
    }
}

#[test]
fn batch_cleanup_binds_an_advertised_formatter_profile_to_its_plan() {
    let f = Fixture::new();
    let mut request = batch_request(&f);
    let profile = json!({"path":"team.xml","profileName":"Team"});
    let xml = r#"<profiles><profile name="Team"/></profiles>"#;
    fs::write(f.root.join("team.xml"), xml).unwrap();
    request.formatter_profile = Some(serde_json::from_value(profile.clone()).unwrap());

    let operation = RefactoringOperation::BatchCleanup;
    let row = json!({"operation":"batchCleanup","features":{"formatterProfile":true}});
    let advertised = json!({"javaContextRefactoring":{"operationCapabilities":[row.clone()]}});
    assert!(authorize_batch_formatter_profile(&advertised, operation, true).is_ok());
    assert!(authorize_batch_formatter_profile(&json!({}), operation, true).is_err());
    let ambiguous = json!({"javaContextRefactoring":{"operationCapabilities":[row.clone(), row]}});
    assert!(authorize_batch_formatter_profile(&ambiguous, operation, true).is_err());
    assert!(authorize_batch_formatter_profile(&json!({}), operation, false).is_ok());

    let params =
        preview_params_with_workspace_root(&request, &f.project, &f.root, Path::new("/sdk"), None)
            .unwrap();
    assert_eq!(
        params["formatterProfile"],
        json!({"path":"team.xml","profileName":"Team","xml":xml})
    );
    let (_, _, _, approved_hash) = crate::commands::java_language::formatter_profile_payload(
        &f.root,
        request.formatter_profile.as_ref().unwrap(),
    )
    .unwrap();

    let context = f.context();
    let mut preview = plan(&context);
    preview["operation"] = json!("batchCleanup");
    preview["structuredDiff"] = json!([{"type":"modifyFile","path":"Example.java"},{"type":"modifyFile","path":"Other.java"}]);
    preview["affectedFiles"] = json!(["Example.java", "Other.java"]);
    assert!(normalize_preview(&preview, &request, &f.project, &f.root).is_err());
    preview["formatterProfilePath"] = json!("team.xml");
    preview["formatterProfileName"] = json!("Team");
    preview["formatterProfileSha256"] = json!(approved_hash);
    assert_eq!(
        normalize_preview(&preview, &request, &f.project, &f.root).unwrap()
            ["formatterProfileSha256"],
        approved_hash
    );

    let apply: EngineApplyRequest = serde_json::from_value(json!({
        "operation":"batch-cleanup", "target":request.target, "changeIntent":request.change_intent,
        "projectContext":context, "formatterProfile":profile, "formatterProfileSha256":approved_hash,
        "planId":"sdk-plan", "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},
        "selectionGeneration":1, "requestId":"apply",
        "approval":{"approvalId":"approve","approvedPlanId":"sdk-plan","approvedAt":"2026-10-24T00:00:00Z"}
    })).unwrap();
    assert_eq!(
        validate_formatter_profile_approval(&f.root, &apply, Some(&approved_hash)).unwrap(),
        Some(approved_hash.clone())
    );
    fs::write(
        f.root.join("team.xml"),
        xml.replace("/>", "><setting id=\"style\" value=\"changed\"/></profile>"),
    )
    .unwrap();
    assert!(validate_formatter_profile_approval(&f.root, &apply, Some(&approved_hash)).is_err());
}

#[test]
fn batch_cleanup_rejects_missing_extra_or_renamed_plan_files() {
    let f = Fixture::new();
    let request = batch_request(&f);
    let mut good = plan(&f.context());
    good["operation"] = json!("batchCleanup");
    good["structuredDiff"] = json!([{"type":"modifyFile","path":"Example.java"},{"type":"modifyFile","path":"Other.java"}]);
    good["affectedFiles"] = json!(["Example.java", "Other.java"]);
    assert_eq!(normalize_preview(&good, &request, &f.project, &f.root).unwrap()["affectedFiles"].as_array().unwrap().len(), 2);
    for edit in [json!({"type":"modifyFile","path":"Unselected.java"}), json!({"type":"deleteFile","path":"Other.java"}), json!({"type":"renameFile","path":"Other.java","newPath":"Renamed.java"})] {
        let mut bad = good.clone();
        bad["structuredDiff"][1] = edit;
        assert!(normalize_preview(&bad, &request, &f.project, &f.root).is_err());
    }
    good["structuredDiff"].as_array_mut().unwrap().pop();
    assert!(normalize_preview(&good, &request, &f.project, &f.root).is_err());
}

#[test]
fn sdk_file_request_maps_nested_project_path_and_refuses_other_targets() {
    let f = Fixture::new();
    let context = f.context();
    let mut request = f.request(&context);
    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["arguments"]["file"], "Example.java");
    assert_eq!(
        params["javaContext"]["expectedContextHash"],
        context.context_hash
    );
    request.target.identity = "other.java".into();
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
    request.target.path = "different/Example.java".into();
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn move_class_request_keeps_project_authority_and_refuses_unadvertised_destinations() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("src/main/java/example")).unwrap();
    fs::write(
        f.project.join("src/main/java/example/A.java"),
        "package example; class A {}\n",
    )
    .unwrap();
    let context = f.context();
    let mut request = f.request(&context);
    request.operation = RefactoringOperation::MoveClass;
    request.target.kind = "class".into();
    request.target.path = "maven/src/main/java/example/A.java".into();
    request.target.identity = "example.A".into();
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "move-class",
            "newPackage": "example.services",
            "targetModuleId": "library",
        }))
        .unwrap(),
    );

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None).unwrap();
    assert_eq!(params["operation"], "moveClass");
    assert_eq!(params["languageId"], "java");
    assert_eq!(params["symbol"], "example.A");
    assert_eq!(params["expectedSnapshotHash"], context.snapshot_hash);
    assert_eq!(
        params["javaContext"],
        json!({
            "sdkHome": "/sdk",
            "expectedContextHash": context.context_hash,
            "contextSchemaVersion": context.context_schema_version,
        })
    );
    assert_eq!(
        params["arguments"],
        json!({"targetPackage": "example.services", "targetModuleId": "library"})
    );

    let mut old_capabilities = capabilities();
    assert!(!move_class_target_module_selection_offered(
        &old_capabilities
    ));
    old_capabilities["javaContextRefactoring"]["operationCapabilities"] = json!([
        {
            "operation": "moveClass",
            "targetModuleSelection": {
            "schemaVersion": "java-move-class-target-module-v1",
            "argument": "targetModuleId",
            "identity": "module-id-within-source-provider",
            "requiresAvailableContext": true,
            "sourceSetKind": "main",
            "requiresUniqueNonGeneratedRoot": true,
            }
        }
    ]);
    assert!(move_class_target_module_selection_offered(
        &old_capabilities
    ));
    let normalized = super::super::capability_policy::normalize_operation_capabilities(
        old_capabilities.get("javaContextRefactoring"),
    )
    .unwrap();
    assert_eq!(
        normalized[0]["targetModuleSelection"],
        old_capabilities["javaContextRefactoring"]["operationCapabilities"][0]
            ["targetModuleSelection"]
    );
    old_capabilities["javaContextRefactoring"]["operationCapabilities"][0]
        ["targetModuleSelection"]["argument"] = json!("targetPath");
    assert!(!move_class_target_module_selection_offered(
        &old_capabilities
    ));
    assert!(
        super::super::capability_policy::normalize_operation_capabilities(
            old_capabilities.get("javaContextRefactoring")
        )
        .is_none()
    );

    let invalid_intent: super::super::contract::RefactorKitChangeIntent =
        serde_json::from_value(json!({
            "operation": "move-class",
            "newPackage": "example.services",
            "targetModuleId": "library\n"
        }))
        .unwrap();
    assert!(invalid_intent
        .validate(RefactoringOperation::MoveClass)
        .is_err());

    request.change_intent.as_mut().unwrap().target_path =
        Some("maven/other/src/main/java/example/services/A.java".into());
    assert!(matches!(
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None),
        Err(message) if message.contains("does not advertise explicit move-class destination paths")
    ));
}

fn add_parameter_request(f: &Fixture, context: &ProjectContext) -> EnginePreviewRequest {
    let mut request = f.request(context);
    request.operation = RefactoringOperation::AddMethodParameter;
    request.target.kind = "member".into();
    request.target.path = "maven/Example.java".into();
    request.target.identity = "@cursor".into();
    request.target.selection =
        Some(super::super::contract::RefactoringSelection { start: 17, end: 17 });
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "add-method-parameter",
            "parameterType": "int",
            "parameterName": "count",
            "defaultExpression": "0"
        }))
        .unwrap(),
    );
    request
}

fn selected_method(context: &ProjectContext, content_hash: &str) -> Value {
    json!({
        "schemaVersion": "java-mutation-selection-v1",
        "snapshotHash": context.snapshot_hash,
        "contextHash": context.context_hash,
        "path": "Example.java",
        "position": {"line": 0, "character": 17},
        "contentSha256": content_hash,
        "provenanceHash": "a".repeat(64),
        "selectorHash": "b".repeat(64),
        "symbolKind": "method",
        "symbolId": "method-id",
        "bindingKey": "Lsample/Example;.count(I)V",
        "declaration": {
            "path": "Example.java",
            "range": {
                "start": {"line": 0, "character": 0},
                "end": {"line": 0, "character": 30}
            }
        }
    })
}

fn saved_selection_response(
    context: &ProjectContext,
    request: &EnginePreviewRequest,
    content_hash: &str,
) -> Value {
    let selection = selected_method(context, content_hash);
    json!({
        "schemaVersion": 1,
        "requestId": request.request_id,
        "snapshotHash": context.snapshot_hash,
        "indexGeneration": 7,
        "status": "ready",
        "kind": "mutationSelection",
        "providerId": "java-jdt-bindings-v1",
        "backend": "eclipse-jdt-3.44-bindings-v1",
        "evidence": "compiler",
        "completeness": "semantic",
        "provenanceHash": "a".repeat(64),
        "contextHash": context.context_hash,
        "contextSchemaVersion": context.context_schema_version,
        "platformIdentities": context.platform_identities,
        "sourceAuthority": {
            "kind": "saved-snapshot",
            "path": "Example.java",
            "contentSha256": content_hash
        },
        "selection": selection
    })
}

#[test]
fn add_parameter_preview_binds_provider_operation_to_saved_method_selection() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { void run() {} }",
    )
    .unwrap();
    let context = f.context();
    let request = add_parameter_request(&f, &context);
    let selection = selected_method(&context, &"c".repeat(64));

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "changeSignature.addParameter");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(
        params["arguments"],
        json!({
            "parameterType": "int",
            "parameterName": "count",
            "defaultExpression": "0"
        })
    );
    assert!(
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None)
            .unwrap_err()
            .contains("bound Java method selection")
    );

    let mut wrong_kind = selection;
    wrong_kind["symbolKind"] = json!("field");
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&wrong_kind),
    )
    .is_err());
}

#[test]
fn reorder_parameters_maps_to_the_exact_jdt_operation_and_reviewed_order() {
    let f = Fixture::new();
    let context = f.context();
    let mut request = f.request(&context);
    request.operation = RefactoringOperation::ReorderMethodParameters;
    request.target.kind = "member".into();
    request.target.identity = "example.Example#calculate(int,String)".into();
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "reorder-method-parameters",
            "newOrder": "second,first"
        }))
        .unwrap(),
    );

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "changeSignature.reorderParameters");
    assert_eq!(params["symbol"], "example.Example#calculate(int,String)");
    assert_eq!(params["arguments"], json!({"newOrder": "second,first"}));

    request.change_intent.as_mut().unwrap().new_order = Some("first,first".into());
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn cursor_parameter_reordering_uses_the_saved_provider_selected_method() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { void run() {} }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::ReorderMethodParameters;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "reorder-method-parameters",
            "newOrder": "second,first"
        }))
        .unwrap(),
    );
    let content_hash = "c".repeat(64);
    let raw = saved_selection_response(&context, &request, &content_hash);
    let selection = normalize_saved_mutation_selection(
        &raw,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    assert_eq!(selection["symbolId"], "method-id");

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "changeSignature.reorderParameters");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["arguments"], json!({"newOrder": "second,first"}));
    assert_eq!(params["javaSelection"], selection);

    let mut provider_plan = plan(&context);
    provider_plan["operation"] = json!("changeSignature.reorderParameters");
    provider_plan["selectionHash"] = selection["selectorHash"].clone();
    assert!(normalize_preview_with_selection(
        &provider_plan,
        &request,
        &f.project,
        &f.root,
        selection["selectorHash"].as_str(),
    )
    .is_ok());
    assert!(
        normalize_preview_with_selection(&provider_plan, &request, &f.project, &f.root, None,)
            .is_err()
    );
}

#[test]
fn cursor_parameter_rename_uses_the_saved_provider_selected_method() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { int run(int value) { return value; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::ChangeMethodSignature;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "change-method-signature",
            "oldParameter": "value",
            "newParameter": "renamed"
        }))
        .unwrap(),
    );
    let content_hash = "c".repeat(64);
    let raw_selection = saved_selection_response(&context, &request, &content_hash);
    let selection = normalize_saved_mutation_selection(
        &raw_selection,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    assert_eq!(selection["symbolId"], "method-id");

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "changeSignature.renameParameter");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(
        params["arguments"],
        json!({"oldName": "value", "newName": "renamed"})
    );
    assert_eq!(params["javaSelection"], selection);
    assert!(preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None).is_err());

    let mut provider_plan = plan(&context);
    provider_plan["operation"] = json!("changeSignature.renameParameter");
    provider_plan["selectionHash"] = selection["selectorHash"].clone();
    assert!(normalize_preview_with_selection(
        &provider_plan,
        &request,
        &f.project,
        &f.root,
        selection["selectorHash"].as_str(),
    )
    .is_ok());
}

#[test]
fn cursor_parameter_type_change_uses_managed_operation_and_saved_method_selection() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { void run(int count) {} }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::ChangeMethodParameterType;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "change-method-parameter-type",
            "parameterName": "count",
            "newType": "java.lang.Integer"
        }))
        .unwrap(),
    );
    let content_hash = "c".repeat(64);
    let raw_selection = saved_selection_response(&context, &request, &content_hash);
    let selection = normalize_saved_mutation_selection(
        &raw_selection,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    assert_eq!(selection["symbolId"], "method-id");

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "changeSignature.changeParameterType");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(
        params["arguments"],
        json!({"parameterName": "count", "newType": "java.lang.Integer"})
    );

    let mut provider_plan = plan(&context);
    provider_plan["operation"] = json!("changeSignature.changeParameterType");
    provider_plan["selectionHash"] = selection["selectorHash"].clone();
    assert!(normalize_preview_with_selection(
        &provider_plan,
        &request,
        &f.project,
        &f.root,
        selection["selectorHash"].as_str(),
    )
    .is_ok());
    assert!(
        normalize_preview_with_selection(&provider_plan, &request, &f.project, &f.root, None,)
            .is_err()
    );

    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "change-method-parameter-type",
            "parameterName": "count",
            "newType": "   "
        }))
        .unwrap(),
    );
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&selection),
    )
    .is_err());
}

#[test]
fn cursor_parameter_removal_uses_exact_saved_method_selection_and_intent() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { int select(int value, int unused) { return value; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::RemoveMethodParameter;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "remove-method-parameter",
            "parameterName": "unused"
        }))
        .unwrap(),
    );
    let content_hash = "c".repeat(64);
    let raw_selection = saved_selection_response(&context, &request, &content_hash);
    let selection = normalize_saved_mutation_selection(
        &raw_selection,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    assert_eq!(selection["symbolId"], "method-id");

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "changeSignature.removeParameter");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(params["arguments"], json!({"parameterName": "unused"}));

    let mut provider_plan = plan(&context);
    provider_plan["operation"] = json!("changeSignature.removeParameter");
    provider_plan["selectionHash"] = selection["selectorHash"].clone();
    assert!(normalize_preview_with_selection(
        &provider_plan,
        &request,
        &f.project,
        &f.root,
        selection["selectorHash"].as_str(),
    )
    .is_ok());
    assert!(
        normalize_preview_with_selection(&provider_plan, &request, &f.project, &f.root, None,)
            .is_err()
    );

    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "remove-method-parameter",
            "parameterName": "  "
        }))
        .unwrap(),
    );
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&selection),
    )
    .is_err());
}

#[test]
fn make_static_uses_the_attested_saved_cursor_method_without_change_intent() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { private int isolated() { return 42; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::MakeStatic;
    request.change_intent = None;

    let content_hash = "c".repeat(64);
    let raw = saved_selection_response(&context, &request, &content_hash);
    let selection = normalize_saved_mutation_selection(
        &raw,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "makeStatic");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["arguments"], json!({}));
    assert!(params.get("javaSelection").is_none());

    let mut provider_plan = plan(&context);
    provider_plan["operation"] = json!("makeStatic");
    assert!(
        normalize_preview_with_selection(&provider_plan, &request, &f.project, &f.root, None,)
            .is_ok()
    );
}

#[test]
fn make_public_uses_a_bound_saved_final_method_and_provider_visibility_argument() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { private final int isolated() { return 42; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::MakePublic;
    request.change_intent = None;

    let content_hash = "c".repeat(64);
    let raw = saved_selection_response(&context, &request, &content_hash);
    let selection = normalize_saved_mutation_selection(
        &raw,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "changeVisibility");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["arguments"], json!({"visibility": "public"}));
    assert_eq!(params["javaSelection"]["symbolId"], "method-id");

    let mut provider_plan = plan(&context);
    provider_plan["operation"] = json!("changeVisibility");
    provider_plan["selectionHash"] = selection["selectorHash"].clone();
    assert!(normalize_preview_with_selection(
        &provider_plan,
        &request,
        &f.project,
        &f.root,
        selection["selectorHash"].as_str(),
    )
    .is_ok());
}

#[test]
fn extract_interface_maps_the_attested_saved_class_selection_to_the_provider() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { public int calculate(int value) { return value; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::ExtractInterface;
    request.target.kind = "class".into();
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "extract-interface",
            "interfaceName": "Calculations",
            "methodName": "calculate"
        }))
        .unwrap(),
    );

    let content_hash = "c".repeat(64);
    let mut raw_selection = saved_selection_response(&context, &request, &content_hash);
    raw_selection["selection"]["symbolKind"] = json!("class");
    raw_selection["selection"]["symbolId"] = json!("sample.Example");
    raw_selection["selection"]["bindingKey"] = json!("Lsample/Example;");
    let selection = normalize_saved_mutation_selection(
        &raw_selection,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "class",
    )
    .unwrap();

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "extractInterface");
    assert_eq!(params["symbol"], "sample.Example");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(
        params["arguments"],
        json!({
            "file": "Example.java",
            "interfaceName": "Calculations",
            "methodName": "calculate"
        })
    );
}

#[test]
fn extract_superclass_maps_the_attested_saved_class_selection_to_the_provider() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { public int calculate(int value) { return value; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::ExtractSuperclass;
    request.target.kind = "class".into();
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "extract-superclass",
            "superclassName": "ExampleBase",
            "methodName": "calculate"
        }))
        .unwrap(),
    );

    let content_hash = "c".repeat(64);
    let mut raw_selection = saved_selection_response(&context, &request, &content_hash);
    raw_selection["selection"]["symbolKind"] = json!("class");
    raw_selection["selection"]["symbolId"] = json!("sample.Example");
    raw_selection["selection"]["bindingKey"] = json!("Lsample/Example;");
    let selection = normalize_saved_mutation_selection(
        &raw_selection,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "class",
    )
    .unwrap();

    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "extractSuperclass");
    assert_eq!(params["symbol"], "sample.Example");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(
        params["arguments"],
        json!({
            "file": "Example.java",
            "superclassName": "ExampleBase",
            "methodName": "calculate"
        })
    );
}

#[test]
fn pull_up_member_maps_the_attested_saved_method_and_target_type_to_the_provider() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "package fixture; class Child extends Parent { public int value() { return 1; } }",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::PullUpMember;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "pull-up-member",
            "targetType": "fixture.Parent"
        }))
        .unwrap(),
    );

    let content_hash = "c".repeat(64);
    let selection = normalize_saved_mutation_selection(
        &saved_selection_response(&context, &request, &content_hash),
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "pullUpMember");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(
        params["arguments"],
        json!({"file": "Example.java", "targetType": "fixture.Parent"})
    );
    assert!(
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None,)
            .unwrap_err()
            .contains("bound Java method selection")
    );

    let mut non_method_selection = selection;
    non_method_selection["symbolKind"] = json!("field");
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&non_method_selection),
    )
    .is_err());

    request.change_intent.as_mut().unwrap().target_type = Some(" ".into());
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&selected_method(&context, &content_hash)),
    )
    .is_err());
}

#[test]
fn push_down_member_maps_the_attested_saved_method_and_target_type_to_the_provider() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "package fixture; abstract class Parent { protected final int value() { return 1; } } final class Child extends Parent {}",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::PushDownMember;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "push-down-member",
            "targetType": "fixture.Child"
        }))
        .unwrap(),
    );

    let content_hash = "c".repeat(64);
    let selection = normalize_saved_mutation_selection(
        &saved_selection_response(&context, &request, &content_hash),
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        17,
        &content_hash,
        "method",
    )
    .unwrap();
    let params =
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection))
            .unwrap();
    assert_eq!(params["operation"], "pushDownMember");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["javaSelection"], selection);
    assert_eq!(
        params["arguments"],
        json!({"file": "Example.java", "targetType": "fixture.Child"})
    );
    assert!(
        preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None,)
            .unwrap_err()
            .contains("bound Java method selection")
    );

    let mut non_method_selection = selection;
    non_method_selection["symbolKind"] = json!("field");
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&non_method_selection),
    )
    .is_err());

    request.change_intent.as_mut().unwrap().target_type = Some(" ".into());
    assert!(preview_params_with_selection(
        &request,
        &f.project,
        Path::new("/sdk"),
        Some(&selected_method(&context, &content_hash)),
    )
    .is_err());
}

#[test]
fn move_member_maps_provider_bound_method_and_destination_selections() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "package fixture; class Source { static int value() { return 42; } } class Destination {}",
    )
    .unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::MoveMember;
    request.change_intent = Some(
        serde_json::from_value(json!({
            "operation": "move-member",
            "targetType": "fixture.Destination",
            "targetPath": "maven/Example.java",
            "targetPosition": {"line": 0, "character": 76}
        }))
        .unwrap(),
    );

    let content_hash = "c".repeat(64);
    let source_selection = selected_method(&context, &content_hash);
    let mut destination_selection = source_selection.clone();
    destination_selection["position"] = json!({"line": 0, "character": 76});
    destination_selection["symbolKind"] = json!("class");
    destination_selection["symbolId"] = json!("fixture.Destination");
    destination_selection["bindingKey"] = json!("Lfixture/Destination;");
    let mut destination_response = saved_selection_response(&context, &request, &content_hash);
    destination_response["selection"] = destination_selection;
    let normalized_destination = normalize_saved_mutation_selection(
        &destination_response,
        &request,
        &context,
        &f.project,
        "Example.java",
        0,
        76,
        &content_hash,
        "class",
    )
    .unwrap();

    let params = preview_params_with_workspace_root_and_target(
        &request,
        &f.project,
        &f.root,
        Path::new("/sdk"),
        Some(&source_selection),
        Some(&normalized_destination),
    )
    .unwrap();
    assert_eq!(params["operation"], "moveMember");
    assert_eq!(params["symbol"], "method-id");
    assert_eq!(params["javaSelection"], source_selection);
    assert_eq!(
        params["arguments"],
        json!({
            "file": "Example.java",
            "memberKind": "method",
            "targetType": "fixture.Destination",
            "targetBindingKey": "Lfixture/Destination;"
        })
    );
    assert!(preview_params_with_workspace_root_and_target(
        &request,
        &f.project,
        &f.root,
        Path::new("/sdk"),
        Some(&source_selection),
        None,
    )
    .unwrap_err()
    .contains("destination type selection"));

    let mut invalid_destination = normalized_destination;
    invalid_destination["symbolKind"] = json!("method");
    assert!(preview_params_with_workspace_root_and_target(
        &request,
        &f.project,
        &f.root,
        Path::new("/sdk"),
        Some(&source_selection),
        Some(&invalid_destination),
    )
    .is_err());
}

#[test]
fn saved_mutation_selection_requires_matching_context_source_and_provenance() {
    let f = Fixture::new();
    fs::write(
        f.project.join("Example.java"),
        "class Example { void run() {} }",
    )
    .unwrap();
    let context = f.context();
    let request = add_parameter_request(&f, &context);
    let path = "Example.java";
    let line = 0;
    let character = 17;
    let content_hash = "c".repeat(64);
    let raw = saved_selection_response(&context, &request, &content_hash);

    let selection = normalize_saved_mutation_selection(
        &raw,
        &request,
        &context,
        &f.project,
        path,
        line,
        character,
        &content_hash,
        "method",
    )
    .unwrap();
    assert_eq!(selection["symbolId"], "method-id");

    let mut stale = raw;
    stale["selection"]["provenanceHash"] = json!("d".repeat(64));
    assert!(normalize_saved_mutation_selection(
        &stale,
        &request,
        &context,
        &f.project,
        path,
        line,
        character,
        &content_hash,
        "method",
    )
    .is_err());
}

#[test]
fn add_parameter_preview_and_apply_require_the_same_provider_selection_hash() {
    let f = Fixture::new();
    let context = f.context();
    let request = add_parameter_request(&f, &context);
    let mut raw = plan(&context);
    raw["operation"] = json!("changeSignature.addParameter");
    raw["selectionHash"] = json!("b".repeat(64));

    assert!(normalize_preview_with_selection(
        &raw,
        &request,
        &f.project,
        &f.root,
        Some(&"b".repeat(64)),
    )
    .is_ok());
    assert!(normalize_preview_with_selection(
        &raw,
        &request,
        &f.project,
        &f.root,
        Some(&"d".repeat(64)),
    )
    .is_err());
    assert!(normalize_preview_with_selection(&raw, &request, &f.project, &f.root, None).is_err());

    let applied = json!({"appliedSelectionHash": "b".repeat(64)});
    assert!(validate_applied_selection(&applied, Some(&"b".repeat(64))).is_ok());
    assert!(validate_applied_selection(&applied, Some(&"d".repeat(64))).is_err());
    assert!(validate_applied_selection(&Value::Null, Some(&"b".repeat(64))).is_err());
}

#[test]
fn sdk_preview_and_apply_authority_preserve_the_selected_context_schema() {
    let f = Fixture::new();
    for schema in [
        "java-project-context-v1",
        "java-project-context-v2",
        "java-project-context-v3",
        "java-project-context-v4",
        "java-project-context-v5",
        "java-project-context-v6",
        "java-project-context-v7",
    ] {
        let mut context = f.context();
        context.context_schema_version = schema.into();
        let request = f.request(&context);
        let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
        assert_eq!(params["javaContext"]["contextSchemaVersion"], schema);

        let apply_authority = java_context_authority(&context, Path::new("/sdk"));
        assert_eq!(apply_authority["contextSchemaVersion"], schema);
        assert_eq!(apply_authority["expectedContextHash"], context.context_hash);
    }
}

#[test]
fn sdk_source_root_request_maps_the_exact_project_root_and_destination() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("app/src/main/java")).unwrap();
    fs::create_dir_all(f.project.join("app/src")).unwrap();
    let context = f.context();
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "move-source-root",
        "target": {
            "kind": "source-root",
            "path": "maven/app/src/main/java",
            "identity": "maven/app/src/main/java"
        },
        "changeIntent": {"operation": "move-source-root", "to": "app/src/relocated/java"},
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "move-root-preview",
        "projectContext": context
    }))
    .unwrap();
    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "moveSourceRoot");
    assert_eq!(params["symbol"], "app/src/main/java");
    assert_eq!(params["arguments"]["from"], "app/src/main/java");
    assert_eq!(params["arguments"]["to"], "app/src/relocated/java");

    request.target.identity = "maven/app/src/other".into();
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
    request.target.identity = request.target.path.clone();
    request.change_intent.as_mut().unwrap().to = Some("../outside".into());
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn extract_constant_maps_saved_selection_using_utf16_positions() {
    let f = Fixture::new();
    let source = "class A { int n = 1 + \"💡\".length(); }\r\n";
    let source_path = f.project.join("src/main/java/Example.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    fs::write(&source_path, source).unwrap();
    let start = source.find("1 + \"💡\"").unwrap();
    let end = start + "1 + \"💡\"".len();
    let start_utf16 = source[..start].encode_utf16().count();
    let end_utf16 = source[..end].encode_utf16().count();
    let context = f.context();
    let request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "extract-constant",
        "target": {
            "kind": "file",
            "path": "maven/src/main/java/Example.java",
            "identity": "maven/src/main/java/Example.java",
            "selection": {"start": start_utf16, "end": end_utf16}
        },
        "changeIntent": {"operation": "extract-constant", "name": "ANSWER"},
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "extract-constant-preview",
        "projectContext": context
    }))
    .unwrap();

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "extractConstant");
    assert_eq!(params["symbol"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["file"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["startLine"], 0);
    assert_eq!(params["arguments"]["startCharacter"], start_utf16);
    assert_eq!(params["arguments"]["endLine"], 0);
    assert_eq!(params["arguments"]["endCharacter"], end_utf16);
    assert_eq!(params["arguments"]["name"], "ANSWER");
}

#[test]
fn extract_constant_rejects_invalid_utf16_selection_and_target() {
    let f = Fixture::new();
    let source_path = f.project.join("src/main/java/Example.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    let source = "class A { String value = \"💡\"; }\n";
    fs::write(&source_path, source).unwrap();
    let emoji = source.find("💡").unwrap();
    let split_surrogate = source[..emoji].encode_utf16().count() + 1;
    let context = f.context();
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "extract-constant",
        "target": {
            "kind": "file",
            "path": "maven/src/main/java/Example.java",
            "identity": "maven/src/main/java/Example.java",
            "selection": {"start": split_surrogate, "end": split_surrogate + 1}
        },
        "changeIntent": {"operation": "extract-constant", "name": "VALUE"},
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "extract-constant-invalid-selection",
        "projectContext": context
    }))
    .unwrap();
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());

    request.target.selection.as_mut().unwrap().start = 0;
    request.target.selection.as_mut().unwrap().end = 1;
    request.target.identity = "other.java".into();
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn extract_variable_maps_saved_return_expression_selection() {
    let f = Fixture::new();
    let source = "class A { int value() { return (1 + 2) * 3; } }\n";
    let source_path = f.project.join("src/main/java/Example.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    fs::write(&source_path, source).unwrap();
    let expression = "(1 + 2) * 3";
    let start = source.find(expression).unwrap();
    let end = start + expression.len();
    let start_utf16 = source[..start].encode_utf16().count();
    let end_utf16 = source[..end].encode_utf16().count();
    let context = f.context();
    let request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "extract-variable",
        "target": {
            "kind": "file",
            "path": "maven/src/main/java/Example.java",
            "identity": "maven/src/main/java/Example.java",
            "selection": {"start": start_utf16, "end": end_utf16}
        },
        "changeIntent": {"operation": "extract-variable", "name": "doubled"},
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "extract-variable-preview",
        "projectContext": context
    }))
    .unwrap();

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "extractVariable");
    assert_eq!(params["symbol"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["file"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["startCharacter"], start_utf16);
    assert_eq!(params["arguments"]["endCharacter"], end_utf16);
    assert_eq!(params["arguments"]["name"], "doubled");
}

#[test]
fn extract_method_maps_a_complete_saved_local_declaration_line() {
    let f = Fixture::new();
    let source =
        "class A {\r\n  int value() {\r\n    int total = 1;\r\n    return total;\r\n  }\r\n}\r\n";
    let source_path = f.project.join("src/main/java/Example.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    fs::write(&source_path, source).unwrap();
    let declaration = "int total = 1;";
    let start = source.find(declaration).unwrap();
    let end = start + declaration.len();
    let start_utf16 = source[..start].encode_utf16().count();
    let end_utf16 = source[..end].encode_utf16().count();
    let context = f.context();
    let request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "extract-method",
        "target": {
            "kind": "file",
            "path": "maven/src/main/java/Example.java",
            "identity": "maven/src/main/java/Example.java",
            "selection": {"start": start_utf16, "end": end_utf16}
        },
        "changeIntent": {"operation": "extract-method", "methodName": "calculateTotal"},
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "extract-method-preview",
        "projectContext": context
    }))
    .unwrap();

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "extractMethod");
    assert_eq!(params["symbol"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["file"], "src/main/java/Example.java");
    assert_eq!(params["arguments"]["startLine"], 3);
    assert_eq!(params["arguments"]["endLine"], 3);
    assert_eq!(params["arguments"]["methodName"], "calculateTotal");
}

#[test]
fn extract_parameter_and_field_map_saved_selections_to_provider_operations() {
    let f = Fixture::new();
    let source = "class A { int value() { return 1 + 2; } }\n";
    let source_path = f.project.join("src/main/java/Example.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    fs::write(&source_path, source).unwrap();
    let expression = "1 + 2";
    let start = source.find(expression).unwrap();
    let end = start + expression.len();
    let start_utf16 = source[..start].encode_utf16().count();
    let end_utf16 = source[..end].encode_utf16().count();
    let context = f.context();

    for (operation, provider_operation, name) in [
        ("extract-parameter", "extractParameter", "offset"),
        ("extract-field", "extractField", "value"),
    ] {
        let request: EnginePreviewRequest = serde_json::from_value(json!({
            "operation": operation,
            "target": {
                "kind": "file",
                "path": "maven/src/main/java/Example.java",
                "identity": "maven/src/main/java/Example.java",
                "selection": {"start": start_utf16, "end": end_utf16}
            },
            "changeIntent": {"operation": operation, "name": name},
            "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
            "selectionGeneration": 2,
            "requestId": format!("{operation}-preview"),
            "projectContext": context
        }))
        .unwrap();

        let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
        assert_eq!(params["operation"], provider_operation);
        assert_eq!(params["symbol"], "src/main/java/Example.java");
        assert_eq!(params["arguments"]["file"], "src/main/java/Example.java");
        assert_eq!(params["arguments"]["startCharacter"], start_utf16);
        assert_eq!(params["arguments"]["endCharacter"], end_utf16);
        assert_eq!(params["arguments"]["name"], name);
    }
}

#[test]
fn encapsulate_field_maps_exact_member_identity_without_mutation_arguments() {
    let f = Fixture::new();
    let source_path = f.project.join("src/main/java/example/Service.java");
    fs::create_dir_all(source_path.parent().unwrap()).unwrap();
    fs::write(
        &source_path,
        "package example; public class Service { public final int code = 1; }\n",
    )
    .unwrap();
    let context = f.context();
    let request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "encapsulate-field",
        "target": {
            "kind": "member",
            "path": "maven/src/main/java/example/Service.java",
            "identity": "example.Service#code"
        },
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "encapsulate-field-preview",
        "projectContext": context
    }))
    .unwrap();

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "encapsulateField");
    assert_eq!(params["symbol"], "example.Service#code");
    assert_eq!(params["arguments"], json!({}));
    assert_eq!(params["expectedSnapshotHash"], context.snapshot_hash);

    let mut invalid = request;
    invalid.target.kind = "file".into();
    assert!(preview_params(&invalid, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn sdk_package_request_maps_exact_package_intent_and_rejects_target_mismatch() {
    let f = Fixture::new();
    let source = f.project.join("src/main/java/example/Widget.java");
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    fs::write(&source, "package example; class Widget {}\n").unwrap();
    let context = f.context();
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({
        "operation": "move-package",
        "target": {
            "kind": "package",
            "path": "maven/src/main/java/example/Widget.java",
            "identity": "example"
        },
        "changeIntent": {
            "operation": "move-package",
            "fromPackage": "example",
            "toPackage": "example.services"
        },
        "authority": {"workspaceId": f.binding.workspace_id, "workspaceGeneration": 1},
        "selectionGeneration": 2,
        "requestId": "move-package-preview",
        "projectContext": context
    }))
    .unwrap();

    let params = preview_params(&request, &f.project, Path::new("/sdk")).unwrap();
    assert_eq!(params["operation"], "movePackage");
    assert_eq!(params["symbol"], "example");
    assert_eq!(params["arguments"]["fromPackage"], "example");
    assert_eq!(params["arguments"]["toPackage"], "example.services");
    assert_eq!(params["expectedSnapshotHash"], context.snapshot_hash);
    assert_eq!(
        params["javaContext"]["expectedContextHash"],
        context.context_hash
    );

    request.target.identity = "example.other".into();
    assert!(preview_params(&request, &f.project, Path::new("/sdk")).is_err());
}

#[test]
fn truncated_provider_diff_is_readable_but_cannot_be_approved() {
    let f = Fixture::new();
    let context = f.context();
    let request = f.request(&context);
    let mut raw = plan(&context);
    raw["diffTruncated"] = json!(true);
    raw["diffTruncationReasons"] = json!(["byte limit"]);
    let normalized = normalize_preview(&raw, &request, &f.project, &f.root).unwrap();
    assert_eq!(normalized["diffTruncated"], true);
    assert_eq!(normalized["applyEligibility"]["eligible"], false);
    assert!(!normalized["applyEligibility"]["blockers"]
        .as_array()
        .unwrap()
        .is_empty());
    raw.as_object_mut().unwrap().remove("diffTruncated");
    assert!(normalize_preview(&raw, &request, &f.project, &f.root).is_err());
}

#[test]
fn lexical_or_missing_semantic_evidence_keeps_sdk_plan_review_only() {
    let f = Fixture::new();
    let context = f.context();
    let request = f.request(&context);

    for evidence in ["LEXICAL", "LEXICAL_FALLBACK", "NONE"] {
        let mut raw = plan(&context);
        raw["evidence"] = json!(evidence);
        let normalized = normalize_preview(&raw, &request, &f.project, &f.root).unwrap();

        assert_eq!(normalized["status"], "ready");
        assert_eq!(normalized["applyEligibility"]["eligible"], false);
        assert!(normalized["applyEligibility"]["blockers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|blocker| blocker
                .as_str()
                .unwrap()
                .contains("review is available but Apply is not")));
    }
}

#[test]
#[ignore = "Requires the SDK-bound RefactorKit package, real Maven/JDK and cached dependencies; run with --test-threads=1"]
fn real_sdk_refactoring_reviews_applies_and_builds_six_module_maven_project() {
    qualify_real_sdk_refactoring(false, false);
}

#[test]
#[ignore = "Requires the SDK-bound RefactorKit package, real Maven/JDK and cached dependencies; run with --test-threads=1"]
fn real_sdk_refactoring_rolls_back_original_context_and_preserves_later_edits() {
    qualify_real_sdk_refactoring(true, false);
}

#[test]
#[ignore = "Requires real RefactorKit batchCleanup, Maven and a selected JDK"]
fn real_batch_cleanup_applies_and_builds_exact_selected_sources() {
    qualify_real_sdk_refactoring(false, true);
}

#[test]
#[ignore = "Requires real RefactorKit batchCleanup, Maven and a selected JDK"]
fn real_batch_cleanup_rolls_back_and_preserves_later_edits() {
    qualify_real_sdk_refactoring(true, true);
}

fn qualify_real_sdk_refactoring(qualify_rollback: bool, batch_only: bool) {
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
    let sdk = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK")
        .unwrap_or_else(|_| "/usr/lib/jvm/java-21-openjdk".into());
    let cache = PathBuf::from(std::env::var_os("HOME").unwrap()).join(".m2/repository");
    let f = Fixture::new();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let generated = Command::new("node").current_dir(&repo).args(["--import", "tsx", "--input-type=module", "-e", "import{javaEffectiveProjectReference}from'./tests/story/fixtures/java-effective-project-reference.ts';console.log(JSON.stringify(javaEffectiveProjectReference('maven')));"]).output().unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let mut inputs: std::collections::BTreeMap<String, String> =
        serde_json::from_slice(&generated.stdout).unwrap();
    let runner_path = "app/src/main/java/pkg/Runner.java";
    let runner_with_unused_import =
        inputs[runner_path].replace("package pkg;\n", "package pkg;\nimport java.util.List;\n");
    inputs.insert(runner_path.into(), runner_with_unused_import);
    let companion_path = "app/src/main/java/pkg/CleanupCompanion.java";
    if batch_only {
        inputs.insert(companion_path.into(), "package pkg;\nimport java.util.List;\npublic class CleanupCompanion {}\n".into());
    }
    for (path, content) in &inputs {
        let path = f.project.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
    let build = || {
        let output = Command::new("mvn")
            .current_dir(&f.project)
            .env("JAVA_HOME", &sdk)
            .args(["-B", "-o", "-Dstyle.color=never", "verify"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    build();
    let acquire = || {
        let mut session = spawn_session(&f.binding.workspace_id, 1, &f.project).unwrap();
        let acquired = (|| {
            let opened = rpc(
                &mut session,
                "project.open",
                json!({"root":f.project,"resolveDependencies":false,"mavenRepository":cache}),
            )
            .unwrap();
            let raw = rpc(
                &mut session,
                "project.context",
                json!({"sdkHome":sdk,"expectedSnapshotHash":opened["snapshotHash"]}),
            )
            .unwrap();
            assert_eq!(raw["status"], "available", "{raw}");
            let schema_version = raw["schemaVersion"].as_str().unwrap().to_owned();
            let context = serde_json::from_value::<ProjectContext>(json!({"projectPath":"maven","sdkHome":sdk,"mavenRepository":cache,"activeMavenProfiles":[],"inactiveMavenProfiles":[],
                "snapshotHash":raw["snapshotHash"],"contextHash":raw["contextHash"],"contextSchemaVersion":schema_version,"platformIdentities":raw["sdk"].as_array().unwrap().iter().map(|s| s["identitySha256"].clone()).collect::<Vec<_>>()})).unwrap();
            assert_eq!(context.context_schema_version, schema_version);
            context
        })();
        terminate(&mut session.child);
        acquired
    };
    let state = RefactorKitDaemonState::default();
    let mut allowed_changes = std::collections::HashSet::new();
    let operations = if batch_only {
        vec![("batch-cleanup", runner_path, runner_path, json!({"operation":"batch-cleanup","actions":[
            {"operation":"organize-imports","path":format!("maven/{runner_path}")},
            {"operation":"organize-imports","path":format!("maven/{companion_path}")}
        ]}))]
    } else { vec![
        (
            "format-file",
            "library/src/main/java/fixtures/library/BaseGreeting.java",
            "library/src/main/java/fixtures/library/BaseGreeting.java",
            Value::Null,
        ),
        (
            "rename-class",
            "library/src/main/java/fixtures/library/BaseGreeting.java",
            "fixtures.library.BaseGreeting",
            json!({"operation":"rename-class","newName":"RenamedGreeting"}),
        ),
        ("organize-imports", runner_path, runner_path, Value::Null),
    ] };
    for (sequence, (operation, path, identity, intent)) in operations
    .into_iter()
    .enumerate()
    {
        let context = acquire();
        let file_operation = matches!(operation, "format-file" | "organize-imports" | "batch-cleanup");
        let request = json!({"operation":operation,"target":{"kind":if file_operation {"file"} else {"class"},"path":format!("maven/{path}"),"identity":if file_operation {format!("maven/{identity}")} else {identity.into()}},
            "changeIntent":intent,"authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},"selectionGeneration":sequence+1,"requestId":format!("real-sdk-{sequence}"),"projectContext":context});
        let mut preview = preview_at(
            serde_json::from_value(request.clone()).unwrap(),
            &state,
            f.binding.clone(),
            &f.root,
        )
        .unwrap();
        assert_eq!(preview["status"], "ready", "{preview}");
        assert_eq!(preview["applyEligibility"]["eligible"], true, "{preview}");
        assert!(!preview["renderedDiff"].as_str().unwrap().trim().is_empty());
        let mut apply_request = request.clone();
        apply_request["planId"] = preview["planId"].clone();
        apply_request["approval"] = json!({"approvalId":"real-sdk-approval","approvedPlanId":preview["planId"],"approvedAt":"2026-10-03T12:00:00Z"});
        let before: std::collections::BTreeMap<_, _> = inputs
            .keys()
            .filter_map(|path| {
                fs::read(f.project.join(path))
                    .ok()
                    .map(|bytes| (path.clone(), bytes))
            })
            .collect();
        if batch_only {
            let mut changed_selection = apply_request.clone();
            changed_selection["changeIntent"]["actions"][1]["path"] = json!("maven/unrelated/src/main/java/pkg/Peer.java");
            assert!(apply_at(serde_json::from_value(changed_selection).unwrap(), &state, f.binding.clone(), &f.root).is_err());
            for (file, bytes) in &before { assert_eq!(fs::read(f.project.join(file)).unwrap(), *bytes); }
        }
        let mut stale = apply_request.clone();
        stale["projectContext"]["activeMavenProfiles"] = json!(["alternate"]);
        assert!(apply_at(
            serde_json::from_value(stale).unwrap(),
            &state,
            f.binding.clone(),
            &f.root
        )
        .is_err());
        if let Ok(other_sdk) = std::env::var("IDE_JAVA_CONTEXT_OTHER_TEST_JDK") {
            assert_ne!(
                Path::new(&other_sdk).canonicalize().unwrap(),
                Path::new(&sdk).canonicalize().unwrap()
            );
            let mut stale = apply_request.clone();
            stale["projectContext"]["sdkHome"] = json!(other_sdk);
            assert!(apply_at(
                serde_json::from_value(stale).unwrap(),
                &state,
                f.binding.clone(),
                &f.root
            )
            .is_err());
        }
        for (path, bytes) in &before {
            assert_eq!(
                fs::read(f.project.join(path)).unwrap(),
                *bytes,
                "rejected profile change wrote {path}"
            );
        }
        if sequence == 0 {
            fs::write(
                f.project.join("pom.xml"),
                format!("{}\n<!-- changed after review -->\n", inputs["pom.xml"]),
            )
            .unwrap();
            let refusal = apply_at(
                serde_json::from_value(apply_request.clone()).unwrap(),
                &state,
                f.binding.clone(),
                &f.root,
            )
            .unwrap();
            assert_eq!(refusal["outcome"], "refused", "{refusal}");
            assert_eq!(fs::read(f.project.join(path)).unwrap(), before[path]);
            fs::write(f.project.join("pom.xml"), &inputs["pom.xml"]).unwrap();
            preview = preview_at(
                serde_json::from_value(request.clone()).unwrap(),
                &state,
                f.binding.clone(),
                &f.root,
            )
            .unwrap();
            apply_request["planId"] = preview["planId"].clone();
            apply_request["approval"]["approvedPlanId"] = preview["planId"].clone();
        }
        let applied = apply_at(
            serde_json::from_value(apply_request).unwrap(),
            &state,
            f.binding.clone(),
            &f.root,
        )
        .unwrap();
        assert_eq!(applied["outcome"], "applied", "{applied}");
        assert_eq!(applied["appliedContextHash"], context.context_hash);
        assert!(hash(applied["appliedSnapshotHash"].as_str().unwrap()));
        if operation == "batch-cleanup" {
            assert_eq!(applied["changedFiles"].as_array().unwrap().len(), 2);
            for selected in [runner_path, companion_path] {
                assert!(!fs::read_to_string(f.project.join(selected)).unwrap().contains("import java.util.List;"));
            }
        }
        if operation == "organize-imports" {
            let organized = fs::read_to_string(f.project.join(path)).unwrap();
            assert!(
                !organized.contains("import java.util.List;"),
                "unused import remains after RefactorKit organization:\n{organized}"
            );
        }
        assert_eq!(
            acquire().snapshot_hash,
            applied["appliedSnapshotHash"].as_str().unwrap(),
            "immediate post-Apply snapshot changed"
        );
        assert!(!applied["changedFiles"].as_array().unwrap().is_empty());
        let wire = f.root.join("native-sdk-refactoring-wire.json");
        fs::write(
            &wire,
            serde_json::to_vec(&json!({"request": request, "preview": preview, "apply": applied}))
                .unwrap(),
        )
        .unwrap();
        let decoded = Command::new("node").current_dir(&repo).args(["--import", "tsx", "--input-type=module", "-e",
            "import fs from 'node:fs';import assert from 'node:assert/strict';import{normalizeRefactorPreview,normalizeRefactorApply}from'./packages/tauri-adapters/src/refactorkit-tauri.ts';import{javaProjectContextAttestationMatches}from'./packages/contracts/src/java-project-operation-context.ts';const wire=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const preview=normalizeRefactorPreview('preview_refactorkit_engine_refactoring',wire.preview);const applied=normalizeRefactorApply('apply_refactorkit_engine_refactoring',wire.apply);assert.equal(javaProjectContextAttestationMatches(wire.request.projectContext,preview.projectContext),true);assert.equal(preview.diffTruncated,false);assert.equal(preview.applyEligibility.eligible,true);assert.equal(applied.outcome,'applied');assert.equal(applied.planId,preview.planId);assert.equal(applied.operation,preview.operation);assert.deepEqual(applied.changedFiles,wire.apply.changedFiles);console.log('SDK_REFACTOR_CODEC_OK');"
        ]).arg(&wire).output().unwrap();
        assert!(
            decoded.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&decoded.stdout),
            String::from_utf8_lossy(&decoded.stderr)
        );
        assert!(String::from_utf8_lossy(&decoded.stdout).contains("SDK_REFACTOR_CODEC_OK"));
        for file in applied["changedFiles"].as_array().unwrap() {
            for field in ["path", "previousPath"] {
                if let Some(path) = file[field].as_str() {
                    assert!(path.starts_with("maven/"));
                    allowed_changes.insert(path.trim_start_matches("maven/").to_string());
                }
            }
        }
        if !qualify_rollback {
            build();
            // Compilation can change classpath evidence. The old transaction must
            // not gain rollback authority over that later saved/build image.
            if acquire().snapshot_hash != applied["appliedSnapshotHash"].as_str().unwrap() {
                let stale = json!({"transactionId":applied["transactionId"],"operation":operation,
                    "authority":request["authority"],"requestId":"rollback-after-build",
                    "projectContext":context,"expectedSnapshotHash":applied["appliedSnapshotHash"]});
                assert!(rollback_at(
                    serde_json::from_value(stale).unwrap(),
                    &state,
                    f.binding.clone(),
                    &f.root
                )
                .is_err());
            }
            continue;
        }
        let rollback_request = json!({"transactionId":applied["transactionId"],"operation":operation,
            "authority":request["authority"],"requestId":format!("rollback-sdk-{sequence}"),
            "projectContext":context,"expectedSnapshotHash":applied["appliedSnapshotHash"]});
        let committed = applied["changedFiles"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|file| {
                let path = file["path"].as_str().unwrap().trim_start_matches("maven/");
                fs::read(f.project.join(path))
                    .ok()
                    .map(|bytes| (path.to_string(), bytes))
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        for mutation in ["snapshot", "profile", "missing-context", "sdk"] {
            let mut stale = rollback_request.clone();
            match mutation {
                "snapshot" => stale["expectedSnapshotHash"] = json!("f".repeat(64)),
                "profile" => stale["projectContext"]["activeMavenProfiles"] = json!(["alternate"]),
                "missing-context" => {
                    stale.as_object_mut().unwrap().remove("projectContext");
                }
                "sdk" => {
                    let Ok(other_sdk) = std::env::var("IDE_JAVA_CONTEXT_OTHER_TEST_JDK") else {
                        continue;
                    };
                    stale["projectContext"]["sdkHome"] = json!(other_sdk);
                }
                _ => unreachable!(),
            }
            assert!(
                rollback_at(
                    serde_json::from_value(stale).unwrap(),
                    &state,
                    f.binding.clone(),
                    &f.root
                )
                .is_err(),
                "{mutation}"
            );
        }
        let mut ordinary = rollback_request.clone();
        ordinary.as_object_mut().unwrap().remove("projectContext");
        ordinary
            .as_object_mut()
            .unwrap()
            .remove("expectedSnapshotHash");
        assert!(super::super::real_engine::rollback_refactoring(
            serde_json::from_value(ordinary).unwrap(),
            &state
        )
        .unwrap_err()
        .contains("original Java project context"));
        fs::write(
            f.project.join("pom.xml"),
            format!("{}\n<!-- changed after Apply -->\n", inputs["pom.xml"]),
        )
        .unwrap();
        let refused = rollback_at(
            serde_json::from_value(rollback_request.clone()).unwrap(),
            &state,
            f.binding.clone(),
            &f.root
        ).unwrap_err();
        assert!(refused.starts_with("Saved project inputs changed after Apply; rollback was not started ("), "{refused}");
        for (path, bytes) in &committed {
            assert_eq!(fs::read(f.project.join(path)).unwrap(), *bytes);
        }
        fs::write(f.project.join("pom.xml"), &inputs["pom.xml"]).unwrap();
        let changed_path = committed.keys().next().unwrap();
        let edited = [
            committed[changed_path].as_slice(),
            b"\n// saved after Apply\n",
        ]
        .concat();
        fs::write(f.project.join(changed_path), &edited).unwrap();
        let refused = rollback_at(
            serde_json::from_value(rollback_request.clone()).unwrap(),
            &state,
            f.binding.clone(),
            &f.root
        ).unwrap_err();
        assert!(refused.starts_with("Saved project inputs changed after Apply; rollback was not started ("), "{refused}");
        assert_eq!(fs::read(f.project.join(changed_path)).unwrap(), edited);
        fs::write(f.project.join(changed_path), &committed[changed_path]).unwrap();
        let rolled_back = rollback_at(
            serde_json::from_value(rollback_request.clone()).unwrap(),
            &state,
            f.binding.clone(),
            &f.root,
        )
        .unwrap();
        assert_eq!(rolled_back["rolledBack"], true);
        assert_eq!(rolled_back["rolledBackContextHash"], context.context_hash);
        assert_eq!(rolled_back["restoredSnapshotHash"], context.snapshot_hash);
        for (path, bytes) in &before {
            assert_eq!(
                fs::read(f.project.join(path)).unwrap(),
                *bytes,
                "rollback did not restore {path}"
            );
        }
        assert!(!f
            .project
            .join("library/src/main/java/fixtures/library/RenamedGreeting.java")
            .exists());
        fs::write(
            &wire,
            serde_json::to_vec(&json!({"request":rollback_request,"rollback":rolled_back}))
                .unwrap(),
        )
        .unwrap();
        let decoded = Command::new("node").current_dir(&repo).args(["--import","tsx","--input-type=module","-e",
            "import fs from 'node:fs';import assert from 'node:assert/strict';import{normalizeRefactorRollback}from'./packages/tauri-adapters/src/refactorkit-tauri.ts';const wire=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const rollback=normalizeRefactorRollback('rollback_refactorkit_engine_refactoring',wire.rollback);assert.equal(rollback.rolledBack,true);assert.equal(rollback.rolledBackContextHash,wire.request.projectContext.contextHash);assert.equal(rollback.restoredSnapshotHash,wire.request.projectContext.snapshotHash);assert.equal(rollback.transactionId,wire.request.transactionId);console.log('SDK_ROLLBACK_CODEC_OK');"
        ]).arg(&wire).output().unwrap();
        assert!(
            decoded.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&decoded.stdout),
            String::from_utf8_lossy(&decoded.stderr)
        );
        build();
        assert!(rollback_at(
            serde_json::from_value(rollback_request).unwrap(),
            &state,
            f.binding.clone(),
            &f.root
        )
        .is_err());
    }
    for (path, content) in &inputs {
        if !allowed_changes.contains(path) {
            assert_eq!(
                fs::read_to_string(f.project.join(path)).unwrap(),
                *content,
                "unreviewed input changed: {path}"
            );
        }
    }
    assert_eq!(
        f.project
            .join("library/src/main/java/fixtures/library/BaseGreeting.java")
            .exists(),
        qualify_rollback || batch_only
    );
    if qualify_rollback {
        for (path, content) in &inputs {
            assert_eq!(fs::read_to_string(f.project.join(path)).unwrap(), *content);
        }
    } else if !batch_only {
        assert!(fs::read_to_string(
            f.project
                .join("library/src/main/java/fixtures/library/RenamedGreeting.java")
        )
        .unwrap()
        .contains("class RenamedGreeting"));
    }
    state.shutdown_all();
}

#[test]
fn add_parameter_hierarchy_options_require_explicit_risk_and_preserve_provider_arguments() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example { void run() {} }").unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    let intent = request.change_intent.as_mut().unwrap();
    intent.include_hierarchy = Some(true);
    assert!(intent.validate(RefactoringOperation::AddMethodParameter).unwrap_err().contains("external-consumer risk"));
    intent.accept_external_consumer_risk = Some(true);
    intent.validate(RefactoringOperation::AddMethodParameter).unwrap();
    let selection = selected_method(&context, &"c".repeat(64));
    let params = preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).unwrap();
    assert_eq!(params["arguments"], json!({
        "parameterType": "int", "parameterName": "count", "defaultExpression": "0",
        "includeHierarchy": "true", "acceptExternalConsumerRisk": "true"
    }));
    let serialized = serde_json::to_value(request.change_intent.as_ref().unwrap()).unwrap();
    assert_eq!(serialized["includeHierarchy"], true);
    assert_eq!(serialized["acceptExternalConsumerRisk"], true);
    let intent = request.change_intent.as_mut().unwrap();
    intent.operation = RefactoringOperation::RenameClass;
    intent.new_name = Some("Other".into());
    assert!(intent.validate(RefactoringOperation::RenameClass).unwrap_err().contains("Only parameter signature changes"));
}

#[test]
fn add_parameter_hierarchy_flags_refuse_string_booleans() {
    for field in ["includeHierarchy", "acceptExternalConsumerRisk"] {
        let mut value = json!({"operation":"add-method-parameter", "parameterType":"int", "parameterName":"extra", "defaultExpression":"10"});
        value[field] = json!("true");
        assert!(serde_json::from_value::<super::super::contract::RefactorKitChangeIntent>(value).is_err());
    }
}

#[test]
fn signature_hierarchy_variants_preserve_scope_and_require_risk_acceptance() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example { void run() {} }").unwrap();
    let context = f.context();
    for (operation, fields) in [
        (RefactoringOperation::ReorderMethodParameters, json!({"newOrder":"second,first"})),
        (RefactoringOperation::RemoveMethodParameter, json!({"parameterName":"second"})),
        (RefactoringOperation::ChangeMethodParameterType, json!({"parameterName":"second","newType":"long"})),
    ] {
        let mut request = add_parameter_request(&f, &context);
        request.operation = operation;
        let mut value = fields;
        value["operation"] = json!(operation.as_str());
        value["includeHierarchy"] = json!(true);
        request.change_intent = Some(serde_json::from_value(value).unwrap());
        let intent = request.change_intent.as_mut().unwrap();
        assert!(intent.validate(operation).unwrap_err().contains("external-consumer risk"));
        intent.accept_external_consumer_risk = Some(true);
        intent.validate(operation).unwrap();
        let selection = selected_method(&context, &"c".repeat(64));
        let params = preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).unwrap();
        assert_eq!(params["arguments"]["includeHierarchy"], "true");
        assert_eq!(params["arguments"]["acceptExternalConsumerRisk"], "true");
        assert_eq!(params["javaSelection"], selection);
    }
}


#[test]
fn add_parameter_functional_reference_migration_is_explicit_and_refuses_unsupported_combinations() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example { void run() {} }").unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.change_intent.as_mut().unwrap().migrate_functional_references = Some(true);
    let selection = selected_method(&context, &"c".repeat(64));
    let params = preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).unwrap();
    assert_eq!(params["arguments"]["migrateFunctionalReferences"], "true");
    let intent = request.change_intent.as_mut().unwrap();
    intent.include_hierarchy = Some(true);
    intent.accept_external_consumer_risk = Some(true);
    assert!(intent.validate(RefactoringOperation::AddMethodParameter).unwrap_err().contains("cannot be combined with hierarchy"));
    intent.include_hierarchy = None;
    intent.operation = RefactoringOperation::ReorderMethodParameters;
    intent.new_order = Some("second,first".into());
    assert!(intent.validate(RefactoringOperation::ReorderMethodParameters).unwrap_err().contains("Only Add Parameter"));
    let value = json!({"operation":"add-method-parameter","parameterType":"int","parameterName":"extra","defaultExpression":"0","migrateFunctionalReferences":"true"});
    assert!(serde_json::from_value::<super::super::contract::RefactorKitChangeIntent>(value).is_err());
}

#[test]
fn saved_constructor_selection_refusal_is_explained_without_a_plan_or_source_disclosure() {
    let f = Fixture::new();
    let context = f.context();
    let request = add_parameter_request(&f, &context);
    let raw = json!({"schemaVersion":1,"requestId":request.request_id,"kind":"mutationSelection","status":"refused",
        "snapshotHash":context.snapshot_hash,"indexGeneration":2,
        "error":{"code":"java.selection.constructorUnsupported","message":"private source /home/private/Token.java and credentials"}});
    let error = normalize_saved_mutation_selection(&raw, &request, &context, &f.project, "Example.java", 0, 17, &"c".repeat(64), "method").unwrap_err();
    assert!(error.contains("constructor targets"), "{error}");
    assert!(error.contains("No refactoring plan"), "{error}");
    assert!(!error.contains("/home/private"));
    assert!(!error.contains("credentials"));
}

#[test]
fn saved_constructor_selection_refusal_requires_its_correlated_envelope() {
    let f = Fixture::new();
    let context = f.context();
    let request = add_parameter_request(&f, &context);
    let baseline = json!({"schemaVersion":1,"requestId":request.request_id,"kind":"mutationSelection","status":"refused",
        "snapshotHash":context.snapshot_hash,"indexGeneration":2,"error":{"code":"java.selection.constructorUnsupported"}});
    for (field, value) in [("schemaVersion",json!(2)),("requestId",json!("other")),("snapshotHash",json!("different")),
        ("indexGeneration",json!(0)),("kind",json!("definition")),("status",json!("ready")),("error",json!({"code":"other.refusal"}))] {
        let mut raw = baseline.clone(); raw[field] = value;
        let error = normalize_saved_mutation_selection(&raw, &request, &context, &f.project, "Example.java", 0, 17, &"c".repeat(64), "method").unwrap_err();
        assert_eq!(error, PROTOCOL_FAILED, "{field}");
    }
}

#[test]
fn constructor_signature_selection_preserves_exact_provider_identity_for_each_operation() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example { Example(int first, int second) {} }").unwrap();
    let context = f.context();
    for (operation, fields) in [
        (RefactoringOperation::ChangeMethodSignature, json!({"oldParameter":"second","newParameter":"factor"})),
        (RefactoringOperation::AddMethodParameter, json!({"parameterType":"int","parameterName":"count","defaultExpression":"0","migrateFunctionalReferences":true})),
        (RefactoringOperation::ReorderMethodParameters, json!({"newOrder":"second,first"})),
        (RefactoringOperation::RemoveMethodParameter, json!({"parameterName":"second"})),
        (RefactoringOperation::ChangeMethodParameterType, json!({"parameterName":"second","newType":"long"})),
    ] {
        let mut request = add_parameter_request(&f, &context);
        request.operation = operation;
        let mut intent = fields; intent["operation"] = json!(operation.as_str());
        request.change_intent = Some(serde_json::from_value(intent).unwrap());
        let content_hash = "c".repeat(64);
        let mut raw = saved_selection_response(&context, &request, &content_hash);
        raw["selection"]["symbolKind"] = json!("constructor");
        raw["selection"]["symbolId"] = json!("Example#<init>(int,int)");
        raw["selection"]["bindingKey"] = json!("constructor-binding-key");
        let selection = normalize_saved_mutation_selection(&raw, &request, &context, &f.project, "Example.java", 0, 17, &content_hash, "method").unwrap();
        let params = preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).unwrap();
        assert_eq!(params["symbol"], "Example#<init>(int,int)");
        assert_eq!(params["javaSelection"], raw["selection"]);
        assert_eq!(params["javaSelection"]["bindingKey"], "constructor-binding-key");
        if operation == RefactoringOperation::AddMethodParameter {
            assert_eq!(params["arguments"]["migrateFunctionalReferences"], "true");
        } else {
            assert!(params["arguments"].get("migrateFunctionalReferences").is_none());
        }
    }
}

#[test]
fn constructor_selection_refuses_method_only_operations_after_validating_attestation() {
    let f = Fixture::new();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::MakeStatic;
    request.change_intent = None;
    let content_hash = "c".repeat(64);
    let mut raw = saved_selection_response(&context, &request, &content_hash);
    raw["selection"]["symbolKind"] = json!("constructor");
    let error = normalize_saved_mutation_selection(&raw, &request, &context, &f.project, "Example.java", 0, 17, &content_hash, "method").unwrap_err();
    assert!(error.contains("requires a Java method declaration"), "{error}");
    raw["selection"]["contentSha256"] = json!("d".repeat(64));
    let error = normalize_saved_mutation_selection(&raw, &request, &context, &f.project, "Example.java", 0, 17, &content_hash, "method").unwrap_err();
    assert!(!error.contains("requires a Java method declaration"));
}

#[test]
fn field_type_change_preserves_attested_field_identity_and_refuses_unbound_targets() {
    let f = Fixture::new();
    fs::write(f.project.join("Example.java"), "class Example { private int value = 1; }").unwrap();
    let context = f.context();
    let mut request = add_parameter_request(&f, &context);
    request.operation = RefactoringOperation::ChangeFieldType;
    request.change_intent = Some(serde_json::from_value(json!({"operation":"change-field-type","newType":"long"})).unwrap());
    let content_hash = "c".repeat(64);
    let mut raw = saved_selection_response(&context, &request, &content_hash);
    raw["selection"]["symbolKind"] = json!("field");
    raw["selection"]["symbolId"] = json!("Example#value");
    raw["selection"]["bindingKey"] = json!("exact-field-binding");
    let selection = normalize_saved_mutation_selection(&raw, &request, &context, &f.project, "Example.java", 0, 17, &content_hash, "field").unwrap();
    let params = preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).unwrap();
    assert_eq!(params["operation"], "changeType");
    assert_eq!(params["symbol"], "Example#value");
    assert_eq!(params["arguments"]["file"], "Example.java");
    assert_eq!(params["arguments"]["bindingKey"], "exact-field-binding");
    assert_eq!(params["arguments"]["newType"], "long");
    assert_eq!(params["javaSelection"], selection);
    assert!(preview_params_with_selection(&request, &f.project, Path::new("/sdk"), None).is_err());
    for (field,value) in [("symbolKind",json!("method")),("bindingKey",json!("")),("contentSha256",json!("d".repeat(64))), ("contextHash",json!("stale"))] {
        let mut invalid = raw.clone(); invalid["selection"][field] = value;
        assert!(normalize_saved_mutation_selection(&invalid, &request, &context, &f.project, "Example.java", 0, 17, &content_hash, "field").is_err(), "{field}");
    }
    request.target.identity = "Example#value".into();
    assert!(preview_params_with_selection(&request, &f.project, Path::new("/sdk"), Some(&selection)).is_err());
    request.change_intent.as_mut().unwrap().new_type = Some(" ".into());
    assert!(request.change_intent.as_ref().unwrap().validate(RefactoringOperation::ChangeFieldType).is_err());
}

#[test]
fn gradle_module_rename_requires_explicit_bounded_authority_and_maps_exact_settings() {
    let f = Fixture::new();
    fs::write(f.project.join("settings.gradle"), "include 'old'\n").unwrap();
    let mut context = f.context();
    context.gradle = Some(serde_json::from_value(json!({"executable":"/opt/gradle/bin/gradle","userHome":"","projectProperties":{}})).unwrap());
    let mut request: EnginePreviewRequest = serde_json::from_value(json!({"operation":"rename-gradle-module",
        "target":{"kind":"file","path":"maven/settings.gradle","identity":"maven/settings.gradle"},
        "authority":{"workspaceId":f.binding.workspace_id,"workspaceGeneration":1},"selectionGeneration":1,"requestId":"gradle-rename",
        "changeIntent":{"operation":"rename-gradle-module","buildRoot":"maven","oldProjectPath":":old","newProjectPath":":new"},"projectContext":context})).unwrap();
    let params = preview_params_with_workspace_root(&request, &f.project, &f.root, Path::new("/sdk"), None).unwrap();
    assert_eq!(params["operation"], "renameGradleModule");
    assert_eq!(params["arguments"], json!({"buildRoot":".","oldProjectPath":":old","newProjectPath":":new"}));
    assert!(params.get("symbol").is_none());
    assert_eq!(params["javaContext"]["expectedContextHash"], context.context_hash);
    request.target.path = "maven/build.gradle".into(); request.target.identity = request.target.path.clone();
    assert!(preview_params_with_workspace_root(&request, &f.project, &f.root, Path::new("/sdk"), None).is_err());
    let method = json!({"name":"java.renameGradleModule","stability":"experimental","requiresProject":true,"writesWorkspace":false,
        "features":{"preview":true,"renderedDiff":true,"apply":true,"rollback":true,"literalSettingsOnly":true,
            "preservePhysicalProjectDirectory":true,"explicitGradleSyncRequired":true,"inboundProjectDependenciesRefused":true}});
    let mut caps = capabilities(); caps["methods"].as_array_mut().unwrap().push(method);
    for feature in ["preview","apply","rollback"] { assert!(offered(&caps, "java.renameGradleModule", feature)); }
    for flag in ["preview","renderedDiff","apply","rollback","literalSettingsOnly","preservePhysicalProjectDirectory","explicitGradleSyncRequired","inboundProjectDependenciesRefused"] {
        let mut invalid = caps.clone(); invalid["methods"].as_array_mut().unwrap().last_mut().unwrap()["features"][flag] = json!(false);
        assert!(!offered(&invalid, "java.renameGradleModule", "preview"), "{flag}");
        assert!(!offered(&invalid, "java.renameGradleModule", "apply"), "{flag}");
    }
    let method = caps["methods"].as_array_mut().unwrap().last_mut().unwrap();
    let features = method["features"].as_object_mut().unwrap();
    features.remove("inboundProjectDependenciesRefused");
    features.insert("literalInboundProjectDependencies".into(), json!(true));
    assert!(!offered(&caps, "java.renameGradleModule", "preview"));
    caps["methods"].as_array_mut().unwrap().last_mut().unwrap()["features"]
        ["unqualifiedInboundProjectDependenciesRefused"] = json!(true);
    for feature in ["preview", "apply", "rollback"] {
        assert!(offered(&caps, "java.renameGradleModule", feature));
    }
}
