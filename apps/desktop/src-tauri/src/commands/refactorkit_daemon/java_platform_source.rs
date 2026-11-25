//! Consume SDK source evidence through the selected RefactorKit project session.
use super::java_dependency_source::{
    before, correlation, hash, provider_overlay_documents, refusal, relative, text, valid_range,
    Declaration, Request,
};

#[cfg(test)]
#[path = "java_platform_source_tests.rs"]
mod tests;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Identity {
    kind: String,
    owner_binary_name: String,
    member_name: String,
    descriptor: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Origin {
    kind: String,
    uri: String,
    class_entry: String,
    class_sha256: String,
    module_image_path: String,
    module_image_sha256: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Association {
    association_hash: String,
    resource_uri: String,
    read_only: bool,
    resource_kind: String,
    provider_id: String,
    module_id: String,
    source_set_id: String,
    sdk_home: String,
    effective_release: u64,
    platform_release: u64,
    platform_identity_sha256: String,
    platform_module: String,
    binary_origin: Origin,
    source_archive_path: String,
    source_archive_sha256: String,
    source_entry: String,
    source_sha256: String,
    source_file: String,
    jvm_identity: Identity,
}

pub(super) fn unavailable_without_standard_archive(
    request: &Request,
    operation: &str,
    sdk: &Path,
) -> Option<Value> {
    (!sdk.join("lib/src.zip").is_file()).then(|| {
        refusal(
            request,
            operation,
            "unavailable",
            "java.platformSources.archiveUnavailable",
            "The selected JDK does not contain its standard lib/src.zip source archive.",
        )
    })
}

fn source_owner(context: &Value, request: &Request, a: &Association, project: &Path) -> bool {
    let path = request
        .document
        .path
        .strip_prefix(&format!("{}/", request.project_context.project_path))
        .unwrap_or(&request.document.path);
    let Ok(file) = project.join(path).canonicalize() else {
        return false;
    };
    if !file.starts_with(project) {
        return false;
    }
    context["modules"].as_array().is_some_and(|modules| {
        modules
            .iter()
            .filter(|module| {
                module["id"] == a.module_id
                    && module["providerId"] == a.provider_id
                    && module["sourceSets"].as_array().is_some_and(|sets| {
                        sets.iter()
                            .filter(|set| {
                                // A source/target language level does not restrict SDK APIs.
                                // Native-image evidence must still match the SDK profile below;
                                // an explicit --release additionally constrains this source set.
                                let release_matches = if set["release"].is_null() {
                                    a.effective_release == a.platform_release
                                } else {
                                    set["release"].as_u64() == Some(a.effective_release)
                                };
                                set["id"] == a.source_set_id
                                    && release_matches
                                    && ["sourceRoots", "generatedSourceRoots"].iter().any(|key| {
                                        set[*key].as_array().is_some_and(|roots| {
                                            roots.iter().any(|root| {
                                                let Some(root) = root.as_str() else {
                                                    return false;
                                                };
                                                if root != "." && !relative(root) {
                                                    return false;
                                                }
                                                project.join(root).canonicalize().is_ok_and(
                                                    |root| {
                                                        root.starts_with(project)
                                                            && file.starts_with(root)
                                                    },
                                                )
                                            })
                                        })
                                    })
                            })
                            .count()
                            == 1
                    })
            })
            .count()
            == 1
    })
}

pub(super) fn normalize(
    response: Value,
    request: &Request,
    operation: &str,
    context: &Value,
    version: &Value,
    project: &Path,
    expected_identity: &str,
) -> Result<Value, String> {
    let invalid = || "Invalid or stale selected-SDK source evidence.".to_owned();
    let schema = if operation == "declaration" {
        "java-platform-source-declaration-v1"
    } else {
        "java-platform-source-v1"
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
        if !response["association"].is_null()
            || !response["declaration"].is_null()
            || !response["content"].is_null()
            || (status == "ambiguous"
                && !matches!(
                    code,
                    "java.platformSources.binaryOriginAmbiguous"
                        | "java.platformSources.declarationAmbiguous"
                ))
        {
            return Err(invalid());
        }
        result["reason"] = json!({"code":code,"message":message});
        return Ok(result);
    }
    if status != "available"
        || response["snapshotHash"] != request.project_context.snapshot_hash
        || response["contextHash"] != request.project_context.context_hash
    {
        return Err(invalid());
    }
    let identities = response["sdkIdentities"].as_array().ok_or_else(invalid)?;
    let sdks = context["sdk"].as_array().ok_or_else(invalid)?;
    if identities.len() != sdks.len()
        || identities.iter().zip(sdks).any(|(actual, sdk)| {
            actual["identitySha256"] != sdk["identitySha256"]
                || actual["sdkHome"] != sdk["home"]
                || actual["release"] != sdk["sourceRelease"]
        })
    {
        return Err(invalid());
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
        result["providerSnapshotHash"] = proof["providerSnapshotHash"].clone();
        result["sourceAuthority"] = json!({"kind":"immutable-editor-overlay", "baseSnapshotHash":proof["baseSnapshotHash"],
            "overlayHash":proof["overlayHash"],"documents":proof["documents"]});
    } else {
        if response["sourceAuthority"]["kind"] != "saved-snapshot"
            || response["sourceAuthority"]["baseSnapshotHash"]
                != request.project_context.snapshot_hash
            || !response["providerSnapshotHash"].is_null()
            || !response["sourceAuthority"]["documents"].is_null()
            || !response["sourceAuthority"]["overlayHash"].is_null()
        {
            return Err(invalid());
        }
        result["sourceAuthority"] = json!({"kind":"saved-snapshot","baseSnapshotHash":request.project_context.snapshot_hash});
    }
    let a: Association =
        serde_json::from_value(response["association"].clone()).map_err(|_| invalid())?;
    let sdk = Path::new(&request.project_context.sdk_home)
        .canonicalize()
        .map_err(|_| invalid())?;
    if !a.read_only
        || a.resource_kind != "java-platform-source"
        || a.binary_origin.kind != "CURRENT_JRT_IMAGE"
        || a.platform_identity_sha256 != expected_identity
        || a.effective_release != a.platform_release
        || !(8..=27).contains(&a.effective_release)
        || ![
            &a.association_hash,
            &a.platform_identity_sha256,
            &a.source_archive_sha256,
            &a.source_sha256,
            &a.binary_origin.class_sha256,
            &a.binary_origin.module_image_sha256,
        ]
        .iter()
        .all(|v| hash(v))
        || ![
            &a.provider_id,
            &a.module_id,
            &a.source_set_id,
            &a.platform_module,
            &a.sdk_home,
            &a.source_archive_path,
            &a.binary_origin.module_image_path,
        ]
        .iter()
        .all(|v| text(v, 4096, false))
        || !relative(&a.source_entry)
        || !relative(&a.binary_origin.class_entry)
        || a.platform_module.contains('/')
        || a.platform_module.contains('\\')
        || a.platform_module.split('.').any(|p| p.is_empty())
        || !text(&a.source_file, 4096, false)
        || a.source_file.contains('/')
        || a.source_file.contains('\\')
        || !a.source_file.ends_with(".java")
        || !matches!(a.jvm_identity.kind.as_str(), "TYPE" | "CALLABLE" | "FIELD")
        || !text(&a.jvm_identity.owner_binary_name, 4096, false)
        || !text(&a.jvm_identity.member_name, 1024, true)
        || !text(&a.jvm_identity.descriptor, 16384, false)
        || Path::new(&a.sdk_home) != sdk
        || Path::new(&a.binary_origin.module_image_path)
            .canonicalize()
            .ok()
            != sdk.join("lib/modules").canonicalize().ok()
        || !Path::new(&a.binary_origin.module_image_path).is_file()
        || Path::new(&a.source_archive_path).canonicalize().ok()
            != sdk.join("lib/src.zip").canonicalize().ok()
        || !Path::new(&a.source_archive_path).is_file()
        || !source_owner(context, request, &a, project)
        || sdks
            .iter()
            .filter(|entry| {
                entry["home"] == a.sdk_home
                    && entry["identitySha256"] == expected_identity
                    && entry["sourceRelease"] == a.effective_release
                    && entry["platformRelease"] == a.platform_release
            })
            .count()
            != 1
    {
        return Err(invalid());
    }
    let class_entry = format!(
        "{}.class",
        a.jvm_identity.owner_binary_name.replace('.', "/")
    );
    let package = a
        .jvm_identity
        .owner_binary_name
        .rsplit_once('.')
        .map(|(p, _)| format!("{}/", p.replace('.', "/")))
        .unwrap_or_default();
    if a.binary_origin.class_entry != class_entry
        || a.source_entry != format!("{}/{package}{}", a.platform_module, a.source_file)
    {
        return Err(invalid());
    }
    let uri = url::Url::parse(&a.resource_uri).map_err(|_| invalid())?;
    let binary = url::Url::parse(&a.binary_origin.uri).map_err(|_| invalid())?;
    let decoded = |path: &str| {
        percent_encoding::percent_decode_str(path)
            .decode_utf8()
            .map(|v| v.into_owned())
            .map_err(|_| invalid())
    };
    if uri.scheme() != "refactorkit-java-platform-source"
        || uri.host_str() != Some(&a.association_hash)
        || uri.port().is_some()
        || !uri.username().is_empty()
        || uri.password().is_some()
        || uri.query().is_some()
        || uri.fragment().is_some()
        || decoded(uri.path().trim_start_matches('/'))? != a.source_entry
        || binary.scheme() != "jrt"
        || binary.host_str().is_some()
        || binary.query().is_some()
        || binary.fragment().is_some()
        || decoded(binary.path())? != format!("/{}/{class_entry}", a.platform_module)
    {
        return Err(invalid());
    }
    if request
        .expected_association_hash
        .as_ref()
        .is_some_and(|expected| expected != &a.association_hash)
    {
        return Err(invalid());
    }
    if operation == "read" {
        if request.expected_association_hash.as_deref() != Some(&a.association_hash) {
            return Err(invalid());
        }
        let content = response["content"]
            .as_str()
            .filter(|s| s.len() <= 524288)
            .ok_or_else(invalid)?;
        if format!("{:x}", Sha256::digest(content.as_bytes())) != a.source_sha256 {
            return Err(invalid());
        }
        result["content"] = json!(content);
    }
    if operation == "declaration" {
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
    for key in [
        "schemaVersion",
        "snapshotHash",
        "contextHash",
        "sdkIdentities",
    ] {
        result[key] = response[key].clone();
    }
    result["association"] = serde_json::to_value(a).map_err(|_| invalid())?;
    Ok(result)
}
