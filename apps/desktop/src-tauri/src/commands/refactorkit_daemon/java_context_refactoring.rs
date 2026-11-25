//! SDK-bound Java plans. RefactorKit owns semantic analysis, edits and transactions.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::app_config::workspace_registry_path;
use crate::commands::java_execution::maven_runtime::MavenRuntime;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, CurrentWorkspaceBinding,
};
use crate::workspace::workspace_root;

use super::application::{lock, validate_refactoring_target, RefactorKitDaemonState};
use super::capability_policy::{
    batch_formatter_profile_offered, evidence_blocks_managed_mutation, move_class_target_module_selection_offered,
    normalize_java_context_refactoring, normalize_language_kernel,
    safe_delete_reference_analysis_offered,
};
use super::contract::{validate_id, JavaCleanupOperation, RefactorKitChangeIntent, RefactoringOperation, MAX_SOURCE_BYTES, PROTOCOL_FAILED};
use super::java_project_context::{attach_maven_runtime, validate_operation_settings};
use super::path_policy::{require_generation, safe_path};
use super::real_engine::{
    EngineApplyRequest, EngineDiscardRequest, EnginePreviewRequest, EngineRollbackRequest,
};
use super::transport::{
    session_call_detailed, spawn_session, terminate, Session, SessionCallError, SessionCallErrorKind,
    PARAMETER_REMOVAL_EFFECTS_MESSAGE, REQUEST_TIMEOUT,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectContext {
    project_path: String,
    sdk_home: String,
    maven_repository: String,
    active_maven_profiles: Vec<String>,
    inactive_maven_profiles: Vec<String>,
    snapshot_hash: String,
    context_hash: String,
    context_schema_version: String,
    platform_identities: Vec<String>,
    pub(super) gradle: Option<super::java_project_context::GradleSettings>,
}

#[derive(Clone)]
pub(super) struct Plan {
    pub(super) guard: Value,
    pub(super) files: Vec<Value>,
    pub(super) eligible: bool,
    selection_hash: Option<String>,
    formatter_profile_sha256: Option<String>,
    pub(super) project_session_id: Option<u64>,
}

#[derive(Clone)]
pub(super) struct Transaction {
    binding: CurrentWorkspaceBinding,
    generation: u64,
    operation: RefactoringOperation,
    context: ProjectContext,
    project: PathBuf,
    sdk: PathBuf,
    committed_snapshot: String,
    rollback_files: Vec<Value>,
    project_session_id: Option<u64>,
}

pub(super) struct Active {
    session: Session,
    binding: CurrentWorkspaceBinding,
    generation: u64,
    context: ProjectContext,
    sdk: PathBuf,
    capabilities: Value,
    maven_runtime: Option<MavenRuntime>,
    plans: HashMap<String, Plan>,
}

pub(super) fn has_retained_plan_id(
    state: &RefactorKitDaemonState,
    plan_id: &str,
) -> Result<bool, String> {
    let manager = lock(state)?;
    Ok(manager
        .java_refactoring
        .as_ref()
        .is_some_and(|active| active.plans.contains_key(plan_id)))
}

impl Drop for Active {
    fn drop(&mut self) {
        terminate(&mut self.session.child);
    }
}
impl Active {
    pub(super) fn discard(&mut self, request: &EngineDiscardRequest) -> Result<bool, String> {
        let Some(plan) = self.plans.get(&request.plan_id) else {
            return Ok(false);
        };
        if plan.guard["workspaceId"] != request.authority.workspace_id
            || plan.guard["workspaceGeneration"] != request.authority.workspace_generation
            || plan.guard["selectionGeneration"] != request.selection_generation
            || plan.guard["requestId"] != request.request_id
        {
            return Err("The SDK-bound Java plan discard authority changed.".into());
        }
        self.plans.remove(&request.plan_id);
        let response = rpc(
            &mut self.session,
            "refactor.discard",
            json!({"planId": request.plan_id}),
        )?;
        if response["discarded"] != true || response["planId"] != request.plan_id {
            return Err(PROTOCOL_FAILED.into());
        }
        Ok(true)
    }
}

fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn normalize_safe_delete_reference_analysis(
    raw: &Value,
    request: &EnginePreviewRequest,
) -> Result<Option<Value>, String> {
    if request.operation != RefactoringOperation::SafeDelete {
        return if raw.get("referenceAnalysis").is_some() {
            Err(PROTOCOL_FAILED.into())
        } else {
            Ok(None)
        };
    }
    let context = request.project_context.as_ref().ok_or(PROTOCOL_FAILED)?;
    let Some(analysis) = raw
        .get("referenceAnalysis")
        .filter(|value| !value.is_null())
    else {
        return Ok(None);
    };
    let input_count = &analysis["inputCount"];
    let verified_bytes = &analysis["verifiedBytes"];
    let input_count_valid =
        input_count.is_null() || input_count.as_u64().is_some_and(|value| value <= 8_192);
    let verified_bytes_valid = verified_bytes.is_null()
        || verified_bytes
            .as_u64()
            .is_some_and(|value| value <= 32 * 1024 * 1024);
    let status = analysis["status"].as_str();
    if analysis["schemaVersion"] != "java-safe-delete-reference-analysis-v1"
        || analysis["operation"] != "safeDelete"
        || analysis["scope"] != "workspace-text-v1"
        || !matches!(status, Some("complete" | "incomplete"))
        || !input_count_valid
        || !verified_bytes_valid
        || (status == Some("complete") && (input_count.is_null() || verified_bytes.is_null()))
        || analysis["snapshotHash"] != context.snapshot_hash
        || !analysis["snapshotHash"].as_str().is_some_and(hash)
        || analysis["managedApplyAuthority"] != "none"
        || analysis["completeProject"] != false
        || analysis["referenceClosure"] != "incomplete"
    {
        return Err(PROTOCOL_FAILED.into());
    }
    Ok(Some(json!({
        "schemaVersion":"java-safe-delete-reference-analysis-v1",
        "operation":"safeDelete",
        "scope":"workspace-text-v1",
        "status":status,
        "inputCount":input_count,
        "verifiedBytes":verified_bytes,
        "snapshotHash":context.snapshot_hash,
        "managedApplyAuthority":"none",
        "completeProject":false,
        "referenceClosure":"incomplete"
    })))
}

fn normalize_typed_reference_analysis(
    raw: &Value,
    request: &EnginePreviewRequest,
    context: &ProjectContext,
    project: &Path,
    root: &Path,
) -> Result<Option<Value>, String> {
    let Some(analysis) = raw
        .get("referenceAnalysis")
        .filter(|value| !value.is_null())
    else {
        return Ok(None);
    };
    if request.operation != RefactoringOperation::RenameMember
        || analysis["schemaVersion"] != "refactorkit-reference-analysis-v1"
    {
        return Err(PROTOCOL_FAILED.into());
    }
    let scope = text(analysis, "scope", 256)?;
    let completeness = text(analysis, "completeness", 32)?;
    let managed_write_authority = text(analysis, "managedWriteAuthority", 32)?;
    if scope.is_empty()
        || !matches!(completeness, "COMPLETE" | "INCOMPLETE" | "UNRESOLVED")
        || !matches!(managed_write_authority, "none" | "managed-stable")
    {
        return Err(PROTOCOL_FAILED.into());
    }
    let complete_project = analysis["completeProject"]
        .as_bool()
        .ok_or(PROTOCOL_FAILED)?;
    let mut references = Vec::new();
    let mut analysis_target: Option<(String, String)> = None;
    for reference in items(analysis, "references")? {
        let language_id = text(reference, "languageId", 64)?;
        let kind = text(reference, "kind", 128)?;
        let target_owner = text(reference, "targetOwner", 512)?;
        let target_member = text(reference, "targetMember", 512)?;
        let resource_kind = text(reference, "resourceKind", 128)?;
        let provenance = text(reference, "provenance", 256)?;
        let reference_completeness = text(reference, "completeness", 32)?;
        if language_id != "java"
            || !matches!(
                kind,
                "symbol" | "framework.entity-property" | "configuration.value"
            )
            || !matches!(
                resource_kind,
                "source"
                    | "java.annotation-string"
                    | "xml"
                    | "yaml"
                    | "properties"
                    | "build-descriptor"
                    | "generated-source"
                    | "other"
            )
            || !matches!(
                reference_completeness,
                "COMPLETE" | "INCOMPLETE" | "UNRESOLVED"
            )
            || target_owner.is_empty()
            || target_member.is_empty()
            || !namespaced_reference_provenance(provenance)
        {
            return Err(PROTOCOL_FAILED.into());
        }
        let target = (target_owner.to_owned(), target_member.to_owned());
        if analysis_target
            .as_ref()
            .is_some_and(|previous| previous != &target)
        {
            return Err(PROTOCOL_FAILED.into());
        }
        analysis_target.get_or_insert(target);

        let location = &reference["location"];
        let path = workspace_path(text(location, "path", 4096)?, context, project, root)?;
        let range = &location["range"];
        let start = &range["start"];
        let end = &range["end"];
        let start_line = start["line"].as_u64().ok_or(PROTOCOL_FAILED)?;
        let start_character = start["character"].as_u64().ok_or(PROTOCOL_FAILED)?;
        let end_line = end["line"].as_u64().ok_or(PROTOCOL_FAILED)?;
        let end_character = end["character"].as_u64().ok_or(PROTOCOL_FAILED)?;
        const MAX_SOURCE_COORDINATE: u64 = 2_147_483_647;
        if [start_line, start_character, end_line, end_character]
            .iter()
            .any(|value| *value > MAX_SOURCE_COORDINATE)
            || (end_line, end_character) < (start_line, start_character)
        {
            return Err(PROTOCOL_FAILED.into());
        }
        references.push(json!({
            "languageId": language_id,
            "kind": kind,
            "targetOwner": target_owner,
            "targetMember": target_member,
            "location": {
                "path": path,
                "range": {
                    "start": {"line": start_line, "character": start_character},
                    "end": {"line": end_line, "character": end_character}
                }
            },
            "resourceKind": resource_kind,
            "provenance": provenance,
            "completeness": reference_completeness
        }));
    }
    let warnings = strings(analysis, "warnings")?;
    Ok(Some(json!({
        "schemaVersion": "refactorkit-reference-analysis-v1",
        "scope": scope,
        "completeness": completeness,
        "completeProject": complete_project,
        "managedWriteAuthority": managed_write_authority,
        "references": references,
        "warnings": warnings
    })))
}

fn namespaced_reference_provenance(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_lowercase()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn normalize_reference_analysis(
    raw: &Value,
    request: &EnginePreviewRequest,
    context: &ProjectContext,
    project: &Path,
    root: &Path,
) -> Result<Option<Value>, String> {
    if request.operation == RefactoringOperation::SafeDelete {
        return normalize_safe_delete_reference_analysis(raw, request);
    }
    normalize_typed_reference_analysis(raw, request, context, project, root)
}

fn validate_safe_delete_reference_analysis_advertisement(
    raw: &Value,
    capabilities: &Value,
    operation: &str,
) -> Result<(), String> {
    if operation == "safeDelete"
        && safe_delete_reference_analysis_offered(capabilities)
        && raw.get("referenceAnalysis").is_none_or(Value::is_null)
    {
        return Err(PROTOCOL_FAILED.into());
    }
    Ok(())
}

fn operation(operation: RefactoringOperation) -> Result<&'static str, String> {
    match operation {
        RefactoringOperation::CreateMavenModule => Ok("java.createMavenModule"),
        RefactoringOperation::CreateGradleModule => Ok("java.createGradleModule"),
        RefactoringOperation::RenameGradleModule => Ok("java.renameGradleModule"),
        RefactoringOperation::RenameClass => Ok("renameClass"),
        RefactoringOperation::RenameMember => Ok("renameMember"),
        RefactoringOperation::MoveClass => Ok("moveClass"),
        RefactoringOperation::MovePackage => Ok("movePackage"),
        RefactoringOperation::MoveSourceRoot => Ok("moveSourceRoot"),
        RefactoringOperation::ChangeMethodSignature => Ok("changeSignature.renameParameter"),
        RefactoringOperation::ChangeMethodParameterType => {
            Ok("changeSignature.changeParameterType")
        }
        RefactoringOperation::AddMethodParameter => Ok("changeSignature.addParameter"),
        RefactoringOperation::RemoveMethodParameter => Ok("changeSignature.removeParameter"),
        RefactoringOperation::ReorderMethodParameters => Ok("changeSignature.reorderParameters"),
        RefactoringOperation::MakeStatic => Ok("makeStatic"),
        RefactoringOperation::MakePublic => Ok("changeVisibility"),
        RefactoringOperation::ChangeFieldType => Ok("changeType"),
        RefactoringOperation::ExtractConstant => Ok("extractConstant"),
        RefactoringOperation::ExtractVariable => Ok("extractVariable"),
        RefactoringOperation::ExtractMethod => Ok("extractMethod"),
        RefactoringOperation::ExtractParameter => Ok("extractParameter"),
        RefactoringOperation::ExtractField => Ok("extractField"),
        RefactoringOperation::ExtractInterface => Ok("extractInterface"),
        RefactoringOperation::ExtractSuperclass => Ok("extractSuperclass"),
        RefactoringOperation::PullUpMember => Ok("pullUpMember"),
        RefactoringOperation::PushDownMember => Ok("pushDownMember"),
        RefactoringOperation::MoveMember => Ok("moveMember"),
        RefactoringOperation::InlineVariable => Ok("inlineVariable"),
        RefactoringOperation::InlineMethod => Ok("inlineMethod"),
        RefactoringOperation::IntroduceParameterObject => Ok("introduceParameterObject"),
        RefactoringOperation::ExtractDelegate => Ok("extractDelegate"),
        RefactoringOperation::InlineConstant => Ok("inlineConstant"),
        RefactoringOperation::EncapsulateField => Ok("encapsulateField"),
        RefactoringOperation::SafeDelete => Ok("safeDelete"),
        RefactoringOperation::BatchCleanup => Ok("batchCleanup"),
        RefactoringOperation::FormatFile => Ok("formatFile"),
        RefactoringOperation::OrganizeImports => Ok("organizeImports"),
        RefactoringOperation::RenameLocalVariable => {
            Err("RefactorKit does not advertise SDK-bound local-variable rename.".into())
        }
    }
}
fn rpc(session: &mut Session, method: &str, params: Value) -> Result<Value, String> {
    session_call_detailed(session, method, params, REQUEST_TIMEOUT)
        .map_err(|error| rpc_error_message(method, &error))
}
fn rpc_error_message(method: &str, error: &SessionCallError) -> String {
    if error.kind == SessionCallErrorKind::Rejected {
        let reason = if method == "refactor.preview"
            && error.rpc_code == Some(-32001)
            && error.rpc_refusal_code.as_deref()
                == Some("java.changeSignature.removedArgumentMayHaveEffects")
        {
            Some(PARAMETER_REMOVAL_EFFECTS_MESSAGE)
        } else {
            error.rpc_message.as_deref()
        };
        rpc_rejection_message(method, error.rpc_code, reason)
    } else {
        "The Java refactoring daemon is unavailable or returned an invalid response.".into()
    }
}
fn preserve_gradle_context_after_preview_refusal(
    operation: RefactoringOperation,
    error: &SessionCallError,
) -> bool {
    error.kind == SessionCallErrorKind::Rejected
        && error.rpc_code == Some(-32001)
        && !error.rpc_message.as_deref().is_some_and(is_stale_project_snapshot_reason)
        && matches!(
            (operation, error.rpc_refusal_code.as_deref()),
            (RefactoringOperation::MoveClass, Some("java.moveClass.gradleCompilerOutputsMissing"))
                | (RefactoringOperation::ExtractDelegate, Some("java.extractDelegate.dependencyUnsupported"))
        )
}
fn rpc_rejection_message(method: &str, rpc_code: Option<i64>, reason: Option<&str>) -> String {
    if method == "project.open" && reason.is_some_and(is_stale_project_snapshot_reason) {
        return "Project inputs changed; synchronize and preview again.".into();
    }
    if method == "refactor.preview" {
        if let Some(reason) = reason {
            let reason = reason.trim_end_matches(['.', '!', '?']);
            if is_stale_project_snapshot_reason(reason) {
                return "Project inputs changed; synchronize and preview again.".into();
            }
            return format!(
                "RefactorKit refused this Java operation{}. {reason}. No source changes were made.",
                rpc_code
                    .map(|code| format!(" (JSON-RPC error {code})"))
                    .unwrap_or_default()
            );
        }
        return format!(
            "RefactorKit refused this Java operation{}. No source changes were made.",
            rpc_code
                .map(|code| format!(" (JSON-RPC error {code})"))
                .unwrap_or_default()
        );
    }
    "RefactorKit refused this Java operation. Synchronize and review a new plan.".into()
}
fn is_stale_project_snapshot_reason(reason: &str) -> bool {
    let normalized = reason.to_ascii_lowercase();
    [
        "project inputs changed",
        "snapshot changed",
        "snapshot is stale",
        "snapshot stale",
        "snapshotstale",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}
fn binding(workspace_id: &str, generation: u64) -> Result<CurrentWorkspaceBinding, String> {
    require_generation(generation)?;
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    if binding.workspace_id != workspace_id {
        return Err("The Java workspace changed.".into());
    }
    Ok(binding)
}
fn validate(
    context: &ProjectContext,
    binding: &CurrentWorkspaceBinding,
    generation: u64,
) -> Result<(PathBuf, PathBuf), String> {
    if !hash(&context.snapshot_hash)
        || context.gradle.as_ref().is_some_and(|s| !s.valid())
        || !hash(&context.context_hash)
        || !super::java_project_context::valid_context_schema_version(
            &context.context_schema_version,
        )
        || context.platform_identities.is_empty()
        || context.platform_identities.len() > 256
        || context.platform_identities.iter().any(|v| !hash(v))
    {
        return Err("Invalid saved Java project-context authority.".into());
    }
    validate_operation_settings(
        binding,
        generation,
        &context.context_schema_version,
        &context.project_path,
        &context.sdk_home,
        &context.maven_repository,
        &context.active_maven_profiles,
        &context.inactive_maven_profiles,
    )
}
fn offered(capabilities: &Value, operation: &str, feature: &str) -> bool {
    if feature == "apply"
        && operation == "safeDelete"
        && capabilities["safeDeleteReferenceAnalysis"] != "complete-project"
    {
        return false;
    }
    let create_maven_module = operation == "java.createMavenModule";
    let create_gradle_module = operation == "java.createGradleModule";
    let rename_gradle_module = operation == "java.renameGradleModule";
    let create_module = create_maven_module || create_gradle_module || rename_gradle_module;
    let advertisement =
        normalize_java_context_refactoring(capabilities.get("javaContextRefactoring"))
            .ok()
            .flatten();
    if !create_module && advertisement.is_none() {
        return false;
    }
    let operation_advertised = if create_module {
        let method_name = if create_maven_module {
            "java.createMavenModule"
        } else if rename_gradle_module {
            "java.renameGradleModule"
        } else {
            "java.createGradleModule"
        };
        capabilities["methods"].as_array().is_some_and(|methods| {
            let matches = methods
                .iter()
                .filter(|method| method["name"] == method_name)
                .collect::<Vec<_>>();
            let [method] = matches.as_slice() else {
                return false;
            };
            let features = &method["features"];
            let safe_inbound_dependencies = features["inboundProjectDependenciesRefused"] == true
                || (features["literalInboundProjectDependencies"] == true
                    && features["unqualifiedInboundProjectDependenciesRefused"] == true);
            let bounded_gradle_rename = method["writesWorkspace"] == false
                && safe_inbound_dependencies
                && ["apply", "rollback", "literalSettingsOnly", "preservePhysicalProjectDirectory", "explicitGradleSyncRequired"]
                    .iter().all(|key| features[*key] == true);
            (method["stability"] == "stable" || (rename_gradle_module && method["stability"].as_str().is_some_and(|s| ["experimental", "preview"].contains(&s))))
                && (!rename_gradle_module || bounded_gradle_rename)
                && method["requiresProject"] == true
                && features["preview"] == true
                && features["renderedDiff"] == true
                && features[feature] == true
                && (!create_gradle_module
                    || (features["apply"] == true
                        && features["rollback"] == true
                        && features["workspaceRelativeBuildRoot"] == true
                        && features["canonicalNestedProjectPath"] == true
                        && features["settingsInferredDsl"] == true))
        })
    } else {
        advertisement.as_ref().unwrap()["operations"]
            .as_array()
            .is_some_and(|ops| ops.iter().any(|v| v == operation))
    };
    capabilities["apiVersion"] == "0.2"
        && (create_module || advertisement.as_ref().unwrap()["renderedDiff"] == true)
        && operation_advertised
        && capabilities["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|m| {
                m["name"] == "project.context"
                    && m["features"]["javaRefactoringsUseContextAuthority"] == true
                    && m["features"]["managedMutationAuthority"] == true
            }) && methods.iter().any(|m| {
                m["name"]
                    == if feature == "rollback" {
                        "patch.rollback".to_string()
                    } else {
                        format!("refactor.{feature}")
                    }
                    && m["requiresProject"] == true
                    && m["writesWorkspace"] == (feature != "preview")
            })
        })
        && (feature != "rollback"
            || create_module
            || advertisement.as_ref().unwrap()["rollbackAuthority"] == true)
        && (feature == "preview"
            || create_module
            || operation_has_managed_authority(capabilities, operation))
}
fn operation_has_managed_authority(capabilities: &Value, operation: &str) -> bool {
    normalize_language_kernel(&capabilities["languageKernel"])
        .ok()
        .is_some_and(|schema| {
            schema.adapters.iter().any(|adapter| {
                adapter.language_id == "java"
                    && adapter.capabilities.iter().any(|capability| {
                        capability.operation == operation
                            && capability.stability == "stable"
                            && capability.mutation_authority == "managed-stable"
                            && !evidence_blocks_managed_mutation(capability.evidence)
                    })
            })
        })
}
fn enforce_apply_advertisement(result: &mut Value, capabilities: &Value, operation: &str) {
    if result["applyEligibility"]["eligible"] != true || offered(capabilities, operation, "apply") {
        return;
    }
    result["applyEligibility"]["eligible"] = json!(false);
    if let Some(blockers) = result["applyEligibility"]["blockers"].as_array_mut() {
        let blocker = if operation == "safeDelete"
            && capabilities["safeDeleteReferenceAnalysis"] != "complete-project"
        {
            "Safe Delete requires complete-project reference analysis before Apply."
        } else {
            "RefactorKit does not advertise stable managed Apply authority for this Java operation."
        };
        blockers.push(json!(blocker));
    }
}
fn guard(request: &EnginePreviewRequest) -> Value {
    json!({"operation": request.operation, "target": request.target, "changeIntent": request.change_intent,
        "formatterProfile": request.formatter_profile, "workspaceId": request.authority.workspace_id, "workspaceGeneration": request.authority.workspace_generation,
        "selectionGeneration": request.selection_generation, "requestId": request.request_id, "projectContext": request.project_context})
}

fn current_formatter_profile_hash(
    root: &Path,
    profile: Option<&crate::commands::java_language::JavaLanguageFormatterProfile>,
) -> Result<Option<String>, String> {
    profile
        .map(|profile| {
            crate::commands::java_language::formatter_profile_payload(root, profile)
                .map(|(_, _, _, hash)| hash)
        })
        .transpose()
}

fn formats_java_files(
    operation: RefactoringOperation,
    intent: Option<&RefactorKitChangeIntent>,
) -> bool {
    operation == RefactoringOperation::FormatFile
        || (operation == RefactoringOperation::BatchCleanup
            && intent.is_some_and(|intent| {
                intent.operation == operation
                    && intent.actions.as_ref().is_some_and(|actions| {
                        actions
                            .iter()
                            .any(|action| action.operation == JavaCleanupOperation::FormatFile)
                    })
            }))
}

fn authorize_batch_formatter_profile(
    capabilities: &Value,
    operation: RefactoringOperation,
    selected: bool,
) -> Result<(), String> {
    if selected
        && operation == RefactoringOperation::BatchCleanup
        && !batch_formatter_profile_offered(capabilities)
    {
        return Err(
            "RefactorKit does not advertise Java Cleanup with an Eclipse formatter profile.".into(),
        );
    }
    Ok(())
}

fn validate_formatter_profile_approval(
    root: &Path,
    request: &EngineApplyRequest,
    retained_hash: Option<&str>,
) -> Result<Option<String>, String> {
    if !formats_java_files(request.operation, request.change_intent.as_ref())
        && (request.formatter_profile.is_some() || request.formatter_profile_sha256.is_some())
    {
        return Err("Eclipse formatter profile approval requires a Java formatting action.".into());
    }
    match (
        request.formatter_profile.as_ref(),
        request.formatter_profile_sha256.as_deref(),
        retained_hash,
    ) {
        (None, None, None) => Ok(None),
        (Some(profile), Some(supplied), Some(retained)) => {
            if !hash(supplied) || supplied != retained {
                return Err("The selected Eclipse formatter profile changed after preview.".into());
            }
            let current = current_formatter_profile_hash(root, Some(profile))
                .map_err(|_| "The selected Eclipse formatter profile changed after preview.")?
                .ok_or_else(|| PROTOCOL_FAILED.to_string())?;
            if current != supplied {
                return Err("The selected Eclipse formatter profile changed after preview.".into());
            }
            Ok(Some(supplied.to_owned()))
        }
        _ => Err(
            "Apply requires the exact Eclipse formatter profile selected for its preview.".into(),
        ),
    }
}
fn java_context_authority(context: &ProjectContext, sdk: &Path) -> Value {
    json!({"sdkHome": sdk, "expectedContextHash": context.context_hash,
        "contextSchemaVersion": context.context_schema_version})
}

fn selection_query_offered(capabilities: &Value) -> bool {
    capabilities["apiVersion"] == "0.2"
        && capabilities["javaContextRefactoring"]["selectionQueryKind"] == "mutationSelection"
        && capabilities["javaContextRefactoring"]["selectionSchemaVersion"]
            == "java-mutation-selection-v1"
        && capabilities["methods"].as_array().is_some_and(|methods| {
            methods
                .iter()
                .filter(|method| method["name"] == "intelligence.query")
                .count()
                == 1
                && methods.iter().any(|method| {
                    method["name"] == "intelligence.query"
                        && method["requiresProject"] == true
                        && method["writesWorkspace"] == false
                })
        })
}

fn bounded_nonempty<'a>(value: &'a Value, key: &str, limit: usize) -> Option<&'a str> {
    value[key]
        .as_str()
        .filter(|text| !text.is_empty() && text.len() <= limit && !text.contains('\0'))
}

fn saved_mutation_selection(
    request: &EnginePreviewRequest,
    context: &ProjectContext,
    project: &Path,
    sdk: &Path,
    capabilities: &Value,
    session: &mut Session,
) -> Result<Option<Value>, String> {
    let cursor_saved_mutation = matches!(
        request.operation,
        RefactoringOperation::RenameMember
            | RefactoringOperation::ChangeMethodSignature
            | RefactoringOperation::ChangeMethodParameterType
            | RefactoringOperation::RemoveMethodParameter
            | RefactoringOperation::ReorderMethodParameters
            | RefactoringOperation::MakeStatic
            | RefactoringOperation::MakePublic
            | RefactoringOperation::ChangeFieldType
            | RefactoringOperation::ExtractInterface
            | RefactoringOperation::ExtractSuperclass
            | RefactoringOperation::PullUpMember
            | RefactoringOperation::PushDownMember
            | RefactoringOperation::MoveMember
            | RefactoringOperation::InlineMethod
            | RefactoringOperation::IntroduceParameterObject
            | RefactoringOperation::ExtractDelegate
    ) && request.target.identity == "@cursor";
    if request.operation != RefactoringOperation::AddMethodParameter && !cursor_saved_mutation {
        return Ok(None);
    }
    if !selection_query_offered(capabilities) {
        return Err("RefactorKit does not advertise saved-source Java method selection.".into());
    }
    let selection = request
        .target
        .selection
        .as_ref()
        .filter(|selection| selection.start == selection.end)
        .ok_or("This cursor refactoring requires an exact saved Java method selection.")?;
    let expected_target_kind = if matches!(
        request.operation,
        RefactoringOperation::ExtractInterface | RefactoringOperation::ExtractSuperclass
    ) {
        "class"
    } else {
        "member"
    };
    if request.target.kind != expected_target_kind || request.target.identity != "@cursor" {
        return Err(
            if request.operation == RefactoringOperation::ExtractInterface {
                "Extract Interface requires a Java class target.".into()
            } else if request.operation == RefactoringOperation::ExtractSuperclass {
                "Extract Superclass requires a Java class target.".into()
            } else {
                "This cursor refactoring requires a Java method target.".into()
            },
        );
    }
    let prefix = if context.project_path.is_empty() {
        String::new()
    } else {
        format!("{}/", context.project_path)
    };
    let path = request
        .target
        .path
        .strip_prefix(&prefix)
        .ok_or("The Java cursor is outside the selected project.")?;
    let path = safe_path(path, project)?;
    if !path.ends_with(".java") {
        return Err("This cursor refactoring requires a Java source file.".into());
    }
    let source_path = project
        .join(&path)
        .canonicalize()
        .map_err(|_| "The saved Java source is unavailable.")?;
    if !source_path.starts_with(project) {
        return Err("The saved Java source is outside the selected project.".into());
    }
    let metadata =
        fs::metadata(&source_path).map_err(|_| "The saved Java source is unavailable.")?;
    if metadata.len() > MAX_SOURCE_BYTES as u64 {
        return Err("The saved Java source exceeds the supported size limit.".into());
    }
    let source = fs::read_to_string(&source_path)
        .map_err(|_| "The saved Java source is unavailable or not valid UTF-8.")?;
    let (line, character) = utf16_position(&source, selection.start)?;
    let content_hash = super::java_navigation::digest(source.as_bytes());
    let request_id = &request.request_id;
    let raw = rpc(
        session,
        "intelligence.query",
        json!({
            "requestId": request_id,
            "kind": "mutationSelection",
            "languageId": "java",
            "path": path,
            "position": {"line": line, "character": character},
            "expectedSnapshotHash": context.snapshot_hash,
            "sourceAuthority": {"kind": "saved-snapshot"},
            "javaContext": java_context_authority(context, sdk),
            "limit": 1,
            "priority": "interactive"
        }),
    )?;
    normalize_saved_mutation_selection(
        &raw,
        request,
        context,
        project,
        &path,
        line,
        character,
        &content_hash,
        if matches!(
            request.operation,
            RefactoringOperation::ExtractInterface | RefactoringOperation::ExtractSuperclass
        ) {
            "class"
        } else if request.operation == RefactoringOperation::ChangeFieldType {
            "field"
        } else if request.operation == RefactoringOperation::RenameMember {
            "member"
        } else {
            "method"
        },
    )
    .map(Some)
}

fn saved_move_member_target_selection(
    request: &EnginePreviewRequest,
    context: &ProjectContext,
    project: &Path,
    sdk: &Path,
    capabilities: &Value,
    session: &mut Session,
) -> Result<Option<Value>, String> {
    if request.operation != RefactoringOperation::MoveMember {
        return Ok(None);
    }
    if request.target.kind != "member" || request.target.identity != "@cursor" {
        return Err("Move Member requires an exact saved Java method cursor selection.".into());
    }
    if !selection_query_offered(capabilities) {
        return Err("RefactorKit does not advertise saved-source Java type selection.".into());
    }
    let intent = request
        .change_intent
        .as_ref()
        .ok_or("Move Member requires a destination type selection.")?;
    intent.validate(request.operation)?;
    let target_path = intent.target_path.as_deref().ok_or(PROTOCOL_FAILED)?;
    let prefix = if context.project_path.is_empty() {
        String::new()
    } else {
        format!("{}/", context.project_path)
    };
    let project_relative_path = target_path
        .strip_prefix(&prefix)
        .ok_or("The Move Member destination is outside the selected project.")?;
    let path = safe_path(project_relative_path, project)?;
    let source_target = request
        .target
        .path
        .strip_prefix(&prefix)
        .ok_or("The selected method is outside the selected project.")?;
    if path != source_target || !path.ends_with(".java") {
        return Err(
            "Move Member requires a destination type in the selected method's source file.".into(),
        );
    }
    let source_path = project
        .join(&path)
        .canonicalize()
        .map_err(|_| "The saved Java destination source is unavailable.")?;
    if !source_path.starts_with(project) {
        return Err("The saved Java destination source is outside the selected project.".into());
    }
    let metadata = fs::metadata(&source_path)
        .map_err(|_| "The saved Java destination source is unavailable.")?;
    if metadata.len() > MAX_SOURCE_BYTES as u64 {
        return Err("The saved Java destination source exceeds the supported size limit.".into());
    }
    let source = fs::read_to_string(&source_path)
        .map_err(|_| "The saved Java destination source is unavailable or invalid UTF-8.")?;
    let position = intent.target_position.as_ref().ok_or(PROTOCOL_FAILED)?;
    if !valid_utf16_position(&source, position.line, position.character) {
        return Err(
            "The Move Member destination selection is outside the saved Java source.".into(),
        );
    }
    let line = usize::try_from(position.line)
        .map_err(|_| "The Move Member destination line is outside the supported range.")?;
    let character = usize::try_from(position.character)
        .map_err(|_| "The Move Member destination column is outside the supported range.")?;
    let content_hash = super::java_navigation::digest(source.as_bytes());
    let raw = rpc(
        session,
        "intelligence.query",
        json!({
            "requestId": request.request_id,
            "kind": "mutationSelection",
            "languageId": "java",
            "path": path,
            "position": {"line": position.line, "character": position.character},
            "expectedSnapshotHash": context.snapshot_hash,
            "sourceAuthority": {"kind": "saved-snapshot"},
            "javaContext": java_context_authority(context, sdk),
            "limit": 1,
            "priority": "interactive"
        }),
    )?;
    normalize_saved_mutation_selection(
        &raw,
        request,
        context,
        project,
        &path,
        line,
        character,
        &content_hash,
        "class",
    )
    .map(Some)
}

fn valid_utf16_position(source: &str, line: u64, character: u64) -> bool {
    let Some(source_line) = source.split('\n').nth(line as usize) else {
        return false;
    };
    let source_line = source_line.strip_suffix('\r').unwrap_or(source_line);
    let mut offset = 0_u64;
    for scalar in source_line.chars() {
        if offset == character {
            return true;
        }
        offset += scalar.len_utf16() as u64;
        if offset > character {
            return false;
        }
    }
    offset == character
}

fn accepts_constructor_signature(operation: RefactoringOperation) -> bool {
    matches!(operation,
        RefactoringOperation::ChangeMethodSignature
        | RefactoringOperation::AddMethodParameter
        | RefactoringOperation::ReorderMethodParameters
        | RefactoringOperation::RemoveMethodParameter
        | RefactoringOperation::ChangeMethodParameterType)
}

fn is_signature_selection(selected: &Value, operation: RefactoringOperation) -> bool {
    selected["symbolKind"] == "method"
        || (selected["symbolKind"] == "constructor" && accepts_constructor_signature(operation))
}

fn normalize_saved_mutation_selection(
    raw: &Value,
    request: &EnginePreviewRequest,
    context: &ProjectContext,
    project: &Path,
    path: &str,
    line: usize,
    character: usize,
    content_hash: &str,
    expected_symbol_kind: &str,
) -> Result<Value, String> {
    if raw["schemaVersion"] == 1
        && raw["requestId"] == request.request_id
        && raw["kind"] == "mutationSelection"
        && raw["status"] == "refused"
        && raw["snapshotHash"] == context.snapshot_hash
        && raw["indexGeneration"].as_u64().is_some_and(|generation| generation > 0)
        && raw["error"]["code"] == "java.selection.constructorUnsupported"
    {
        return Err("RefactorKit refused this Java operation. The provider does not support constructor targets through this saved-cursor route. No refactoring plan was created. No source changes were made.".into());
    }
    let selected = &raw["selection"];
    let declaration_path = selected["declaration"]["path"]
        .as_str()
        .filter(|value| value.len() <= 4096)
        .ok_or(PROTOCOL_FAILED)?;
    safe_path(declaration_path, project)?;
    if raw["schemaVersion"] != 1
        || raw["requestId"] != request.request_id
        || raw["kind"] != "mutationSelection"
        || raw["status"] != "ready"
        || raw["snapshotHash"] != context.snapshot_hash
        || raw["indexGeneration"]
            .as_u64()
            .is_none_or(|generation| generation == 0)
        || raw["providerId"] != "java-jdt-bindings-v1"
        || raw["backend"] != "eclipse-jdt-3.44-bindings-v1"
        || raw["evidence"] != "compiler"
        || raw["completeness"] != "semantic"
        || !bounded_nonempty(&raw, "provenanceHash", 64).is_some_and(hash)
        || raw["contextHash"] != context.context_hash
        || raw["contextSchemaVersion"] != context.context_schema_version
        || raw["platformIdentities"] != json!(context.platform_identities)
        || raw["sourceAuthority"]["kind"] != "saved-snapshot"
        || raw["sourceAuthority"]["path"] != path
        || raw["sourceAuthority"]["contentSha256"] != content_hash
        || selected["schemaVersion"] != "java-mutation-selection-v1"
        || selected["snapshotHash"] != context.snapshot_hash
        || selected["contextHash"] != context.context_hash
        || selected["path"] != path
        || selected["position"] != json!({"line": line, "character": character})
        || selected["contentSha256"] != content_hash
        || selected["provenanceHash"] != raw["provenanceHash"]
        || !bounded_nonempty(selected, "selectorHash", 64).is_some_and(hash)
        || bounded_nonempty(selected, "symbolId", 4096).is_none()
        || bounded_nonempty(selected, "bindingKey", 8192).is_none()
        || selected["declaration"]["range"]["start"]["line"]
            .as_u64()
            .is_none()
        || selected["declaration"]["range"]["start"]["character"]
            .as_u64()
            .is_none()
        || selected["declaration"]["range"]["end"]["line"]
            .as_u64()
            .is_none()
        || selected["declaration"]["range"]["end"]["character"]
            .as_u64()
            .is_none()
    {
        return Err(
            if expected_symbol_kind == "field" {
                "RefactorKit did not attest a current saved Java field selection.".into()
            } else if expected_symbol_kind == "class" {
                "RefactorKit did not attest a current saved Java class selection.".into()
            } else {
                "RefactorKit did not attest a current saved Java method selection.".into()
            },
        );
    }
    let matches_kind = if expected_symbol_kind == "member" {
        matches!(selected["symbolKind"].as_str(), Some("field" | "method"))
    } else {
        selected["symbolKind"] == expected_symbol_kind
    };
    if !matches_kind {
        if expected_symbol_kind == "method" && selected["symbolKind"] == "constructor" {
            if !accepts_constructor_signature(request.operation) {
                return Err("RefactorKit refused this Java operation. This operation requires a Java method declaration. No refactoring plan was created. No source changes were made.".into());
            }
        } else {
            return Err(if expected_symbol_kind == "member" {
                "RefactorKit did not attest a current saved Java member selection.".into()
            } else if expected_symbol_kind == "field" {
                "RefactorKit did not attest a current saved Java field selection.".into()
            } else if expected_symbol_kind == "class" {
                "RefactorKit did not attest a current saved Java class selection.".into()
            } else {
                "RefactorKit did not attest a current saved Java method selection.".into()
            });
        }
    }
    Ok(selected.clone())
}

fn batch_cleanup_actions(
    request: &EnginePreviewRequest,
    project: &Path,
) -> Result<Vec<Value>, String> {
    let context = request.project_context.as_ref().ok_or(PROTOCOL_FAILED)?;
    let intent = request
        .change_intent
        .as_ref()
        .ok_or("Select the Java cleanup files first.")?;
    intent.validate(RefactoringOperation::BatchCleanup)?;
    let actions = intent.actions.as_ref().ok_or(PROTOCOL_FAILED)?;
    if request.target.kind != "file"
        || request.target.identity != request.target.path
        || request.target.selection.is_some()
        || actions
            .first()
            .is_none_or(|action| action.path != request.target.path)
    {
        return Err("Batch cleanup must be anchored to its first selected Java file.".into());
    }
    let prefix = if context.project_path.is_empty() {
        String::new()
    } else {
        format!("{}/", context.project_path)
    };
    let mut canonical_targets = std::collections::HashSet::new();
    actions
        .iter()
        .map(|action| {
            let path = action
                .path
                .strip_prefix(&prefix)
                .ok_or("A cleanup file is outside the selected project.")?;
            safe_path(path, project)?;
            let canonical = project
                .join(path)
                .canonicalize()
                .map_err(|_| "A selected cleanup source is unavailable.")?;
            crate::workspace::ensure_within_root(project, &canonical)
                .map_err(|_| "A cleanup source escapes the selected project.")?;
            if !canonical.is_file() {
                return Err("Select saved Java files for cleanup.".into());
            }
            if !canonical_targets.insert(canonical) {
                return Err(
                    "Batch cleanup cannot target the same saved file through aliases.".into(),
                );
            }
            let operation = match action.operation {
                super::contract::JavaCleanupOperation::FormatFile => "formatFile",
                super::contract::JavaCleanupOperation::OrganizeImports => "organizeImports",
            };
            Ok(json!({"operation":operation,"arguments":{"file":path}}))
        })
        .collect()
}

#[cfg(test)]
fn preview_params(
    request: &EnginePreviewRequest,
    project: &Path,
    sdk: &Path,
) -> Result<Value, String> {
    preview_params_with_selection(request, project, sdk, None)
}

#[cfg(test)]
fn preview_params_with_selection(
    request: &EnginePreviewRequest,
    project: &Path,
    sdk: &Path,
    java_selection: Option<&Value>,
) -> Result<Value, String> {
    preview_params_with_workspace_root(request, project, project, sdk, java_selection)
}

#[cfg(test)]
fn preview_params_with_workspace_root(
    request: &EnginePreviewRequest,
    project: &Path,
    workspace_root: &Path,
    sdk: &Path,
    java_selection: Option<&Value>,
) -> Result<Value, String> {
    preview_params_with_workspace_root_and_target(
        request,
        project,
        workspace_root,
        sdk,
        java_selection,
        None,
    )
}

fn preview_params_with_workspace_root_and_target(
    request: &EnginePreviewRequest,
    project: &Path,
    workspace_root: &Path,
    sdk: &Path,
    java_selection: Option<&Value>,
    target_selection: Option<&Value>,
) -> Result<Value, String> {
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing Java project context.")?;
    let provider_operation = match request.operation {
        RefactoringOperation::CreateMavenModule => "createMavenModule",
        RefactoringOperation::CreateGradleModule => "createGradleModule",
        RefactoringOperation::RenameGradleModule => "renameGradleModule",
        other => operation(other)?,
    };
    let prefix = if context.project_path.is_empty() {
        String::new()
    } else {
        format!("{}/", context.project_path)
    };
    let path = if matches!(request.operation, RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule) {
        request.target.path.as_str()
    } else {
        request
            .target
            .path
            .strip_prefix(&prefix)
            .ok_or("The Java target is outside the selected project.")?
    };
    if matches!(request.operation, RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule) {
        let intent = request
            .change_intent
            .as_ref()
            .ok_or("The Java operation requires mutation intent.")?;
        intent.validate(request.operation)?;
        let build_root = intent.build_root.as_deref().ok_or(PROTOCOL_FAILED)?;
        let settings_prefix = if build_root == "." {
            String::new()
        } else {
            format!("{build_root}/")
        };
        if request.target.kind != "file"
            || request.target.identity != request.target.path
            || !path.starts_with(&settings_prefix)
            || !matches!(
                path.strip_prefix(&settings_prefix),
                Some("settings.gradle" | "settings.gradle.kts")
            )
        {
            return Err(
                "Gradle module creation requires the exact settings file for its selected build root."
                    .into(),
            );
        }
        safe_path(path, workspace_root)?;
    } else {
        safe_path(path, project)?;
    }
    if request.operation == RefactoringOperation::CreateMavenModule {
        if context.gradle.is_some() {
            return Err(
                "Maven module creation requires a synchronized Maven project context.".into(),
            );
        }
        if request.target.kind != "file"
            || request.target.identity != request.target.path
            || !(path == "pom.xml" || path.ends_with("/pom.xml"))
        {
            return Err(
                "Maven module creation requires an exact synchronized parent POM target.".into(),
            );
        }
    }
    let file_operation = matches!(
        request.operation,
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports
    );
    if file_operation
        && (request.target.kind != "file" || request.target.identity != request.target.path)
    {
        return Err("Java formatting and imports require an exact saved file target.".into());
    }
    if request.formatter_profile.is_some() && !formats_java_files(request.operation, request.change_intent.as_ref())
    {
        return Err("Eclipse formatter profiles require a Java formatting action.".into());
    }
    let move_source_root = request.operation == RefactoringOperation::MoveSourceRoot;
    if move_source_root
        && (request.target.kind != "source-root" || request.target.identity != request.target.path)
    {
        return Err("Java source-root moves require an exact source-root target.".into());
    }
    let move_package = request.operation == RefactoringOperation::MovePackage;
    if move_package
        && (request.target.kind != "package"
            || request.target.identity
                != request
                    .change_intent
                    .as_ref()
                    .and_then(|intent| intent.from_package.as_deref())
                    .unwrap_or_default())
    {
        return Err(
            "Java package moves require an exact package target matching fromPackage.".into(),
        );
    }
    if request.operation == RefactoringOperation::EncapsulateField
        && (request.target.kind != "member"
            || request.target.identity == "@cursor"
            || request.target.selection.is_some())
    {
        return Err(
            "Encapsulate Field requires an exact Java field target without a selection.".into(),
        );
    }
    let extract_selection = matches!(
        request.operation,
        RefactoringOperation::ExtractConstant
            | RefactoringOperation::ExtractVariable
            | RefactoringOperation::ExtractMethod
            | RefactoringOperation::ExtractParameter
            | RefactoringOperation::ExtractField
    );
    let inline_identifier = matches!(
        request.operation,
        RefactoringOperation::InlineVariable | RefactoringOperation::InlineConstant
    );
    let cursor_reorder = request.operation == RefactoringOperation::ReorderMethodParameters
        && request.target.identity == "@cursor";
    let cursor_member_rename = request.operation == RefactoringOperation::RenameMember
        && request.target.identity == "@cursor";
    let cursor_parameter_rename = request.operation == RefactoringOperation::ChangeMethodSignature
        && request.target.identity == "@cursor";
    let cursor_parameter_type_change = request.operation
        == RefactoringOperation::ChangeMethodParameterType
        && request.target.identity == "@cursor";
    let cursor_parameter_removal = request.operation == RefactoringOperation::RemoveMethodParameter
        && request.target.identity == "@cursor";
    let cursor_make_static = request.operation == RefactoringOperation::MakeStatic
        && request.target.identity == "@cursor";
    let cursor_field_type = request.operation == RefactoringOperation::ChangeFieldType && request.target.identity == "@cursor";
    let cursor_make_public = request.operation == RefactoringOperation::MakePublic
        && request.target.identity == "@cursor";
    let cursor_bound_method = matches!(
        request.operation,
        RefactoringOperation::InlineMethod
            | RefactoringOperation::IntroduceParameterObject
            | RefactoringOperation::ExtractDelegate
    ) && request.target.identity == "@cursor";
    let cursor_extract_interface = request.operation == RefactoringOperation::ExtractInterface
        && request.target.identity == "@cursor";
    let cursor_extract_superclass = request.operation == RefactoringOperation::ExtractSuperclass
        && request.target.identity == "@cursor";
    if extract_selection
        && (request.target.kind != "file"
            || request.target.identity != request.target.path
            || request
                .target
                .selection
                .as_ref()
                .map_or(true, |selection| selection.start >= selection.end))
    {
        return Err(format!(
            "{} requires an exact saved Java file and non-empty selection.",
            request.operation.as_str()
        ));
    }
    if inline_identifier {
        let expected_kind = if request.operation == RefactoringOperation::InlineVariable {
            "local-binding"
        } else {
            "member"
        };
        let selection = request
            .target
            .selection
            .as_ref()
            .ok_or("Inline operations require an exact selected Java identifier.")?;
        if request.target.kind != expected_kind
            || request.target.identity == "@cursor"
            || selection.start >= selection.end
        {
            return Err("Inline operations require the exact selected Java identifier.".into());
        }
        let source_path = project
            .join(path)
            .canonicalize()
            .map_err(|_| "Inline operations could not read the saved Java source.")?;
        let project_root = project
            .canonicalize()
            .map_err(|_| "The selected Java project is unavailable.")?;
        if !source_path.starts_with(&project_root) {
            return Err("Inline source is outside the selected Java project.".into());
        }
        let source = fs::read_to_string(&source_path)
            .map_err(|_| "Inline operations could not read the saved Java source.")?;
        if selected_utf16_slice(&source, selection.start, selection.end)? != request.target.identity
        {
            return Err("The selected Java identifier changed before preview.".into());
        }
    }
    let intent = request.change_intent.as_ref();
    if super::contract::refactor_operation_requires_intent(request.operation) {
        intent
            .ok_or("The Java operation requires mutation intent.")?
            .validate(request.operation)?;
    } else if intent.is_some() {
        return Err("This Java operation does not accept mutation intent.".into());
    }
    let mut arguments = json!({});
    if matches!(request.operation, RefactoringOperation::AddMethodParameter | RefactoringOperation::RemoveMethodParameter |
        RefactoringOperation::ReorderMethodParameters | RefactoringOperation::ChangeMethodParameterType) {
        let intent = intent.ok_or("Signature changes require change intent.")?;
        if intent.include_hierarchy == Some(true) { arguments["includeHierarchy"] = json!("true"); }
        if intent.accept_external_consumer_risk == Some(true) { arguments["acceptExternalConsumerRisk"] = json!("true"); }
    }
    match request.operation {
        RefactoringOperation::CreateMavenModule => {
            arguments["moduleName"] = json!(intent.unwrap().module_name);
            arguments["parentPom"] = json!(path);
        }
        RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule => {
            let intent = intent.unwrap();
            let build_root = intent.build_root.as_deref().ok_or(PROTOCOL_FAILED)?;
            if request.operation == RefactoringOperation::RenameGradleModule {
                arguments["oldProjectPath"] = json!(intent.old_project_path.as_deref().ok_or(PROTOCOL_FAILED)?);
                arguments["newProjectPath"] = json!(intent.new_project_path.as_deref().ok_or(PROTOCOL_FAILED)?);
            } else {
                arguments["projectPath"] = json!(intent.project_path.as_deref().ok_or(PROTOCOL_FAILED)?);
            }
            let workspace_build_root = if build_root == "." {
                PathBuf::new()
            } else {
                PathBuf::from(safe_path(build_root, workspace_root)?)
            };
            let project_workspace_path = if context.project_path.is_empty() {
                PathBuf::new()
            } else {
                PathBuf::from(safe_path(&context.project_path, workspace_root)?)
            };
            let project_build_root = if project_workspace_path.as_os_str().is_empty() {
                workspace_build_root.as_path()
            } else {
                workspace_build_root
                    .strip_prefix(&project_workspace_path)
                    .map_err(|_| {
                        "The selected Gradle build is outside the synchronized project root."
                    })?
            };
            let project_build_root = if project_build_root.as_os_str().is_empty() {
                ".".to_string()
            } else {
                project_build_root.to_string_lossy().replace('\\', "/")
            };
            arguments["buildRoot"] = json!(project_build_root);
        }
        RefactoringOperation::RenameClass | RefactoringOperation::RenameMember => {
            if cursor_member_rename && java_selection.is_none() {
                return Err("Member rename requires the reviewed saved Java member selection.".into());
            }
            arguments["newName"] = json!(intent.unwrap().new_name)
        }
        RefactoringOperation::MoveClass => {
            let intent = intent.unwrap();
            if intent.target_path.is_some() {
                return Err(
                    "RefactorKit does not advertise explicit move-class destination paths.".into(),
                );
            }
            arguments["targetPackage"] = json!(intent.new_package);
            if let Some(module_id) = intent.target_module_id.as_deref() {
                arguments["targetModuleId"] = json!(module_id);
            }
        }
        RefactoringOperation::MovePackage => {
            arguments["fromPackage"] = json!(intent.unwrap().from_package);
            arguments["toPackage"] = json!(intent.unwrap().to_package);
        }
        RefactoringOperation::MoveSourceRoot => {
            let destination =
                safe_path(intent.unwrap().to.as_deref().unwrap_or_default(), project)?;
            arguments["from"] = json!(path);
            arguments["to"] = json!(destination);
        }
        RefactoringOperation::ChangeMethodSignature => {
            arguments["oldName"] = json!(intent.unwrap().old_parameter);
            arguments["newName"] = json!(intent.unwrap().new_parameter);
        }
        RefactoringOperation::ChangeMethodParameterType => {
            let selected = java_selection
                .ok_or("Parameter type change requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || !is_signature_selection(selected, request.operation)
                || selected["path"] != path
            {
                return Err(
                    "Parameter type change requires an exact saved Java method cursor selection."
                        .into(),
                );
            }
            let intent = intent.unwrap();
            arguments["parameterName"] = json!(intent.parameter_name);
            arguments["newType"] = json!(intent.new_type);
        }
        RefactoringOperation::AddMethodParameter => {
            let selected =
                java_selection.ok_or("Add Parameter requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || !is_signature_selection(selected, request.operation)
                || selected["path"] != path
            {
                return Err(
                    "Add Parameter requires an exact saved Java method cursor selection.".into(),
                );
            }
            let intent = intent.unwrap();
            arguments["parameterType"] = json!(intent.parameter_type);
            arguments["parameterName"] = json!(intent.parameter_name);
            arguments["defaultExpression"] = json!(intent.default_expression);
            if intent.migrate_functional_references == Some(true) {
                arguments["migrateFunctionalReferences"] = json!("true");
            }
        }
        RefactoringOperation::RemoveMethodParameter => {
            let selected =
                java_selection.ok_or("Remove Parameter requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || !is_signature_selection(selected, request.operation)
                || selected["path"] != path
            {
                return Err(
                    "Remove Parameter requires an exact saved Java method cursor selection.".into(),
                );
            }
            arguments["parameterName"] = json!(intent.unwrap().parameter_name);
        }
        RefactoringOperation::ReorderMethodParameters => {
            if cursor_reorder {
                let selected = java_selection
                    .ok_or("Parameter reordering requires a bound Java method selection.")?;
                if request.target.kind != "member"
                    || request
                        .target
                        .selection
                        .as_ref()
                        .is_none_or(|selection| selection.start != selection.end)
                    || !is_signature_selection(selected, request.operation)
                    || selected["path"] != path
                {
                    return Err(
                        "Parameter reordering requires an exact saved Java method cursor selection."
                            .into(),
                    );
                }
            }
            arguments["newOrder"] = json!(intent.unwrap().new_order);
        }
        RefactoringOperation::ChangeFieldType => {
            let selected = java_selection.ok_or("Field type change requires an exact saved Java field selection.")?;
            if !cursor_field_type || request.target.kind != "member"
                || request.target.selection.as_ref().is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "field" || selected["path"] != path
                || selected["declaration"]["path"] != path {
                return Err("Field type change requires an exact saved Java field cursor selection.".into());
            }
            arguments["file"] = json!(path);
            arguments["bindingKey"] = selected["bindingKey"].clone();
            arguments["newType"] = json!(intent.unwrap().new_type);
        }
        RefactoringOperation::MakeStatic => {
            let selected =
                java_selection.ok_or("Make Static requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "method"
                || selected["path"] != path
            {
                return Err(
                    "Make Static requires an exact saved Java method cursor selection.".into(),
                );
            }
        }
        RefactoringOperation::MakePublic => {
            let selected =
                java_selection.ok_or("Make Public requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "method"
                || selected["path"] != path
            {
                return Err(
                    "Make Public requires an exact saved Java method cursor selection.".into(),
                );
            }
            arguments["visibility"] = json!("public");
        }
        RefactoringOperation::InlineMethod
        | RefactoringOperation::IntroduceParameterObject
        | RefactoringOperation::ExtractDelegate => {
            let operation = match request.operation {
                RefactoringOperation::InlineMethod => "Inline Method",
                RefactoringOperation::IntroduceParameterObject => "Introduce Parameter Object",
                _ => "Extract Delegate",
            };
            let selected =
                java_selection.ok_or_else(|| format!("{operation} requires a bound Java method selection."))?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "method"
                || selected["path"] != path
            {
                return Err(
                    format!("{operation} requires an exact saved Java method cursor selection."),
                );
            }
            match request.operation {
                RefactoringOperation::IntroduceParameterObject => {
                    let intent = intent.unwrap();
                    arguments["typeName"] = json!(intent.type_name);
                    arguments["parameters"] = json!(intent.parameters);
                }
                RefactoringOperation::ExtractDelegate => {
                    let intent = intent.unwrap();
                    arguments["typeName"] = json!(intent.type_name);
                    arguments["members"] = json!(intent.members);
                }
                _ => arguments["file"] = json!(path),
            }
        }
        RefactoringOperation::ExtractInterface => {
            let selected =
                java_selection.ok_or("Extract Interface requires a bound Java class selection.")?;
            if request.target.kind != "class"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "class"
                || selected["path"] != path
            {
                return Err(
                    "Extract Interface requires an exact saved Java class cursor selection.".into(),
                );
            }
            let intent = intent.unwrap();
            arguments["file"] = json!(path);
            arguments["interfaceName"] = json!(intent.interface_name);
            arguments["methodName"] = json!(intent.method_name);
        }
        RefactoringOperation::ExtractSuperclass => {
            let selected = java_selection
                .ok_or("Extract Superclass requires a bound Java class selection.")?;
            if request.target.kind != "class"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "class"
                || selected["path"] != path
            {
                return Err(
                    "Extract Superclass requires an exact saved Java class cursor selection."
                        .into(),
                );
            }
            let intent = intent.unwrap();
            arguments["file"] = json!(path);
            arguments["superclassName"] = json!(intent.superclass_name);
            arguments["methodName"] = json!(intent.method_name);
        }
        RefactoringOperation::PullUpMember => {
            let selected =
                java_selection.ok_or("Pull Up Method requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "method"
                || selected["path"] != path
            {
                return Err(
                    "Pull Up Method requires an exact saved Java method cursor selection.".into(),
                );
            }
            let intent = intent.unwrap();
            arguments["file"] = json!(path);
            arguments["targetType"] = json!(intent.target_type);
        }
        RefactoringOperation::PushDownMember => {
            let selected =
                java_selection.ok_or("Push Down Method requires a bound Java method selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "method"
                || selected["path"] != path
            {
                return Err(
                    "Push Down Method requires an exact saved Java method cursor selection.".into(),
                );
            }
            let intent = intent.unwrap();
            arguments["file"] = json!(path);
            arguments["targetType"] = json!(intent.target_type);
        }
        RefactoringOperation::MoveMember => {
            let selected =
                java_selection.ok_or("Move Member requires a bound Java method selection.")?;
            let destination = target_selection
                .ok_or("Move Member requires a bound Java destination type selection.")?;
            if request.target.kind != "member"
                || request.target.identity != "@cursor"
                || request
                    .target
                    .selection
                    .as_ref()
                    .is_none_or(|selection| selection.start != selection.end)
                || selected["symbolKind"] != "method"
                || selected["path"] != path
                || destination["symbolKind"] != "class"
                || destination["path"] != path
            {
                return Err(
                    "Move Member requires exact saved method and destination type selections in one Java source file.".into(),
                );
            }
            let target_binding_key = destination["bindingKey"]
                .as_str()
                .filter(|value| !value.is_empty() && value.len() <= 8192)
                .ok_or(PROTOCOL_FAILED)?;
            let intent = intent.unwrap();
            arguments["file"] = json!(path);
            arguments["memberKind"] = json!("method");
            arguments["targetType"] = json!(intent.target_type);
            arguments["targetBindingKey"] = json!(target_binding_key);
        }
        RefactoringOperation::InlineVariable | RefactoringOperation::InlineConstant => {
            arguments["file"] = json!(path);
            arguments["name"] = json!(request.target.identity);
        }
        RefactoringOperation::ExtractConstant
        | RefactoringOperation::ExtractVariable
        | RefactoringOperation::ExtractMethod
        | RefactoringOperation::ExtractParameter
        | RefactoringOperation::ExtractField => {
            let operation_label = match request.operation {
                RefactoringOperation::ExtractConstant => "Extract Constant",
                RefactoringOperation::ExtractVariable => "Extract Variable",
                RefactoringOperation::ExtractMethod => "Extract Method",
                RefactoringOperation::ExtractParameter => "Extract Parameter",
                RefactoringOperation::ExtractField => "Extract Field",
                _ => unreachable!("selection extraction operation was matched above"),
            };
            let selection = request.target.selection.as_ref().unwrap();
            let source_path = project
                .join(path)
                .canonicalize()
                .map_err(|_| format!("{operation_label} could not read the saved Java source."))?;
            let project_root = project
                .canonicalize()
                .map_err(|_| "The selected Java project is unavailable.".to_string())?;
            if !source_path.starts_with(&project_root) {
                return Err(format!(
                    "{operation_label} source is outside the selected Java project."
                ));
            }
            let metadata = fs::metadata(&source_path)
                .map_err(|_| format!("{operation_label} could not read the saved Java source."))?;
            if metadata.len() > MAX_SOURCE_BYTES as u64 {
                return Err(format!(
                    "{operation_label} source exceeds the supported size limit."
                ));
            }
            let source = fs::read_to_string(&source_path)
                .map_err(|_| format!("{operation_label} could not read the saved Java source."))?;
            arguments["file"] = json!(path);
            if request.operation == RefactoringOperation::ExtractMethod {
                let (start_line, end_line) =
                    complete_line_range_selection(&source, selection.start, selection.end)?;
                arguments["startLine"] = json!(start_line);
                arguments["endLine"] = json!(end_line);
                arguments["methodName"] = json!(intent.unwrap().method_name);
            } else {
                let (start_line, start_character) = utf16_position(&source, selection.start)?;
                let (end_line, end_character) = utf16_position(&source, selection.end)?;
                arguments["startLine"] = json!(start_line);
                arguments["startCharacter"] = json!(start_character);
                arguments["endLine"] = json!(end_line);
                arguments["endCharacter"] = json!(end_character);
                arguments["name"] = json!(intent.unwrap().name);
            }
        }
        RefactoringOperation::BatchCleanup => {
            arguments["actions"] = json!(batch_cleanup_actions(request, project)?);
        }
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports => {
            arguments["file"] = json!(path)
        }
        RefactoringOperation::SafeDelete | RefactoringOperation::EncapsulateField => {}
        RefactoringOperation::RenameLocalVariable => {
            return Err("SDK-bound local-variable rename is unavailable.".into())
        }
    }
    let symbol = if request.operation == RefactoringOperation::AddMethodParameter
        || cursor_member_rename
        || cursor_parameter_rename
        || cursor_reorder
        || cursor_parameter_type_change
        || cursor_parameter_removal
        || cursor_make_static
        || cursor_make_public
        || cursor_field_type
        || cursor_bound_method
        || cursor_extract_interface
        || cursor_extract_superclass
        || request.operation == RefactoringOperation::PullUpMember
            && request.target.identity == "@cursor"
        || request.operation == RefactoringOperation::PushDownMember
            && request.target.identity == "@cursor"
        || request.operation == RefactoringOperation::MoveMember
            && request.target.identity == "@cursor"
    {
        java_selection
            .and_then(|selection| selection["symbolId"].as_str())
            .ok_or(PROTOCOL_FAILED)?
    } else if file_operation || move_source_root || extract_selection {
        path
    } else {
        &request.target.identity
    };
    let mut params = json!({"operation": provider_operation,
        "languageId": "java", "arguments": arguments, "expectedSnapshotHash": context.snapshot_hash,
        "javaContext": java_context_authority(context, sdk)});
    if !matches!(request.operation, RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule | RefactoringOperation::BatchCleanup) {
        params["symbol"] = json!(symbol);
    }
    if let Some(profile) = request.formatter_profile.as_ref() {
        let (path, profile_name, xml, _) =
            crate::commands::java_language::formatter_profile_payload(workspace_root, profile)?;
        params["formatterProfile"] = json!({"path":path,"profileName":profile_name,"xml":xml});
    }
    if let Some(selection) = java_selection
        .as_ref()
        .filter(|_| request.operation != RefactoringOperation::MakeStatic)
    {
        params["javaSelection"] = (*selection).clone();
    }
    Ok(params)
}

fn selected_utf16_slice(source: &str, start: u64, end: u64) -> Result<&str, String> {
    fn byte_offset(source: &str, offset: u64) -> Option<usize> {
        let mut utf16_offset = 0_u64;
        for (byte_offset, character) in source.char_indices() {
            if utf16_offset == offset {
                return Some(byte_offset);
            }
            utf16_offset = utf16_offset.checked_add(character.len_utf16() as u64)?;
        }
        (utf16_offset == offset).then_some(source.len())
    }

    if start >= end {
        return Err("Inline operations require a non-empty Java identifier selection.".into());
    }
    let start = byte_offset(source, start)
        .ok_or("The selected Java identifier splits a Unicode character.")?;
    let end = byte_offset(source, end)
        .ok_or("The selected Java identifier splits a Unicode character.")?;
    source
        .get(start..end)
        .ok_or_else(|| "The selected Java identifier is outside the saved source.".into())
}

fn utf16_position(source: &str, offset: u64) -> Result<(usize, usize), String> {
    let target = usize::try_from(offset).map_err(|_| PROTOCOL_FAILED.to_string())?;
    let mut units = 0usize;
    let mut line = 0usize;
    let mut character = 0usize;
    for scalar in source.chars() {
        if units == target {
            return Ok((line, character));
        }
        let width = scalar.len_utf16();
        if target < units + width {
            return Err("Selection boundary splits a UTF-16 surrogate pair.".into());
        }
        units += width;
        if scalar == '\n' {
            line += 1;
            character = 0;
        } else {
            character += width;
        }
    }
    if units == target {
        Ok((line, character))
    } else {
        Err("Selection is outside the saved Java source.".into())
    }
}

fn complete_line_range_selection(
    source: &str,
    start: u64,
    end: u64,
) -> Result<(usize, usize), String> {
    if start >= end {
        return Err("Extract Method requires a non-empty source selection.".into());
    }
    let (start_line, start_column) = utf16_position(source, start)?;
    let (end_line, end_column) = utf16_position(source, end)?;
    if start_line > end_line {
        return Err("Extract Method selection is outside the saved Java source.".into());
    }
    let mut selected_non_whitespace = false;

    for line in start_line..=end_line {
        let source_line = source.split('\n').nth(line).ok_or_else(|| {
            "Extract Method selection is outside the saved Java source.".to_string()
        })?;
        let source_line = source_line.strip_suffix('\r').unwrap_or(source_line);
        let line_start = if line == start_line { start_column } else { 0 };
        let line_end = if line == end_line {
            end_column
        } else {
            source_line.encode_utf16().count()
        };
        let mut units = 0usize;
        for character in source_line.chars() {
            let next = units + character.len_utf16();
            if next <= line_start {
                if !character.is_whitespace() {
                    return Err(
                        "Extract Method selection must include complete source lines.".into(),
                    );
                }
            } else if units >= line_end {
                if !character.is_whitespace() {
                    return Err(
                        "Extract Method selection must include complete source lines.".into(),
                    );
                }
            } else if units >= line_start && next <= line_end {
                selected_non_whitespace |= !character.is_whitespace();
            } else {
                return Err("Extract Method selection splits a Unicode character.".into());
            }
            units = next;
        }
        if line == end_line && line_end > units {
            return Err("Extract Method selection is outside the saved Java source.".into());
        }
    }
    if !selected_non_whitespace {
        return Err("Extract Method requires non-empty complete source lines.".into());
    }
    Ok((start_line + 1, end_line + 1))
}

fn items<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, String> {
    value[field]
        .as_array()
        .filter(|v| v.len() <= 512)
        .ok_or_else(|| PROTOCOL_FAILED.into())
}
fn text<'a>(value: &'a Value, field: &str, max: usize) -> Result<&'a str, String> {
    value[field]
        .as_str()
        .filter(|v| v.len() <= max && !v.contains('\0'))
        .ok_or_else(|| PROTOCOL_FAILED.into())
}
fn workspace_path(
    value: &str,
    context: &ProjectContext,
    project: &Path,
    root: &Path,
) -> Result<String, String> {
    let relative = safe_path(value, project)?;
    safe_path(
        &if context.project_path.is_empty() {
            relative
        } else {
            format!("{}/{}", context.project_path, relative)
        },
        root,
    )
}
fn diagnostics(
    raw: &Value,
    field: &str,
    context: &ProjectContext,
    project: &Path,
    root: &Path,
) -> Result<Vec<Value>, String> {
    items(raw, field)?
        .iter()
        .map(|diagnostic| {
            let severity = text(diagnostic, "severity", 32)?.to_ascii_lowercase();
            if !matches!(
                severity.as_str(),
                "error" | "warning" | "info" | "information" | "hint"
            ) {
                return Err(PROTOCOL_FAILED.into());
            }
            let severity = if severity == "info" {
                "information"
            } else {
                &severity
            };
            let mut result =
                json!({"severity": severity, "message": text(diagnostic, "message", 512*1024)?});
            if let Some(path) = diagnostic
                .get("file")
                .or_else(|| diagnostic.get("path"))
                .filter(|v| !v.is_null())
            {
                result["path"] = json!(workspace_path(
                    path.as_str().ok_or(PROTOCOL_FAILED)?,
                    context,
                    project,
                    root
                )?);
            }
            for field in ["line", "column"] {
                if let Some(value) = diagnostic.get(field).filter(|v| !v.is_null()) {
                    let point = value
                        .as_u64()
                        .filter(|v| *v > 0 && *v <= 9_007_199_254_740_991)
                        .ok_or(PROTOCOL_FAILED)?;
                    result[field] = json!(point);
                }
            }
            Ok(result)
        })
        .collect()
}
fn strings(value: &Value, field: &str) -> Result<Vec<String>, String> {
    items(value, field)?
        .iter()
        .map(|v| {
            v.as_str()
                .filter(|s| s.len() <= 512 * 1024 && !s.contains('\0'))
                .map(str::to_string)
                .ok_or_else(|| PROTOCOL_FAILED.into())
        })
        .collect()
}
#[cfg(test)]
fn normalize_preview(
    raw: &Value,
    request: &EnginePreviewRequest,
    project: &Path,
    root: &Path,
) -> Result<Value, String> {
    normalize_preview_with_selection(raw, request, project, root, None)
}

fn normalize_preview_with_selection(
    raw: &Value,
    request: &EnginePreviewRequest,
    project: &Path,
    root: &Path,
    selection_hash: Option<&str>,
) -> Result<Value, String> {
    let context = request.project_context.as_ref().unwrap();
    if raw["operation"] != operation(request.operation)?
        || raw["status"] != "PREVIEW"
        || raw["snapshot"]["hash"] != context.snapshot_hash
        || raw["snapshot"]["validatedOnApply"] != true
        || raw["contextHash"] != context.context_hash
        || raw["contextSchemaVersion"].as_str() != Some(context.context_schema_version.as_str())
        || raw["platformIdentities"] != json!(context.platform_identities)
    {
        return Err(
            "RefactorKit did not return a managed plan for the selected saved Java context.".into(),
        );
    }
    if let Some(expected) = selection_hash {
        if !hash(expected) || raw["selectionHash"] != expected {
            return Err("RefactorKit did not retain the reviewed Java selection.".into());
        }
    } else if matches!(
        request.operation,
        RefactoringOperation::AddMethodParameter
            | RefactoringOperation::IntroduceParameterObject
            | RefactoringOperation::ExtractDelegate
    )
        || (request.operation == RefactoringOperation::RenameMember
            && request.target.identity == "@cursor")
        || (request.operation == RefactoringOperation::RemoveMethodParameter
            && request.target.identity == "@cursor")
        || (request.operation == RefactoringOperation::ChangeMethodParameterType
            && request.target.identity == "@cursor")
        || (request.operation == RefactoringOperation::ReorderMethodParameters
            && request.target.identity == "@cursor")
    {
        return Err("This cursor refactoring requires a retained provider selection.".into());
    }
    let plan_id = text(raw, "planId", 256)?;
    validate_id(plan_id)?;
    let diff = text(raw, "renderedDiff", 512 * 1024)
        .map_err(|_| "RefactorKit has not supplied the retained plan's text diff. Update the daemon before reviewing an SDK-bound refactoring.")?;
    let truncated = raw["diffTruncated"]
        .as_bool()
        .ok_or("Missing provider diff completeness evidence.")?;
    let truncation_reasons = strings(raw, "diffTruncationReasons")?;
    let confidence = raw["confidence"]
        .as_f64()
        .filter(|v| (0.0..=1.0).contains(v))
        .ok_or(PROTOCOL_FAILED)?;
    let risk = text(raw, "riskLevel", 32)?.to_ascii_lowercase();
    if !matches!(risk.as_str(), "low" | "medium" | "high" | "unknown") {
        return Err(PROTOCOL_FAILED.into());
    }
    let mut files = Vec::new();
    for edit in items(raw, "structuredDiff")? {
        let old = workspace_path(text(edit, "path", 4096)?, context, project, root)?;
        let (change, path) = match text(edit, "type", 32)? {
            "createFile" => ("create", old.clone()),
            "modifyFile" => ("edit", old.clone()),
            "deleteFile" => ("delete", old.clone()),
            "renameFile" => (
                "move",
                workspace_path(text(edit, "newPath", 4096)?, context, project, root)?,
            ),
            _ => return Err(PROTOCOL_FAILED.into()),
        };
        let mut file = json!({"change": change, "path": path, "primary": false});
        if change == "move" {
            file["previousPath"] = json!(old);
        }
        files.push(file);
    }
    for path in items(raw, "affectedFiles")? {
        workspace_path(
            path.as_str().ok_or(PROTOCOL_FAILED)?,
            context,
            project,
            root,
        )?;
    }
    if matches!(
        request.operation,
        RefactoringOperation::FormatFile | RefactoringOperation::OrganizeImports
    ) && files
        .iter()
        .any(|file| file["change"] != "edit" || file["path"] != request.target.path)
    {
        return Err(
            "The Java file operation proposed changes outside its requested compilation unit."
                .into(),
        );
    }
    if request.operation == RefactoringOperation::BatchCleanup {
        batch_cleanup_actions(request, project)?;
        let selected: std::collections::HashSet<_> = request.change_intent.as_ref().unwrap()
            .actions.as_ref().unwrap().iter().map(|action| action.path.as_str()).collect();
        let changed: std::collections::HashSet<_> = files.iter().filter_map(|file| file["path"].as_str()).collect();
        let reported = items(raw, "affectedFiles")?.iter().map(|value| {
            workspace_path(value.as_str().ok_or(PROTOCOL_FAILED)?, context, project, root)
        }).collect::<Result<std::collections::HashSet<_>, _>>()?;
        let reported_paths: std::collections::HashSet<_> = reported.iter().map(String::as_str).collect();
        if risk != "low" || files.iter().any(|file| file["change"] != "edit") ||
            selected != changed || selected != reported_paths {
            return Err("The Java cleanup plan must edit exactly its selected saved files with low risk.".into());
        }
    }
    let has_changes = !files.is_empty();
    let provider = text(&raw["provider"], "name", 256)?;
    let provider_version = text(&raw["provider"], "version", 128)?;
    let evidence = text(raw, "evidence", 128)?;
    let evidence_blocks_apply = evidence_blocks_managed_mutation(&evidence);
    let reference_analysis = normalize_reference_analysis(raw, request, context, project, root)?;
    let provider_write_eligibility = raw
        .get("managedWriteEligibility")
        .map(|value| value.as_str().ok_or(PROTOCOL_FAILED))
        .transpose()?;
    if provider_write_eligibility.is_some_and(|value| !matches!(value, "ELIGIBLE" | "INELIGIBLE")) {
        return Err(PROTOCOL_FAILED.into());
    }
    let typed_analysis_blocks_apply = reference_analysis.as_ref().is_some_and(|analysis| {
        analysis["schemaVersion"] == "refactorkit-reference-analysis-v1"
            && (analysis["completeness"] != "COMPLETE"
                || analysis["completeProject"] != true
                || analysis["managedWriteAuthority"] != "managed-stable"
                || analysis["references"].as_array().is_none_or(|references| {
                    references
                        .iter()
                        .any(|reference| reference["completeness"] != "COMPLETE")
                }))
    });
    let mut blockers = Vec::new();
    if truncated {
        blockers.push(
            "The provider text diff is truncated. A complete preview is required before Apply.",
        );
    }
    if evidence_blocks_apply {
        blockers.push("The provider reports lexical or no semantic evidence; review is available but Apply is not.");
    }
    if provider_write_eligibility == Some("INELIGIBLE") || typed_analysis_blocks_apply {
        blockers.push("The provider reports incomplete typed reference analysis; managed Apply is unavailable.");
    }
    if !has_changes {
        blockers.push("The plan contains no source changes.");
    }
    let eligible = blockers.is_empty();
    if has_changes && diff.trim().is_empty() {
        return Err("RefactorKit has not supplied the reviewed plan's text diff.".into());
    }
    let formatter_profile = match request.formatter_profile.as_ref() {
        Some(profile) if formats_java_files(request.operation, request.change_intent.as_ref()) => {
            let (path, profile_name, _, sha256) =
                crate::commands::java_language::formatter_profile_payload(root, profile)?;
            if raw["formatterProfilePath"] != path
                || raw["formatterProfileName"] != profile_name
                || raw["formatterProfileSha256"] != sha256
            {
                return Err(
                    "RefactorKit did not attest the selected Eclipse formatter profile.".into(),
                );
            }
            Some((path, profile_name, sha256))
        }
        Some(_) => {
            return Err("Eclipse formatter profiles require a Java formatting action.".into())
        }
        None => {
            if !raw["formatterProfilePath"].is_null()
                || !raw["formatterProfileName"].is_null()
                || !raw["formatterProfileSha256"].is_null()
            {
                return Err(
                    "RefactorKit returned an unexpected Eclipse formatter profile attestation."
                        .into(),
                );
            }
            None
        }
    };
    let mut normalized = json!({"planId": plan_id, "operation": request.operation, "target": request.target,
        "status": "ready", "summary": text(raw, "summary", 512*1024)?, "confidence": confidence, "riskLevel": risk,
        "risks": [], "evidence": [{"kind": evidence, "summary": evidence}], "affectedFiles": files,
        "renderedDiff": diff, "diffTruncated": truncated, "diffTruncationReasons": truncation_reasons,
        "structuredDiff": [], "warnings": strings(raw, "warnings")?,
        "diagnosticsAfterPreview": diagnostics(raw, "diagnosticsAfterPreview", context, project, root)?,
        "conflicts": [], "refusalReasons": [], "applyEligibility": {"eligible": eligible, "blockers": blockers},
        "staleness": {"stale": false, "reasons": []}, "grantsApplyAuthority": false,
        "authority": {"workspaceId": request.authority.workspace_id, "workspaceGeneration": request.authority.workspace_generation},
        "selectionGeneration": request.selection_generation, "requestId": request.request_id,
        "provider": provider, "providerVersion": provider_version,
        "projectContext": {"projectPath": context.project_path, "contextHash": context.context_hash,
            "contextSchemaVersion": context.context_schema_version, "platformIdentities": context.platform_identities}});
    if let Some(reference_analysis) = reference_analysis {
        normalized["referenceAnalysis"] = reference_analysis;
    }
    if let Some((path, profile_name, sha256)) = formatter_profile {
        normalized["formatterProfilePath"] = json!(path);
        normalized["formatterProfileName"] = json!(profile_name);
        normalized["formatterProfileSha256"] = json!(sha256);
    }
    Ok(normalized)
}

fn validate_applied_selection(raw: &Value, expected: Option<&str>) -> Result<(), String> {
    if let Some(expected) = expected {
        if !hash(expected) || raw["appliedSelectionHash"] != expected {
            return Err("RefactorKit applied a different Java method selection.".into());
        }
    }
    Ok(())
}

pub(super) fn preview(
    request: EnginePreviewRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The workspace is unavailable.")?;
    preview_at(request, state, binding, &root)
}
pub(super) fn preview_at(
    request: EnginePreviewRequest,
    state: &RefactorKitDaemonState,
    binding: CurrentWorkspaceBinding,
    root: &Path,
) -> Result<Value, String> {
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing Java project context.")?;
    if matches!(request.operation, RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule) && context.gradle.is_none() {
        return Err(
            "Gradle module creation requires an explicitly synchronized Gradle context.".into(),
        );
    }
    let (project, sdk) = validate(context, &binding, request.authority.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    validate_refactoring_target(&root, &request.target)?;
    let mut manager = lock(state)?;
    if manager.java_refactoring.as_mut().is_some_and(|active| {
        active.binding != binding
            || active.generation != request.authority.workspace_generation
            || active.context != *context
            || active.session.child.try_wait().ok().flatten().is_some()
    }) {
        manager.java_refactoring.take();
    }
    if manager.java_refactoring.is_none() {
        let mut session = spawn_session(
            &request.authority.workspace_id,
            request.authority.workspace_generation,
            &project,
        )?;
        let capabilities = match rpc(&mut session, "server.capabilities", json!({})) {
            Ok(value) => value,
            Err(error) => {
                terminate(&mut session.child);
                return Err(error);
            }
        };
        manager.java_refactoring = Some(Active {
            session,
            binding: binding.clone(),
            generation: request.authority.workspace_generation,
            context: context.clone(),
            sdk,
            capabilities,
            maven_runtime: None,
            plans: HashMap::new(),
        });
    }
    let active = manager.java_refactoring.as_mut().unwrap();
    let operation_name = request.operation.as_str();
    authorize_batch_formatter_profile(&active.capabilities, request.operation, request.formatter_profile.is_some())?;
    if !offered(
        &active.capabilities,
        operation(request.operation)?,
        "preview",
    ) {
        super::java_project_context::trace_snapshot(
            "refactorkit.java.preview.failure",
            json!({"operation": operation_name, "phase": "capability-admission"}),
        );
        return Err(
            "RefactorKit does not advertise this SDK-bound Java refactoring operation.".into(),
        );
    }
    if request
        .change_intent
        .as_ref()
        .and_then(|intent| intent.target_module_id.as_ref())
        .is_some()
        && (request.operation != RefactoringOperation::MoveClass
            || !move_class_target_module_selection_offered(&active.capabilities))
    {
        return Err(
            "RefactorKit does not advertise the explicit move-class destination-module schema."
                .into(),
        );
    }
    let mut phase = "project-open";
    let response = (|| {
        let mut open = json!({"root": project, "resolveDependencies": false, "activeMavenProfiles": context.active_maven_profiles,
            "inactiveMavenProfiles": context.inactive_maven_profiles});
        if !context.maven_repository.is_empty() {
            open["mavenRepository"] = json!(context.maven_repository);
        }
        active.maven_runtime = attach_maven_runtime(&mut open, &active.capabilities, &project, root);
        active.plans.clear();
        let opened = rpc(&mut active.session, "project.open", open)?;
        let opened_root_matches = opened["root"]
            .as_str()
            .and_then(|v| Path::new(v).canonicalize().ok())
            .as_deref()
            == Some(&project);
        let opened_snapshot_matches = opened["snapshotHash"] == context.snapshot_hash;
        let workspace_binding_current = current_workspace_binding_is_current(&binding);
        super::java_project_context::trace_snapshot(
            "refactorkit.java.preview.project-open",
            json!({
                "operation": operation_name,
                "expectedSnapshotHash": context.snapshot_hash,
                "openedSnapshotHash": opened["snapshotHash"],
                "rootMatched": opened_root_matches,
                "snapshotMatched": opened_snapshot_matches,
                "workspaceBindingCurrent": workspace_binding_current
            }),
        );
        if !opened_root_matches || !opened_snapshot_matches || !workspace_binding_current {
            return Err("Project inputs changed; synchronize and preview again.".into());
        }
        phase = "mutation-selection";
        let java_selection = saved_mutation_selection(
            &request,
            context,
            &project,
            &active.sdk,
            &active.capabilities,
            &mut active.session,
        )?;
        let target_selection = saved_move_member_target_selection(
            &request,
            context,
            &project,
            &active.sdk,
            &active.capabilities,
            &mut active.session,
        )?;
        super::java_project_context::trace_snapshot(
            "refactorkit.java.preview.selection",
            json!({
                "operation": operation_name,
                "selectionResolved": java_selection.is_some(),
                "destinationSelectionResolved": target_selection.is_some()
            }),
        );
        let selection_hash = java_selection
            .as_ref()
            .filter(|_| request.operation != RefactoringOperation::MakeStatic)
            .and_then(|selection| selection["selectorHash"].as_str())
            .map(str::to_owned);
        let params = preview_params_with_workspace_root_and_target(
            &request,
            &project,
            &root,
            &active.sdk,
            java_selection.as_ref(),
            target_selection.as_ref(),
        )?;
        phase = "provider-preview";
        let raw = rpc(&mut active.session, "refactor.preview", params)?;
        validate_safe_delete_reference_analysis_advertisement(
            &raw,
            &active.capabilities,
            operation_name,
        )?;
        phase = "preview-normalization";
        let mut result = normalize_preview_with_selection(
            &raw,
            &request,
            &project,
            &root,
            selection_hash.as_deref(),
        )?;
        phase = "apply-admission";
        enforce_apply_advertisement(
            &mut result,
            &active.capabilities,
            operation(request.operation)?,
        );
        phase = "workspace-recheck";
        if !current_workspace_binding_is_current(&binding) {
            return Err("The Java workspace changed during preview.".into());
        }
        active.plans.insert(
            result["planId"].as_str().unwrap().into(),
            Plan {
                guard: guard(&request),
                files: result["affectedFiles"].as_array().unwrap().clone(),
                eligible: result["applyEligibility"]["eligible"] == true,
                selection_hash: selection_hash.clone(),
                formatter_profile_sha256: result["formatterProfileSha256"]
                    .as_str()
                    .map(str::to_owned),
                project_session_id: None,
            },
        );
        Ok(result)
    })();
    if response.is_err() {
        super::java_project_context::trace_snapshot(
            "refactorkit.java.preview.failure",
            json!({"operation": operation_name, "phase": phase}),
        );
        manager.java_refactoring.take();
    }
    response
}

/// Use the explicitly evaluated Gradle project session for saved-source preview.
/// Opening a second daemon here would lose the in-memory Gradle model and could
/// silently analyze an incomplete classpath.
pub(super) fn preview_in_gradle_session(
    request: EnginePreviewRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
) -> Result<Value, String> {
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The workspace is unavailable.")?;
    preview_in_gradle_session_at(request, state, project_context_state, binding, &root)
}

pub(super) fn preview_in_gradle_session_at(
    request: EnginePreviewRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
    binding: CurrentWorkspaceBinding,
    root: &Path,
) -> Result<Value, String> {
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing Java project context.")?;
    if context.gradle.is_none() {
        return Err("A configured Gradle context is required for this session route.".into());
    }
    let (project, sdk) = validate(context, &binding, request.authority.workspace_generation)?;
    require_generation(request.selection_generation)?;
    validate_id(&request.request_id)?;
    validate_refactoring_target(root, &request.target)?;
    let settings = serde_json::to_value(context).map_err(|_| PROTOCOL_FAILED.to_string())?;
    let project_state = project_context_state.shared();

    super::java_project_context::with_selected_session(
        &project_state,
        &binding,
        request.authority.workspace_generation,
        &settings,
        |project_active| {
            if !project_active.has_gradle_evaluation() || project_active.session.root != project {
                return Err("Explicitly synchronize the Gradle project before refactoring.".into());
            }
            let provider_operation = operation(request.operation)?;
            authorize_batch_formatter_profile(&project_active.capabilities, request.operation, request.formatter_profile.is_some())?;
            if !offered(&project_active.capabilities, provider_operation, "preview") {
                return Err(
                    "RefactorKit does not advertise this SDK-bound Java refactoring operation."
                        .into(),
                );
            }
            let java_selection = saved_mutation_selection(
                &request,
                context,
                &project,
                &sdk,
                &project_active.capabilities,
                &mut project_active.session,
            )?;
            let target_selection = saved_move_member_target_selection(
                &request,
                context,
                &project,
                &sdk,
                &project_active.capabilities,
                &mut project_active.session,
            )?;
            let selection_hash = java_selection
                .as_ref()
                .filter(|_| request.operation != RefactoringOperation::MakeStatic)
                .and_then(|selection| selection["selectorHash"].as_str())
                .map(str::to_owned);
            let params = preview_params_with_workspace_root_and_target(
                &request,
                &project,
                root,
                &sdk,
                java_selection.as_ref(),
                target_selection.as_ref(),
            )?;
            let raw = match session_call_detailed(
                &mut project_active.session,
                "refactor.preview",
                params,
                REQUEST_TIMEOUT,
            ) {
                Ok(raw) => raw,
                Err(error) => {
                    let message = rpc_error_message("refactor.preview", &error);
                    if preserve_gradle_context_after_preview_refusal(request.operation, &error) {
                        // Keep the evaluated model for the next request, without retaining an Apply plan.
                        lock(state)?.java_project_context_plans.clear();
                        return Ok(Err(message));
                    }
                    return Err(message);
                }
            };
            validate_safe_delete_reference_analysis_advertisement(
                &raw,
                &project_active.capabilities,
                provider_operation,
            )?;
            let mut result = normalize_preview_with_selection(
                &raw,
                &request,
                &project,
                root,
                selection_hash.as_deref(),
            )?;
            enforce_apply_advertisement(
                &mut result,
                &project_active.capabilities,
                provider_operation,
            );
            if !current_workspace_binding_is_current(&binding) {
                return Err("The Java workspace changed during preview.".into());
            }
            let plan_id = result["planId"].as_str().ok_or(PROTOCOL_FAILED)?.to_owned();
            let plan = Plan {
                guard: guard(&request),
                files: result["affectedFiles"]
                    .as_array()
                    .ok_or(PROTOCOL_FAILED)?
                    .clone(),
                eligible: result["applyEligibility"]["eligible"] == true,
                selection_hash,
                formatter_profile_sha256: result["formatterProfileSha256"]
                    .as_str()
                    .map(str::to_owned),
                project_session_id: Some(project_active.session_id),
            };
            let mut manager = lock(state)?;
            manager.java_refactoring.take();
            manager.java_project_context_plans.clear();
            manager.java_project_context_plans.insert(plan_id, plan);
            Ok(Ok(result))
        },
    )?
}

pub(super) fn discard_in_gradle_session(
    request: &EngineDiscardRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
) -> Result<Option<Value>, String> {
    validate_id(&request.plan_id)?;
    validate_id(&request.request_id)?;
    require_generation(request.selection_generation)?;
    let plan = lock(state)?
        .java_project_context_plans
        .get(&request.plan_id)
        .cloned();
    let Some(plan) = plan else {
        return Ok(None);
    };
    if plan.guard["workspaceId"] != request.authority.workspace_id
        || plan.guard["workspaceGeneration"] != request.authority.workspace_generation
        || plan.guard["selectionGeneration"] != request.selection_generation
        || plan.guard["requestId"] != request.request_id
    {
        return Err("The SDK-bound Java plan discard authority changed.".into());
    }
    let context: ProjectContext = serde_json::from_value(plan.guard["projectContext"].clone())
        .map_err(|_| "The SDK-bound Java plan context is invalid.")?;
    if context.gradle.is_none() {
        return Err("The shared-session plan has no Gradle authority.".into());
    }
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let (project, _) = validate(&context, &binding, request.authority.workspace_generation)?;
    let settings = serde_json::to_value(&context).map_err(|_| PROTOCOL_FAILED.to_string())?;
    let project_state = project_context_state.shared();
    super::java_project_context::with_selected_session(
        &project_state,
        &binding,
        request.authority.workspace_generation,
        &settings,
        |project_active| {
            if plan.project_session_id != Some(project_active.session_id)
                || !project_active.has_gradle_evaluation()
                || project_active.session.root != project
            {
                return Err("The Gradle session for this Java plan is no longer available.".into());
            }
            let response = rpc(
                &mut project_active.session,
                "refactor.discard",
                json!({"planId": request.plan_id}),
            )?;
            if response["discarded"] != true || response["planId"] != request.plan_id {
                return Err(PROTOCOL_FAILED.into());
            }
            lock(state)?
                .java_project_context_plans
                .remove(&request.plan_id);
            Ok(Some(json!({"planId":request.plan_id,"discarded":true})))
        },
    )
}

pub(super) fn apply(
    request: EngineApplyRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The workspace is unavailable.")?;
    apply_at(request, state, binding, &root)
}

fn apply_reviewed_plan(
    request: &EngineApplyRequest,
    binding: &CurrentWorkspaceBinding,
    root: &Path,
    project: &Path,
    sdk: &Path,
    reviewed_files: &[Value],
    capabilities: &Value,
    session: &mut Session,
    project_session_id: Option<u64>,
    expected_selection_hash: Option<&str>,
    formatter_profile_sha256: Option<&str>,
) -> (Value, Option<Transaction>) {
    let context = request.project_context.as_ref().unwrap();
    let mut apply_params = json!({"planId": request.plan_id,
        "expectedSnapshotHash": context.snapshot_hash, "javaContext": java_context_authority(context, sdk)});
    if let Some(hash) = formatter_profile_sha256 {
        apply_params["formatterProfileSha256"] = json!(hash);
    }
    let response = session_call_detailed(session, "refactor.apply", apply_params, REQUEST_TIMEOUT);
    let mut result = json!({"planId": request.plan_id, "operation": request.operation, "outcome": "indeterminate", "changedFiles": [],
        "primaryFile": null, "diagnostics": [], "provider": "refactorkit", "providerVersion": capabilities["version"]});
    match response {
        Ok(raw) => {
            let normalized = (|| {
                validate_applied_selection(&raw, expected_selection_hash)?;
                if raw["status"] != "applied"
                    || raw["planId"] != request.plan_id
                    || raw["appliedContextHash"] != context.context_hash
                    || !current_workspace_binding_is_current(binding)
                {
                    return Err(PROTOCOL_FAILED.to_string());
                }
                let mut files = Vec::new();
                for change in items(&raw, "changedFiles")? {
                    let mut change = change.clone();
                    change["path"] = json!(workspace_path(
                        text(&change, "path", 4096)?,
                        context,
                        project,
                        root
                    )?);
                    if let Some(previous) = change["previousPath"].as_str() {
                        change["previousPath"] =
                            json!(workspace_path(previous, context, project, root)?);
                    }
                    if change["change"] == "modify" {
                        change["change"] = json!("edit");
                    }
                    files.push(change);
                }
                let files = super::contract::normalize_files(Some(&json!(files)), root)?;
                if effects(&files) != effects(reviewed_files) {
                    return Err(PROTOCOL_FAILED.into());
                }
                let transaction = text(&raw, "transactionId", 256)?;
                validate_id(transaction)?;
                let applied_snapshot = text(&raw, "snapshotHash", 64)?;
                if !hash(applied_snapshot) {
                    return Err(PROTOCOL_FAILED.into());
                }
                result["outcome"] = json!("applied");
                result["changedFiles"] = json!(files);
                result["diagnostics"] =
                    json!(diagnostics(&raw, "diagnostics", context, project, root)?);
                result["transactionId"] = json!(transaction);
                result["appliedContextHash"] = json!(context.context_hash);
                result["appliedSnapshotHash"] = json!(applied_snapshot);
                if let Some(primary) = raw["primaryFile"].as_str() {
                    result["primaryFile"] = json!(workspace_path(primary, context, project, root)?);
                }
                Ok::<(), String>(())
            })();
            if normalized.is_err() {
                result["outcome"] = json!("indeterminate");
                result["changedFiles"] = json!([]);
                result.as_object_mut().unwrap().remove("transactionId");
                result.as_object_mut().unwrap().remove("appliedContextHash");
                result
                    .as_object_mut()
                    .unwrap()
                    .remove("appliedSnapshotHash");
            }
        }
        Err(error)
            if error.kind == SessionCallErrorKind::Rejected
                && matches!(
                    error.rpc_code,
                    Some(-32001 | -32002 | -32008 | -32009 | -32012 | -32013 | -32014 | -32015)
                ) =>
        {
            result["outcome"] = json!("refused");
        }
        Err(_) => {}
    }
    let transaction = (result["outcome"] == "applied").then(|| Transaction {
        binding: binding.clone(),
        generation: request.authority.workspace_generation,
        operation: request.operation,
        context: context.clone(),
        project: project.to_path_buf(),
        sdk: sdk.to_path_buf(),
        committed_snapshot: result["appliedSnapshotHash"].as_str().unwrap().into(),
        rollback_files: inverse_files(reviewed_files),
        project_session_id,
    });
    (result, transaction)
}

pub(super) fn apply_at(
    request: EngineApplyRequest,
    state: &RefactorKitDaemonState,
    binding: CurrentWorkspaceBinding,
    root: &Path,
) -> Result<Value, String> {
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing Java project context.")?;
    if matches!(request.operation, RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule) && context.gradle.is_none() {
        return Err("Gradle module Apply requires its synchronized Gradle context.".into());
    }
    let (project, sdk) = validate(context, &binding, request.authority.workspace_generation)?;
    for id in [
        &request.plan_id,
        &request.request_id,
        &request.approval.approval_id,
        &request.approval.approved_at,
    ] {
        validate_id(id)?;
    }
    if request.approval.approved_plan_id != request.plan_id {
        return Err("Approval does not bind the reviewed Java plan.".into());
    }
    let requested_guard = json!({"operation": request.operation, "target": request.target, "changeIntent": request.change_intent,
        "formatterProfile": request.formatter_profile,
        "workspaceId": request.authority.workspace_id, "workspaceGeneration": request.authority.workspace_generation,
        "selectionGeneration": request.selection_generation, "requestId": request.request_id, "projectContext": request.project_context});
    let mut manager = lock(state)?;
    let active = manager
        .java_refactoring
        .as_mut()
        .ok_or("The SDK-bound Java plan is stale or unknown.")?;
    let retained = active
        .plans
        .get(&request.plan_id)
        .ok_or("The SDK-bound Java plan is stale or unknown.")?;
    let formatter_profile_sha256 = validate_formatter_profile_approval(
        root,
        &request,
        retained.formatter_profile_sha256.as_deref(),
    )?;
    authorize_batch_formatter_profile(&active.capabilities, request.operation, formatter_profile_sha256.is_some())?;
    if !retained.eligible
        || retained.guard != requested_guard
        || active.binding != binding
        || active.sdk != sdk
        || active.session.root != project
        || !current_workspace_binding_is_current(&binding)
        || !offered(&active.capabilities, operation(request.operation)?, "apply")
    {
        return Err("The Java plan approval or selected project context changed.".into());
    }
    if active.maven_runtime.as_ref().is_some_and(|runtime| !runtime.is_current(&project, root)) {
        return Err(super::java_project_context::MAVEN_RUNTIME_CHANGED_MESSAGE.into());
    }
    let reviewed_files = retained.files.clone();
    let selection_hash = retained.selection_hash.clone();
    active.plans.remove(&request.plan_id);
    let mut apply_params = json!({"planId": request.plan_id,
        "expectedSnapshotHash": context.snapshot_hash, "javaContext": java_context_authority(context, &sdk)});
    if let Some(hash) = formatter_profile_sha256.as_ref() {
        apply_params["formatterProfileSha256"] = json!(hash);
    }
    let response = session_call_detailed(
        &mut active.session,
        "refactor.apply",
        apply_params,
        REQUEST_TIMEOUT,
    );
    let mut result = json!({"planId": request.plan_id, "operation": request.operation, "outcome": "indeterminate", "changedFiles": [],
        "primaryFile": null, "diagnostics": [], "provider": "refactorkit", "providerVersion": active.capabilities["version"]});
    match response {
        Ok(raw) => {
            let normalized = (|| {
                validate_applied_selection(&raw, selection_hash.as_deref())?;
                if raw["status"] != "applied"
                    || raw["planId"] != request.plan_id
                    || raw["appliedContextHash"] != context.context_hash
                    || !current_workspace_binding_is_current(&binding)
                {
                    return Err(PROTOCOL_FAILED.to_string());
                }
                let mut files = Vec::new();
                for change in items(&raw, "changedFiles")? {
                    let mut change = change.clone();
                    change["path"] = json!(workspace_path(
                        text(&change, "path", 4096)?,
                        context,
                        &project,
                        &root
                    )?);
                    if let Some(previous) = change["previousPath"].as_str() {
                        change["previousPath"] =
                            json!(workspace_path(previous, context, &project, &root)?);
                    }
                    if change["change"] == "modify" {
                        change["change"] = json!("edit");
                    }
                    files.push(change);
                }
                let files = super::contract::normalize_files(Some(&json!(files)), &root)?;
                let effects = |files: &[Value]| {
                    let mut effects = files
                        .iter()
                        .map(|v| format!("{}:{}:{}", v["change"], v["path"], v["previousPath"]))
                        .collect::<Vec<_>>();
                    effects.sort();
                    effects
                };
                if effects(&files) != effects(&reviewed_files) {
                    return Err(PROTOCOL_FAILED.into());
                }
                let transaction = text(&raw, "transactionId", 256)?;
                validate_id(transaction)?;
                let applied_snapshot = text(&raw, "snapshotHash", 64)?;
                if !hash(applied_snapshot) {
                    return Err(PROTOCOL_FAILED.into());
                }
                result["outcome"] = json!("applied");
                result["changedFiles"] = json!(files);
                result["diagnostics"] =
                    json!(diagnostics(&raw, "diagnostics", context, &project, &root)?);
                result["transactionId"] = json!(transaction);
                result["appliedContextHash"] = json!(context.context_hash);
                result["appliedSnapshotHash"] = json!(applied_snapshot);
                if let Some(primary) = raw["primaryFile"].as_str() {
                    result["primaryFile"] =
                        json!(workspace_path(primary, context, &project, &root)?);
                }
                Ok::<(), String>(())
            })();
            if normalized.is_err() {
                result["outcome"] = json!("indeterminate");
                result["changedFiles"] = json!([]);
                result.as_object_mut().unwrap().remove("transactionId");
                result.as_object_mut().unwrap().remove("appliedContextHash");
                result
                    .as_object_mut()
                    .unwrap()
                    .remove("appliedSnapshotHash");
            }
        }
        Err(error)
            if error.kind == SessionCallErrorKind::Rejected
                && matches!(
                    error.rpc_code,
                    Some(-32001 | -32002 | -32008 | -32009 | -32012 | -32013 | -32014 | -32015)
                ) =>
        {
            result["outcome"] = json!("refused");
        }
        Err(_) => {}
    }
    if result["outcome"] == "applied" {
        manager.java_transactions.insert(
            result["transactionId"].as_str().unwrap().into(),
            Transaction {
                binding,
                generation: request.authority.workspace_generation,
                operation: request.operation,
                context: context.clone(),
                project,
                sdk,
                committed_snapshot: result["appliedSnapshotHash"].as_str().unwrap().into(),
                rollback_files: inverse_files(&reviewed_files),
                project_session_id: None,
            },
        );
    }
    manager.java_refactoring.take();
    Ok(result)
}

pub(super) fn apply_in_gradle_session(
    request: EngineApplyRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
) -> Result<Value, String> {
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The workspace is unavailable.")?;
    apply_in_gradle_session_at(request, state, project_context_state, binding, &root)
}

pub(super) fn apply_in_gradle_session_at(
    request: EngineApplyRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
    binding: CurrentWorkspaceBinding,
    root: &Path,
) -> Result<Value, String> {
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing Java project context.")?;
    if context.gradle.is_none() {
        return Err("A configured Gradle context is required for this session route.".into());
    }
    let (project, sdk) = validate(context, &binding, request.authority.workspace_generation)?;
    for id in [
        &request.plan_id,
        &request.request_id,
        &request.approval.approval_id,
        &request.approval.approved_at,
    ] {
        validate_id(id)?;
    }
    if request.approval.approved_plan_id != request.plan_id {
        return Err("Approval does not bind the reviewed Java plan.".into());
    }
    let requested_guard = json!({"operation": request.operation, "target": request.target, "changeIntent": request.change_intent,
        "formatterProfile": request.formatter_profile,
        "workspaceId": request.authority.workspace_id, "workspaceGeneration": request.authority.workspace_generation,
        "selectionGeneration": request.selection_generation, "requestId": request.request_id, "projectContext": request.project_context});
    let settings = serde_json::to_value(context).map_err(|_| PROTOCOL_FAILED.to_string())?;
    let project_state = project_context_state.shared();

    super::java_project_context::with_selected_session(
        &project_state,
        &binding,
        request.authority.workspace_generation,
        &settings,
        |project_active| {
            if !project_active.has_gradle_evaluation() || project_active.session.root != project {
                return Err(
                    "The explicitly synchronized Gradle session is no longer available.".into(),
                );
            }
            let mut manager = lock(state)?;
            let retained = manager
                .java_project_context_plans
                .get(&request.plan_id)
                .cloned()
                .ok_or("The SDK-bound Java plan is stale or unknown.")?;
            let formatter_profile_sha256 = validate_formatter_profile_approval(
                root,
                &request,
                retained.formatter_profile_sha256.as_deref(),
            )?;
            authorize_batch_formatter_profile(&project_active.capabilities, request.operation, formatter_profile_sha256.is_some())?;
            let session_id = project_active.session_id;
            if !retained.eligible
                || retained.guard != requested_guard
                || retained.project_session_id != Some(session_id)
                || !current_workspace_binding_is_current(&binding)
                || !offered(
                    &project_active.capabilities,
                    operation(request.operation)?,
                    "apply",
                )
            {
                return Err("The Java plan approval or selected Gradle context changed.".into());
            }
            let selection_hash = retained.selection_hash.clone();
            manager.java_project_context_plans.remove(&request.plan_id);
            let (result, transaction) = apply_reviewed_plan(
                &request,
                &binding,
                &root,
                &project,
                &sdk,
                &retained.files,
                &project_active.capabilities,
                &mut project_active.session,
                Some(session_id),
                selection_hash.as_deref(),
                formatter_profile_sha256.as_deref(),
            );
            if let Some(transaction) = transaction {
                manager.java_transactions.insert(
                    result["transactionId"].as_str().unwrap().into(),
                    transaction,
                );
            }
            if result["outcome"] != "refused" {
                project_active.retire_context();
                if result["outcome"] == "indeterminate" {
                    project_active.invalidate_gradle_evaluation();
                }
            }
            Ok(result)
        },
    )
}

fn effects(files: &[Value]) -> Vec<String> {
    let mut result = files
        .iter()
        .map(|v| format!("{}:{}:{}", v["change"], v["path"], v["previousPath"]))
        .collect::<Vec<_>>();
    result.sort();
    result
}

fn inverse_files(files: &[Value]) -> Vec<Value> {
    files
        .iter()
        .map(|file| {
            let mut inverse = file.clone();
            match file["change"].as_str() {
                Some("create") => inverse["change"] = json!("delete"),
                Some("delete") => inverse["change"] = json!("create"),
                Some("move") => {
                    inverse["path"] = file["previousPath"].clone();
                    inverse["previousPath"] = file["path"].clone();
                }
                _ => {}
            }
            inverse
        })
        .collect()
}

pub(super) fn rollback(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
) -> Result<Value, String> {
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The workspace is unavailable.")?;
    rollback_at(request, state, binding, &root)
}

pub(super) fn rollback_at(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
    binding: CurrentWorkspaceBinding,
    root: &Path,
) -> Result<Value, String> {
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing original Java project context.")?;
    if matches!(request.operation, RefactoringOperation::CreateGradleModule | RefactoringOperation::RenameGradleModule) && context.gradle.is_none() {
        return Err(
            "Gradle module rollback requires its original synchronized Gradle context.".into(),
        );
    }
    let (project, sdk) = validate(context, &binding, request.authority.workspace_generation)?;
    let mut manager = lock(state)?;
    let retained = manager
        .java_transactions
        .get(&request.transaction_id)
        .cloned()
        .ok_or("The SDK-bound Java transaction is stale or unknown.")?;
    if retained.binding != binding
        || retained.generation != request.authority.workspace_generation
        || retained.operation != request.operation
        || retained.context != *context
        || retained.project != project
        || retained.sdk != sdk
        || request.expected_snapshot_hash.as_deref() != Some(&retained.committed_snapshot)
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The original SDK-bound transaction authority changed.".into());
    }
    let session = spawn_session(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
        &project,
    )?;
    // Reuse the owned-session lifetime guard, including on early protocol errors.
    let mut active = Active {
        session,
        binding: binding.clone(),
        generation: retained.generation,
        context: context.clone(),
        sdk: sdk.clone(),
        capabilities: Value::Null,
        maven_runtime: None,
        plans: HashMap::new(),
    };
    active.capabilities = rpc(&mut active.session, "server.capabilities", json!({}))?;
    if !offered(
        &active.capabilities,
        operation(request.operation)?,
        "rollback",
    ) {
        return Err("RefactorKit does not advertise SDK-protected transaction rollback.".into());
    }
    let mut open = json!({"root": project, "resolveDependencies": false,
        "activeMavenProfiles": context.active_maven_profiles, "inactiveMavenProfiles": context.inactive_maven_profiles});
    if !context.maven_repository.is_empty() {
        open["mavenRepository"] = json!(context.maven_repository);
    }
    active.maven_runtime = attach_maven_runtime(&mut open, &active.capabilities, &project, root);
    let opened = rpc(&mut active.session, "project.open", open)?;
    if opened["root"]
        .as_str()
        .and_then(|v| Path::new(v).canonicalize().ok())
        .as_deref()
        != Some(&project)
        || opened["snapshotHash"] != retained.committed_snapshot
        || !current_workspace_binding_is_current(&binding)
    {
        return Err(format!("Saved project inputs changed after Apply; rollback was not started (expected {}, current {}).", retained.committed_snapshot, opened["snapshotHash"]));
    }
    let raw = rpc(
        &mut active.session,
        "patch.rollback",
        json!({"transactionId": request.transaction_id,
        "expectedSnapshotHash": retained.committed_snapshot, "javaContext": java_context_authority(context, &sdk)}),
    )?;
    if raw["rolledBack"] != true
        || raw["transactionId"] != request.transaction_id
        || raw["rolledBackContextHash"] != context.context_hash
        || raw["snapshotHash"] != context.snapshot_hash
        || !current_workspace_binding_is_current(&binding)
    {
        return Err(
            "Rollback write outcome is unknown: the original Java authority was not confirmed."
                .into(),
        );
    }
    let mut files = Vec::new();
    for change in items(&raw, "changedFiles")? {
        let mut change = change.clone();
        change["path"] = json!(workspace_path(
            text(&change, "path", 4096)?,
            context,
            &project,
            root
        )?);
        if let Some(previous) = change["previousPath"].as_str() {
            change["previousPath"] = json!(workspace_path(previous, context, &project, root)?);
        }
        if change["change"] == "modify" {
            change["change"] = json!("edit");
        }
        files.push(change);
    }
    let files = super::contract::normalize_files(Some(&json!(files)), root)?;
    if effects(&files) != effects(&retained.rollback_files) {
        return Err(
            "Rollback write outcome is unknown: file changes do not match the transaction.".into(),
        );
    }
    let diagnostics = diagnostics(&raw, "diagnostics", context, &project, root)?;
    manager.java_transactions.remove(&request.transaction_id);
    Ok(
        json!({"transactionId": request.transaction_id, "rolledBack": true, "changedFiles": files,
        "conflicts": [], "diagnostics": diagnostics, "rolledBackContextHash": context.context_hash,
        "restoredSnapshotHash": context.snapshot_hash}),
    )
}

pub(super) fn rollback_in_gradle_session(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
) -> Result<Value, String> {
    let binding = binding(
        &request.authority.workspace_id,
        request.authority.workspace_generation,
    )?;
    let root = workspace_root()?
        .canonicalize()
        .map_err(|_| "The workspace is unavailable.")?;
    let result =
        rollback_in_gradle_session_at(request, state, project_context_state, binding, &root);
    if let Err(error) = &result {
        super::java_project_context::trace_snapshot(
            "project.context.gradle.rollback.failure",
            json!({"error": error}),
        );
    }
    result
}

pub(super) fn rollback_in_gradle_session_at(
    request: EngineRollbackRequest,
    state: &RefactorKitDaemonState,
    project_context_state: &super::java_project_context::JavaProjectContextState,
    binding: CurrentWorkspaceBinding,
    root: &Path,
) -> Result<Value, String> {
    validate_id(&request.transaction_id)?;
    validate_id(&request.request_id)?;
    let context = request
        .project_context
        .as_ref()
        .ok_or("Missing original Java project context.")?;
    if context.gradle.is_none() {
        return Err("A configured Gradle context is required for this session route.".into());
    }
    let (project, sdk) = validate(context, &binding, request.authority.workspace_generation)?;
    let retained = lock(state)?
        .java_transactions
        .get(&request.transaction_id)
        .cloned()
        .ok_or("The SDK-bound Java transaction is stale or unknown.")?;
    if retained.binding != binding
        || retained.generation != request.authority.workspace_generation
        || retained.operation != request.operation
        || retained.context != *context
        || retained.project != project
        || retained.sdk != sdk
        || retained.project_session_id.is_none()
        || request.expected_snapshot_hash.as_deref() != Some(&retained.committed_snapshot)
        || !current_workspace_binding_is_current(&binding)
    {
        return Err("The original SDK-bound Gradle transaction authority changed.".into());
    }
    let settings = serde_json::to_value(context).map_err(|_| PROTOCOL_FAILED.to_string())?;
    let project_state = project_context_state.shared();
    super::java_project_context::with_workspace_session(
        &project_state,
        &binding,
        request.authority.workspace_generation,
        &settings,
        |project_active| {
            if project_active.session_id != retained.project_session_id.unwrap()
                || project_active.session.root != project
            {
                return Err(
                    "The Gradle daemon session for this transaction is no longer available.".into(),
                );
            }
            if !offered(
                &project_active.capabilities,
                operation(request.operation)?,
                "rollback",
            ) {
                return Err(
                    "RefactorKit does not advertise SDK-protected transaction rollback.".into(),
                );
            }
            let refreshed = rpc(&mut project_active.session, "workspace.refresh", json!({}))?;
            if !matches!(refreshed["status"].as_str(), Some("ready" | "unchanged")) {
                return Err("Current saved Gradle project inputs are unavailable; rollback was not started.".into());
            }
            let current_snapshot = text(&refreshed, "snapshotHash", 64)?;
            let current_generation = refreshed["generation"]
                .as_u64()
                .filter(|value| *value > 0 && *value <= 9_007_199_254_740_991)
                .ok_or(PROTOCOL_FAILED)?;
            if !hash(current_snapshot) {
                return Err(PROTOCOL_FAILED.into());
            }
            super::java_project_context::refresh_saved_authority(
                project_active,
                current_snapshot,
                current_generation,
            );
            if current_snapshot != retained.committed_snapshot {
                return Err(format!("Saved project inputs changed after Apply; rollback was not started (expected {}, current {}).", retained.committed_snapshot, current_snapshot));
            }
            let raw = match session_call_detailed(
                &mut project_active.session,
                "patch.rollback",
                json!({"transactionId": request.transaction_id,
                "expectedSnapshotHash": retained.committed_snapshot, "javaContext": java_context_authority(context, &sdk)}),
                REQUEST_TIMEOUT,
            ) {
                Ok(raw) => raw,
                Err(error) => {
                    super::java_project_context::trace_snapshot(
                        "project.context.gradle.rollback.providerFailure",
                        json!({"kind": format!("{:?}", error.kind), "rpcCode": error.rpc_code}),
                    );
                    return Err(if error.kind == SessionCallErrorKind::Rejected {
                        "RefactorKit refused this Java operation. Synchronize and review a new plan.".into()
                    } else {
                        "The Java refactoring daemon is unavailable or returned an invalid response.".into()
                    });
                }
            };
            if raw["rolledBack"] != true
                || raw["transactionId"] != request.transaction_id
                || raw["rolledBackContextHash"] != context.context_hash
                || raw["snapshotHash"] != context.snapshot_hash
                || !current_workspace_binding_is_current(&binding)
            {
                project_active.invalidate_gradle_evaluation();
                return Err("Rollback write outcome is unknown: the original Gradle authority was not confirmed.".into());
            }
            let mut files = Vec::new();
            for change in items(&raw, "changedFiles")? {
                let mut change = change.clone();
                change["path"] = json!(workspace_path(
                    text(&change, "path", 4096)?,
                    context,
                    &project,
                    &root
                )?);
                if let Some(previous) = change["previousPath"].as_str() {
                    change["previousPath"] =
                        json!(workspace_path(previous, context, &project, &root)?);
                }
                if change["change"] == "modify" {
                    change["change"] = json!("edit");
                }
                files.push(change);
            }
            let files = super::contract::normalize_files(Some(&json!(files)), &root)?;
            if effects(&files) != effects(&retained.rollback_files) {
                project_active.invalidate_gradle_evaluation();
                return Err(
                    "Rollback write outcome is unknown: file changes do not match the transaction."
                        .into(),
                );
            }
            let diagnostics = diagnostics(&raw, "diagnostics", context, &project, &root)?;
            super::java_project_context::refresh_saved_authority(
                project_active,
                context.snapshot_hash.as_str(),
                request.authority.workspace_generation,
            );
            project_active.retire_context();
            lock(state)?
                .java_transactions
                .remove(&request.transaction_id);
            Ok(
                json!({"transactionId": request.transaction_id, "rolledBack": true, "changedFiles": files,
            "conflicts": [], "diagnostics": diagnostics, "rolledBackContextHash": context.context_hash,
            "restoredSnapshotHash": context.snapshot_hash}),
            )
        },
    )
}

#[cfg(test)]
#[path = "java_context_refactoring_tests.rs"]
mod tests;
