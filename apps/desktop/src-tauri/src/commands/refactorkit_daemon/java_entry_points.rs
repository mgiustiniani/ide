//! Provider-owned saved-source entry points; compilation and launch remain build-tool/JDK work.
mod modern;

use super::java_navigation::{source, valid_position, Position, ProjectContext};
use super::java_project_context::{self as project, JavaProjectContextState};
use super::transport::{session_call_detailed, session_call_detailed_cancellable, REQUEST_TIMEOUT};
use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current,
};
use crate::workspace::workspace_root;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_context: ProjectContext,
    scope: Scope,
    path: Option<String>,
    position: Option<Position>,
    limit: u64,
    entry_point_schema_version: Option<String>,
    launch_profile: Option<String>,
}
impl Request {
    fn modern(&self) -> bool {
        self.entry_point_schema_version.as_deref() == Some("java-entry-points-v2")
    }
    fn profile(&self) -> &str {
        self.launch_profile
            .as_deref()
            .unwrap_or("classic-declared-v1")
    }
    fn valid_profile(&self) -> bool {
        match self.entry_point_schema_version.as_deref() {
            None => self.profile() == "classic-declared-v1",
            Some("java-entry-points-v2") => matches!(self.profile(), "inherited-v1" | "java25-v1"),
            _ => false,
        }
    }
}
#[derive(Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    provider_id: String,
    module_id: String,
    source_set_id: String,
}
type Key = (String, u64, String);
#[derive(Default, Clone)]
pub struct JavaEntryPointState(Arc<Mutex<HashMap<Key, Arc<AtomicBool>>>>);
struct Registration {
    state: JavaEntryPointState,
    key: Key,
    cancelled: Arc<AtomicBool>,
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.state.0.lock() {
            requests.remove(&self.key);
        }
    }
}
pub(super) fn cancel(
    state: &JavaEntryPointState,
    workspace_id: String,
    generation: u64,
    request_id: String,
) -> Result<(), String> {
    if let Some(flag) = state
        .0
        .lock()
        .map_err(|_| "Java discovery is unavailable.")?
        .get(&(workspace_id, generation, request_id))
    {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}
fn reply(request: &Request, status: &str, message: &str, discovery: Option<Value>) -> Value {
    json!({"workspaceId":request.workspace_id,"generation":request.generation,"requestId":request.request_id,"status":status,"message":message,"discovery":discovery})
}
fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.contains('\0')
}
fn relative(value: &str) -> bool {
    text(value, 4096)
        && !value.contains(['\\', ':'])
        && !value.starts_with('/')
        && value
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}
fn advertised(capabilities: &Value, request: &Request) -> bool {
    capabilities["name"] == "RefactorKit"
        && capabilities["apiVersion"] == "0.2"
        && capabilities["protocol"] == "json-rpc-2.0"
        && capabilities["transport"] == "stdio"
        && capabilities["methods"].as_array().is_some_and(|methods| {
            methods.iter().any(|m| {
                m["name"] == "intelligence.query"
                    && (if request.modern() {
                        m["features"]["javaEntryPointsV2"] == true
                            && m["features"]["javaEntryPointsV2SavedSnapshot"] == true
                            && m["features"][if request.profile() == "java25-v1" {
                                "javaEntryPointsV2Java25"
                            } else {
                                "javaEntryPointsV2Inherited"
                            }] == true
                    } else {
                        m["features"]["javaEntryPointsClassicDeclared"] == true
                    })
                    && m["features"]["javaEntryPointsBoundedFrame"] == true
                    && m["features"]["javaEntryPointsCancellation"] == true
            })
        })
}
pub(super) fn prepare(
    request: Request,
    state: &JavaProjectContextState,
    requests: &JavaEntryPointState,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    if !request.valid_profile()
        || !text(&request.request_id, 128)
        || request.limit == 0
        || request.limit > 200
        || [
            &request.scope.provider_id,
            &request.scope.module_id,
            &request.scope.source_set_id,
        ]
        .iter()
        .any(|s| !text(s, 1024))
        || request.position.as_ref().is_some_and(|p| {
            request.path.is_none() || p.line > i32::MAX as u64 || p.character > i32::MAX as u64
        })
        || request
            .path
            .as_ref()
            .is_some_and(|p| !relative(p) || !p.ends_with(".java"))
    {
        return Err("Invalid Java entry-point discovery request.".into());
    }
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    prepare_bound(request, state, requests, binding)
}

pub(super) fn prepare_bound(
    request: Request,
    state: &JavaProjectContextState,
    requests: &JavaEntryPointState,
    binding: crate::commands::workspace_registry::CurrentWorkspaceBinding,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    if !request.valid_profile() {
        return Err("Invalid Java entry-point protocol/profile selection.".into());
    }
    if binding.workspace_id != request.workspace_id {
        return Err("The Java workspace changed.".into());
    }
    let key = (
        request.workspace_id.clone(),
        request.generation,
        request.request_id.clone(),
    );
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut pending = requests
            .0
            .lock()
            .map_err(|_| "Java discovery is unavailable.")?;
        if pending.len() >= 16 || pending.contains_key(&key) {
            return Err("Java discovery is already pending.".into());
        }
        pending.insert(key.clone(), cancelled.clone());
    }
    let registration = Registration {
        state: requests.clone(),
        key,
        cancelled,
    };
    let shared = state.shared();
    Ok(move || {
        let context = &request.project_context;
        let (root, sdk) = project::validate_operation_settings(
            &binding,
            request.generation,
            &context.context_schema_version,
            &context.project_path,
            &context.sdk_home,
            &context.maven_repository,
            &context.active_maven_profiles,
            &context.inactive_maven_profiles,
        )?;
        let expected =
            serde_json::to_value(context).map_err(|_| "Invalid Java discovery context.")?;
        let result = project::with_selected_session(
            &shared,
            &binding,
            request.generation,
            &expected,
            |active| {
                if registration.cancelled.load(Ordering::SeqCst) {
                    return Ok(reply(
                        &request,
                        "cancelled",
                        "Main-class discovery was cancelled.",
                        None,
                    ));
                }
                if !advertised(&active.capabilities, &request) {
                    return Ok(reply(&request,"unavailable","This RefactorKit runtime does not support qualified main-class discovery. Update RefactorKit to use it.",None));
                }
                if !request.modern()
                    && request.position.is_some()
                    && !active.capabilities["methods"]
                        .as_array()
                        .is_some_and(|methods| {
                            methods.iter().any(|m| {
                                m["name"] == "intelligence.query"
                                    && m["features"]["javaEntryPointsEnclosingType"] == true
                            })
                        })
                {
                    return Ok(reply(&request, "unavailable", "This RefactorKit runtime cannot select the enclosing type at the cursor. Update RefactorKit; no file-wide fallback was used.", None));
                }
                let launcher_release = active
                    .observed_context()
                    .and_then(|context| context["sdk"].as_array())
                    .and_then(|sdks| {
                        sdks.iter()
                            .find(|evidence| evidence["home"].as_str() == sdk.to_str())
                    })
                    .and_then(|evidence| evidence["platformRelease"].as_u64())
                    .ok_or(
                        "The selected Java launcher release is unavailable; synchronize again.",
                    )?;
                if request.modern() && launcher_release != 25 {
                    return Ok(reply(&request, "refused", "This entry-point profile requires a synchronized JDK 25 project. Other SDK releases remain unqualified.", None));
                }
                let refresh = session_call_detailed(
                    &mut active.session,
                    "workspace.refresh",
                    json!({}),
                    REQUEST_TIMEOUT,
                )
                .map_err(|_| {
                    "The Java project session could not be refreshed; synchronize again."
                })?;
                if refresh["snapshotHash"] != context.snapshot_hash
                    || !matches!(refresh["status"].as_str(), Some("ready" | "unchanged"))
                {
                    return Ok(reply(&request,"refused","Saved sources changed. Synchronize the Java project before discovering main classes.",None));
                }
                let path = request
                    .path
                    .as_ref()
                    .map(|p| {
                        if context.project_path.is_empty() {
                            Ok(p.clone())
                        } else {
                            p.strip_prefix(&format!("{}/", context.project_path))
                                .map(str::to_owned)
                                .ok_or("The source is outside the selected Java project.")
                        }
                    })
                    .transpose()?;
                let mut params = json!({"requestId":request.request_id,"kind":"entryPoints","languageId":"java","expectedSnapshotHash":context.snapshot_hash,"expectedIndexGeneration":refresh["generation"],"scope":request.scope,"javaContext":{"sdkHome":sdk,"expectedContextHash":context.context_hash,"contextSchemaVersion":context.context_schema_version},"launchProfile":request.profile(),"limit":request.limit});
                if request.modern() {
                    params["entryPointSchemaVersion"] = json!("java-entry-points-v2");
                }
                if let Some(path) = &path {
                    params["path"] = json!(path);
                }
                if let Some(position) = &request.position {
                    let saved = source(
                        &root,
                        path.as_deref()
                            .ok_or("A cursor requires a Java source path.")?,
                    )?;
                    if !valid_position(&saved, position) {
                        return Ok(reply(&request, "refused", "The cursor is outside the saved Java source or splits a UTF-16 character.", None));
                    }
                    params["position"] =
                        json!({"line": position.line, "character": position.character});
                }
                let mut raw=session_call_detailed_cancellable(&mut active.session,"intelligence.query",params,REQUEST_TIMEOUT,&registration.cancelled).map_err(|_| "Main-class discovery could not complete; synchronize the Java project and retry.")?;
                if registration.cancelled.load(Ordering::SeqCst) {
                    return Ok(reply(
                        &request,
                        "cancelled",
                        "Main-class discovery was cancelled.",
                        None,
                    ));
                }
                if raw["status"] == "refused" {
                    let message = raw["error"]["message"]
                        .as_str()
                        .filter(|s| text(s, 4096))
                        .unwrap_or("RefactorKit refused main-class discovery.");
                    let message = if raw["error"]["code"] == "java.entryPoints.analysisUnavailable"
                    {
                        format!("{message}. Fix source errors or build missing generated sources and dependencies, then synchronize and retry.")
                    } else {
                        message.to_owned()
                    };
                    return Ok(reply(&request, "refused", &message, None));
                }
                if raw["status"] != "ready"
                    || raw["schemaVersion"]
                        != if request.modern() {
                            "java-entry-points-v2"
                        } else {
                            "java-entry-points-v1"
                        }
                    || raw["launchProfile"] != request.profile()
                    || raw["requestId"] != request.request_id
                    || raw["snapshotHash"] != context.snapshot_hash
                    || raw["contextHash"] != context.context_hash
                    || raw["contextSchemaVersion"] != context.context_schema_version
                    || raw["scope"]
                        != serde_json::to_value(&request.scope)
                            .map_err(|_| "Invalid discovery scope.")?
                    || raw["indexGeneration"] != refresh["generation"]
                    || raw["launcherRelease"] != launcher_release
                    || raw["platformIdentities"] != json!(context.platform_identities)
                {
                    return Err("RefactorKit returned uncorrelated main-class discovery.".into());
                }
                if request.modern() {
                    modern::validate_and_remap(&mut raw, &request, &root, &sdk)?;
                }
                let selected_type = if let Some(position) = &request.position {
                    let selection = &raw["selection"];
                    let expected_path = path
                        .as_deref()
                        .ok_or("Missing source path for cursor selection.")?;
                    let selected_binary = selection["binaryName"]
                        .as_str()
                        .filter(|name| text(name, 1024))
                        .ok_or("Missing native enclosing-type identity.")?
                        .to_owned();
                    let start: Position =
                        serde_json::from_value(selection["range"]["start"].clone())
                            .map_err(|_| "Invalid enclosing-type range.")?;
                    let end: Position = serde_json::from_value(selection["range"]["end"].clone())
                        .map_err(|_| "Invalid enclosing-type range.")?;
                    let saved = source(&root, expected_path)?;
                    if selection["mode"] != "enclosing-type"
                        || selection["path"] != expected_path
                        || selection["position"]
                            != json!({"line":position.line,"character":position.character})
                        || !valid_position(&saved, &start)
                        || !valid_position(&saved, &end)
                        || (start.line, start.character) > (position.line, position.character)
                        || (position.line, position.character) >= (end.line, end.character)
                    {
                        return Err("RefactorKit returned an uncorrelated enclosing type.".into());
                    }
                    raw["selection"]["path"] = json!(request.path);
                    Some((selected_binary, expected_path.to_owned(), start, end))
                } else {
                    if !raw["selection"].is_null() {
                        return Err("Unexpected enclosing-type selection in file discovery.".into());
                    }
                    None
                };
                let candidates = raw["candidates"]
                    .as_array_mut()
                    .filter(|c| c.len() <= request.limit as usize)
                    .ok_or("Invalid main-class discovery candidates.")?;
                for candidate in candidates {
                    let path = candidate["source"]["path"]
                        .as_str()
                        .filter(|p| relative(p) && p.ends_with(".java"))
                        .ok_or("Invalid main-class source path.")?
                        .to_owned();
                    let saved = source(&root, &path)?;
                    let start: Position =
                        serde_json::from_value(candidate["source"]["range"]["start"].clone())
                            .map_err(|_| "Invalid main-class source range.")?;
                    let end: Position =
                        serde_json::from_value(candidate["source"]["range"]["end"].clone())
                            .map_err(|_| "Invalid main-class source range.")?;
                    if !valid_position(&saved, &start)
                        || !valid_position(&saved, &end)
                        || (start.line, start.character) > (end.line, end.character)
                    {
                        return Err(
                            "Main-class discovery refers to an invalid saved source range.".into(),
                        );
                    }
                    if let Some((binary, selected_path, type_start, type_end)) = &selected_type {
                        if candidate["binaryName"] != *binary
                            || &path != selected_path
                            || (start.line, start.character)
                                < (type_start.line, type_start.character)
                            || (end.line, end.character) > (type_end.line, type_end.character)
                        {
                            return Err(
                                "A main candidate does not belong to the selected native type."
                                    .into(),
                            );
                        }
                    }
                    candidate["source"]["path"] = json!(if context.project_path.is_empty() {
                        path
                    } else {
                        format!("{}/{}", context.project_path, path)
                    });
                }
                let after = session_call_detailed(
                    &mut active.session,
                    "workspace.refresh",
                    json!({}),
                    REQUEST_TIMEOUT,
                )
                .map_err(|_| "The Java project changed during discovery.")?;
                if after["snapshotHash"] != context.snapshot_hash
                    || after["generation"] != refresh["generation"]
                {
                    return Err(
                        "The Java project changed during discovery; synchronize again.".into(),
                    );
                }
                if !current_workspace_binding_is_current(&binding)
                    || registration.cancelled.load(Ordering::SeqCst)
                {
                    return Ok(reply(
                        &request,
                        "cancelled",
                        "Main-class discovery was retired.",
                        None,
                    ));
                }
                Ok(reply(
                    &request,
                    "ready",
                    if request.modern() {
                        "Provider-qualified main classes for the selected Java 25 profile."
                    } else {
                        "Classic declared main classes. Inherited and newer launch forms are not yet covered."
                    },
                    Some(raw),
                ))
            },
        );
        drop(registration);
        result
    })
}
