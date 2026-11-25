//! Read-only dependency sources through the existing selected project-context session.
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::java_navigation::{source, valid_position, Document, Position, ProjectContext};
use super::java_project_context::{
    validate_operation_settings, with_selected_session, JavaProjectContextState, Manager,
};
use super::transport::{session_call_detailed, REQUEST_TIMEOUT};
use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{
    current_workspace_binding_at, current_workspace_binding_is_current, CurrentWorkspaceBinding,
};
use crate::workspace::workspace_root;

#[cfg(test)]
#[path = "java_dependency_source_tests.rs"]
mod tests;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub(super) workspace_id: String,
    pub(super) generation: u64,
    pub(super) request_id: String,
    pub(super) document: Document,
    pub(super) position: Position,
    pub(super) project_context: ProjectContext,
    pub(super) expected_association_hash: Option<String>,
    pub(super) editor_overlay: Option<EditorSourceOverlay>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditorSourceOverlay {
    pub(super) expected_overlay_hash: String,
    pub(super) documents: Vec<Document>,
}

pub(super) fn provider_overlay_documents(
    request: &Request,
) -> Result<Option<Vec<Document>>, String> {
    let Some(overlay) = &request.editor_overlay else {
        return Ok(None);
    };
    if !hash(&overlay.expected_overlay_hash)
        || overlay.documents.is_empty()
        || overlay.documents.len() > 128
        || overlay
            .documents
            .iter()
            .map(|document| document.text.len())
            .sum::<usize>()
            > 786432
        || overlay.documents.iter().any(|document| {
            !relative(&document.path)
                || !document.path.ends_with(".java")
                || document.version == 0
                || document.version > i32::MAX as u64
        })
        || overlay
            .documents
            .iter()
            .map(|document| &document.path)
            .collect::<std::collections::HashSet<_>>()
            .len()
            != overlay.documents.len()
        || !overlay.documents.iter().any(|document| {
            document.path == request.document.path && document.text == request.document.text
        })
    {
        return Err("Invalid immutable dependency-source editor frame.".into());
    }
    let mut documents = overlay.documents.clone();
    for document in &mut documents {
        if !request.project_context.project_path.is_empty() {
            document.path = document
                .path
                .strip_prefix(&format!("{}/", request.project_context.project_path))
                .ok_or("A Java editor buffer is outside the selected project.")?
                .into();
        }
        if !relative(&document.path) {
            return Err("Invalid Java editor buffer path.".into());
        }
    }
    Ok(Some(documents))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    kind: String,
    owner_binary_name: String,
    member_name: String,
    descriptor: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Provenance {
    kind: String,
    component_id: String,
    source_file: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Association {
    association_hash: String,
    resource_uri: String,
    read_only: bool,
    provider_id: String,
    module_id: String,
    source_set_id: String,
    binary_path: String,
    binary_sha256: String,
    source_archive_path: String,
    source_archive_sha256: String,
    source_entry: String,
    source_sha256: String,
    jvm_identity: Identity,
    provenance: Provenance,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SourcePoint {
    pub(super) line: u64,
    pub(super) character: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SourceRange {
    pub(super) start: SourcePoint,
    pub(super) end: SourcePoint,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Declaration {
    pub(super) declaration_range: SourceRange,
    pub(super) name_range: SourceRange,
    pub(super) evidence: String,
    pub(super) binding_key: String,
}
pub(super) fn before(a: &SourcePoint, b: &SourcePoint) -> bool {
    (a.line, a.character) <= (b.line, b.character)
}
pub(super) fn valid_range(range: &SourceRange) -> bool {
    [&range.start, &range.end]
        .iter()
        .all(|p| p.line <= i32::MAX as u64 && p.character <= i32::MAX as u64)
        && before(&range.start, &range.end)
        && (range.start.line, range.start.character) != (range.end.line, range.end.character)
}

pub(super) fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(super) fn text(value: &str, max: usize, empty: bool) -> bool {
    (empty || !value.is_empty()) && value.len() <= max && !value.chars().any(char::is_control)
}
pub(super) fn relative(value: &str) -> bool {
    text(value, 4096, false)
        && !value.contains([':', '\\'])
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn available_method(capabilities: &Value, name: &str) -> bool {
    if capabilities["name"] != "RefactorKit"
        || capabilities["apiVersion"] != "0.2"
        || capabilities["protocol"] != "json-rpc-2.0"
        || capabilities["transport"] != "stdio"
    {
        return false;
    }
    let Some(methods) = capabilities["methods"].as_array() else {
        return false;
    };
    let matches: Vec<_> = methods
        .iter()
        .filter(|method| method["name"] == name)
        .collect();
    matches.len() == 1
        && matches[0]["requiresProject"] == true
        && matches[0]["writesWorkspace"] == false
}
pub(super) fn correlation(request: &Request, operation: &str) -> Value {
    json!({"workspaceId":request.workspace_id,"generation":request.generation,"requestId":request.request_id,
        "documentPath":request.document.path,"documentVersion":request.document.version,"operation":operation})
}
pub(super) fn refusal(
    request: &Request,
    operation: &str,
    status: &str,
    code: &str,
    message: &str,
) -> Value {
    let mut result = correlation(request, operation);
    result["status"] = json!(status);
    result["reason"] = json!({"code":code,"message":message});
    result
}

fn normalize(
    response: Value,
    request: &Request,
    operation: &str,
    context: &Value,
    version: &Value,
    project: &Path,
) -> Result<Value, String> {
    let invalid = || "Invalid or uncorrelated RefactorKit dependency source response.".to_string();
    let schema = if request.editor_overlay.is_some() {
        if operation == "declaration" {
            "java-editor-dependency-source-declaration-v1"
        } else {
            "java-editor-dependency-source-v1"
        }
    } else if operation == "declaration" {
        "java-dependency-source-declaration-v1"
    } else {
        "java-dependency-source-v1"
    };
    if response["schemaVersion"] != schema {
        return Err(invalid());
    }
    let status = response["status"].as_str().ok_or_else(invalid)?;
    let mut result = correlation(request, operation);
    result["status"] = json!(status);
    result["providerVersion"] = version.clone();
    if matches!(status, "unavailable" | "ambiguous" | "refused") {
        let code = response["reason"]["code"]
            .as_str()
            .filter(|v| text(v, 256, false))
            .ok_or_else(invalid)?;
        let message = response["reason"]["message"]
            .as_str()
            .filter(|v| text(v, 4096, false))
            .ok_or_else(invalid)?;
        result["reason"] = json!({"code":code,"message":message});
        if status == "ambiguous" && response["candidates"].is_array() {
            let candidates = response["candidates"]
                .as_array()
                .filter(|c| (2..=128).contains(&c.len()))
                .ok_or_else(invalid)?;
            let paths: Vec<_> = candidates
                .iter()
                .map(|c| {
                    c["binaryPath"]
                        .as_str()
                        .filter(|p| text(p, 4096, false) && Path::new(p).is_absolute())
                        .map(|p| json!({"binaryPath":p}))
                        .ok_or_else(invalid)
                })
                .collect::<Result<_, _>>()?;
            result["candidates"] = json!(paths);
        } else if status == "ambiguous"
            && !(operation == "declaration" && code == "java.sources.declarationAmbiguous")
        {
            return Err(invalid());
        }
        return Ok(result);
    }
    if status != "available"
        || response["snapshotHash"] != request.project_context.snapshot_hash
        || response["contextHash"] != request.project_context.context_hash
    {
        return Err("The dependency source response does not match the selected project snapshot and context.".into());
    }
    let identities = response["sdkIdentities"].as_array().ok_or_else(invalid)?;
    let expected = context["sdk"].as_array().ok_or_else(invalid)?;
    if identities.len() != expected.len()
        || identities.iter().zip(expected).any(|(a, b)| {
            a["identitySha256"] != b["identitySha256"]
                || a["sdkHome"] != b["home"]
                || a["release"] != b["sourceRelease"]
        })
    {
        return Err(
            "The dependency source SDK identities do not match the selected project SDK.".into(),
        );
    }
    if let Some(overlay) = &request.editor_overlay {
        let documents = provider_overlay_documents(request)?.ok_or_else(invalid)?;
        let mut proof = super::java_navigation::normalize_editor_overlay_authority(
            &response,
            &documents,
            &request.project_context.snapshot_hash,
            Some(&overlay.expected_overlay_hash),
        )?;
        if !request.project_context.project_path.is_empty() {
            for document in proof["documents"].as_array_mut().ok_or_else(invalid)? {
                document["path"] = json!(format!(
                    "{}/{}",
                    request.project_context.project_path,
                    document["path"].as_str().ok_or_else(invalid)?
                ));
            }
        }
        result["editorOverlay"] = proof;
    }
    let a: Association = serde_json::from_value(response["association"].clone())
        .map_err(|_| "The dependency source association has an invalid contract.".to_owned())?;
    if !a.read_only
        || ![
            &a.association_hash,
            &a.binary_sha256,
            &a.source_archive_sha256,
            &a.source_sha256,
        ]
        .iter()
        .all(|s| hash(s))
        || !text(&a.resource_uri, 8192, false)
        || url::Url::parse(&a.resource_uri)
            .map_or(true, |uri| uri.scheme() != "refactorkit-java-source")
        || ![
            &a.provider_id,
            &a.module_id,
            &a.source_set_id,
            &a.binary_path,
            &a.source_archive_path,
        ]
        .iter()
        .all(|s| text(s, 4096, false))
        || !Path::new(&a.binary_path).is_absolute()
        || !Path::new(&a.source_archive_path).is_absolute()
        || !relative(&a.source_entry)
        || !a.source_entry.ends_with(".java")
        || !matches!(a.jvm_identity.kind.as_str(), "TYPE" | "CALLABLE" | "FIELD")
        || !text(&a.jvm_identity.owner_binary_name, 4096, false)
        || !text(&a.jvm_identity.member_name, 1024, true)
        || !text(&a.jvm_identity.descriptor, 16384, true)
        || ![
            &a.provenance.kind,
            &a.provenance.component_id,
            &a.provenance.source_file,
        ]
        .iter()
        .all(|s| text(s, 4096, false))
        || a.source_entry.rsplit('/').next() != Some(a.provenance.source_file.as_str())
    {
        return Err(
            "The dependency source association is not a valid read-only Java source attachment."
                .into(),
        );
    }
    // Validate against provider-owned classpath metadata; no dependency discovery happens here.
    let entries = context["modules"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .filter(|module| module["id"] == a.module_id)
        .flat_map(|module| module["sourceSets"].as_array().into_iter().flatten())
        .filter(|source_set| source_set["id"] == a.source_set_id)
        .flat_map(|source_set| {
            source_set["compileClasspath"]
                .as_array()
                .into_iter()
                .flatten()
        });
    if !entries.into_iter().any(|entry| {
        entry["providerId"] == a.provider_id
            && entry["path"].as_str().is_some_and(|path| {
                let provider_path = Path::new(path);
                if provider_path.is_absolute() {
                    provider_path == Path::new(&a.binary_path)
                } else {
                    relative(path) && project.join(provider_path) == Path::new(&a.binary_path)
                }
            })
    }) {
        return Err(
            "The dependency source binary is outside the selected provider classpath.".into(),
        );
    }
    if operation == "read" {
        if request.expected_association_hash.as_deref() != Some(a.association_hash.as_str()) {
            return Err(invalid());
        }
        let content = response["content"]
            .as_str()
            .filter(|content| content.len() <= 131072)
            .ok_or_else(invalid)?;
        if format!("{:x}", Sha256::digest(content.as_bytes())) != a.source_sha256 {
            return Err(invalid());
        }
        result["content"] = json!(content);
    }
    if operation == "declaration" {
        if request
            .expected_association_hash
            .as_deref()
            .is_some_and(|expected| expected != a.association_hash)
        {
            return Err(invalid());
        }
        let declaration: Declaration =
            serde_json::from_value(response["declaration"].clone()).map_err(|_| invalid())?;
        if declaration.evidence != "JDT_SOURCE_BINDING"
            || !text(&declaration.binding_key, 16384, false)
            || !valid_range(&declaration.name_range)
            || !valid_range(&declaration.declaration_range)
            || !before(
                &declaration.declaration_range.start,
                &declaration.name_range.start,
            )
            || !before(
                &declaration.name_range.end,
                &declaration.declaration_range.end,
            )
        {
            return Err(invalid());
        }
        result["declaration"] = serde_json::to_value(declaration).map_err(|_| invalid())?;
    }
    result["schemaVersion"] = response["schemaVersion"].clone();
    result["snapshotHash"] = response["snapshotHash"].clone();
    result["contextHash"] = response["contextHash"].clone();
    result["sdkIdentities"] = response["sdkIdentities"].clone();
    result["association"] = serde_json::to_value(a).map_err(|_| invalid())?;
    Ok(result)
}

pub(super) fn query(
    binding: CurrentWorkspaceBinding,
    request: Request,
    operation: &'static str,
    shared: Arc<Manager>,
) -> Result<Value, String> {
    query_source(binding, request, operation, shared, None)
}

pub(super) fn query_source(
    binding: CurrentWorkspaceBinding,
    request: Request,
    operation: &'static str,
    shared: Arc<Manager>,
    platform_identity: Option<String>,
) -> Result<Value, String> {
    let namespace = if platform_identity.is_some() {
        "java.platformSources"
    } else {
        "java.sources"
    };
    if platform_identity.as_ref().is_some_and(|identity| {
        !hash(identity)
            || !request
                .project_context
                .platform_identities
                .contains(identity)
    }) {
        return Ok(refusal(
            &request,
            operation,
            "refused",
            "java.platformSources.invalidRequest",
            "Select the platform identity from the current effective project context.",
        ));
    }
    let context = &request.project_context;
    let (project, sdk) = validate_operation_settings(
        &binding,
        request.generation,
        &context.context_schema_version,
        &context.project_path,
        &context.sdk_home,
        &context.maven_repository,
        &context.active_maven_profiles,
        &context.inactive_maven_profiles,
    )?;
    if request.workspace_id != binding.workspace_id
        || !matches!(operation, "lookup" | "read" | "declaration")
        || request.generation == 0
        || request.generation > 9_007_199_254_740_991
        || !text(&request.request_id, 128, false)
        || request.document.version == 0
        || request.document.version > i32::MAX as u64
        || request.document.text.len() > 1048576
        || !request.document.path.ends_with(".java")
        || !hash(&context.snapshot_hash)
        || !hash(&context.context_hash)
        || context.platform_identities.is_empty()
        || context.platform_identities.len() > 256
        || !context.platform_identities.iter().all(|s| hash(s))
        || (operation == "read"
            && request
                .expected_association_hash
                .as_deref()
                .is_none_or(|s| !hash(s)))
        || (operation == "lookup" && request.expected_association_hash.is_some())
        || request
            .expected_association_hash
            .as_deref()
            .is_some_and(|value| !hash(value))
    {
        return Ok(refusal(
            &request,
            operation,
            "refused",
            &format!("{namespace}.invalidRequest"),
            "Invalid dependency source authority or cursor.",
        ));
    }
    let saved = source(&binding.canonical_root, &request.document.path)?;
    if (request.editor_overlay.is_none() && saved != request.document.text)
        || !valid_position(&request.document.text, &request.position)
    {
        return Ok(refusal(&request,operation,"refused",&format!("{namespace}.unsavedCursor"),"Dependency-source navigation requires the current saved Java source. Your editor draft is preserved."));
    }
    let overlay_documents = provider_overlay_documents(&request)?;
    let overlay_saved = request
        .editor_overlay
        .as_ref()
        .map(|overlay| {
            overlay
                .documents
                .iter()
                .map(|document| {
                    source(&binding.canonical_root, &document.path).map(|text| {
                        (
                            document.path.clone(),
                            format!("{:x}", Sha256::digest(text.as_bytes())),
                        )
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let full = binding
        .canonical_root
        .join(&request.document.path)
        .canonicalize()
        .map_err(|_| "Java source unavailable.")?;
    let relative = full
        .strip_prefix(&project)
        .map_err(|_| "The Java source is outside the selected project.")?
        .to_string_lossy()
        .replace('\\', "/");
    let expected = serde_json::to_value(context).map_err(|_| "Invalid Java project context.")?;
    let result = with_selected_session(
        &shared,
        &binding,
        request.generation,
        &expected,
        |active| {
            if platform_identity.is_some() {
                if let Some(unavailable) =
                    super::java_platform_source::unavailable_without_standard_archive(
                        &request, operation, &sdk,
                    )
                {
                    if source(&binding.canonical_root, &request.document.path)? != saved
                        || overlay_saved.as_ref().is_some_and(|documents| {
                            documents.iter().any(|(path, hash)| {
                                source(&binding.canonical_root, path).map_or(true, |text| {
                                    format!("{:x}", Sha256::digest(text.as_bytes())) != *hash
                                })
                            })
                        })
                        || !current_workspace_binding_is_current(&binding)
                    {
                        return Ok(refusal(
                            &request,
                            operation,
                            "refused",
                            "java.platformSources.staleContext",
                            "The Java source or workspace changed during SDK source navigation.",
                        ));
                    }
                    return Ok(unavailable);
                }
            }
            let method = if platform_identity.is_some() {
                format!("java.platformSource.{operation}")
            } else {
                format!(
                    "java.dependencySource{}.{operation}",
                    if request.editor_overlay.is_some() {
                        ".editor"
                    } else {
                        ""
                    }
                )
            };
            let editor_capability = platform_identity.is_some()
                || request.editor_overlay.is_none()
                || active.capabilities["methods"]
                    .as_array()
                    .is_some_and(|methods| {
                        methods.iter().any(|entry| {
                            entry["name"] == method
                                && entry["features"]["immutableEditorContext"] == true
                        })
                    });
            if !available_method(&active.capabilities, &method) || !editor_capability {
                return Ok(refusal(&request,operation,"unavailable",&format!("{namespace}.providerUnavailable"),"This RefactorKit delivery does not support the requested read-only source navigation."));
            }
            let observed = active
                .observed_context()
                .cloned()
                .ok_or("Java context is unavailable.")?;
            let mut params = json!({"expectedSnapshotHash":context.snapshot_hash,"expectedContextHash":context.context_hash,"sdkHome":context.sdk_home,
            "path":relative,"position":{"line":request.position.line,"character":request.position.character}});
            if let Some(identity) = &platform_identity {
                params["expectedPlatformIdentitySha256"] = json!(identity);
                params["sourceAuthority"] = json!({"kind":"saved-snapshot"});
            }
            if request.expected_association_hash.is_some() {
                params["expectedAssociationHash"] = json!(request.expected_association_hash);
            }
            if let (Some(overlay), Some(documents)) = (&request.editor_overlay, &overlay_documents)
            {
                params["expectedOverlayHash"] = json!(overlay.expected_overlay_hash);
                params["sourceAuthority"] = json!({"kind":"immutable-editor-overlay",
                    "documents":documents.iter().map(|document| json!({"path":document.path,
                        "version":document.version,"content":document.text})).collect::<Vec<_>>()});
            }
            let response =
                session_call_detailed(&mut active.session, &method, params, REQUEST_TIMEOUT)
                    .map_err(|error| error.message().to_owned())?;
            let result = if let Some(identity) = &platform_identity {
                super::java_platform_source::normalize(
                    response,
                    &request,
                    operation,
                    &observed,
                    &active.capabilities["version"],
                    &project,
                    identity,
                )?
            } else {
                normalize(
                    response,
                    &request,
                    operation,
                    &observed,
                    &active.capabilities["version"],
                    &project,
                )?
            };
            if source(&binding.canonical_root, &request.document.path)? != saved
                || overlay_saved.as_ref().is_some_and(|documents| {
                    documents.iter().any(|(path, hash)| {
                        source(&binding.canonical_root, path).map_or(true, |text| {
                            format!("{:x}", Sha256::digest(text.as_bytes())) != *hash
                        })
                    })
                })
                || !current_workspace_binding_is_current(&binding)
            {
                return Err(
                    "The Java source or workspace changed during dependency navigation.".into(),
                );
            }
            Ok(result)
        },
    );
    Ok(result.unwrap_or_else(|message| {
        refusal(
            &request,
            operation,
            "refused",
            &format!("{namespace}.staleContext"),
            &message,
        )
    }))
}

pub(super) fn prepare_query(
    request: Request,
    state: &JavaProjectContextState,
    operation: &'static str,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    let shared = state.shared();
    Ok(move || query(binding, request, operation, shared))
}

pub(super) fn prepare_platform_query(
    request: Request,
    state: &JavaProjectContextState,
    operation: &'static str,
    platform_identity: String,
) -> Result<impl FnOnce() -> Result<Value, String> + Send + 'static, String> {
    let binding = current_workspace_binding_at(&workspace_root()?, &workspace_registry_path()?)?;
    let shared = state.shared();
    Ok(move || query_source(binding, request, operation, shared, Some(platform_identity)))
}
