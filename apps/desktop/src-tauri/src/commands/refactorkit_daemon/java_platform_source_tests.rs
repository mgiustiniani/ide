use super::super::java_dependency_source::EditorSourceOverlay;
use super::super::java_navigation::Document;
use super::*;
use std::fs;

struct Fixture {
    root: std::path::PathBuf,
    request: Request,
    context: Value,
    response: Value,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "ide-platform-source-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let sdk = root.as_path().join("sdk");
        fs::create_dir_all(sdk.join("lib")).unwrap();
        fs::create_dir_all(root.as_path().join("src/main/java")).unwrap();
        fs::write(
            sdk.join("lib/modules"),
            "SDK image evidence belongs to the provider",
        )
        .unwrap();
        fs::write(
            sdk.join("lib/src.zip"),
            "Archive parsing belongs to the provider",
        )
        .unwrap();
        let main = "class Main { String value; }";
        fs::write(root.as_path().join("src/main/java/Main.java"), main).unwrap();
        let content = "public final class String {}";
        let request: Request = serde_json::from_value(json!({"workspaceId":"one","generation":1,"requestId":"sdk",
            "document":{"path":"src/main/java/Main.java","text":main,"version":1},"position":{"line":0,"character":14},
            "projectContext":{"projectPath":"","sdkHome":sdk,"mavenRepository":"/repository","activeMavenProfiles":[],"inactiveMavenProfiles":[],
                "snapshotHash":"a".repeat(64),"contextHash":"b".repeat(64),"platformIdentities":["c".repeat(64)]},
            "expectedAssociationHash":"d".repeat(64)})).unwrap();
        let context = json!({"sdk":[{"home":sdk,"identitySha256":"c".repeat(64),"sourceRelease":25,"platformRelease":25}],
            "modules":[{"providerId":"maven-effective-v1","id":"project","sourceSets":[{"id":"main","release":25,"sourceLevel":25,
                "sourceRoots":["src/main/java"],"generatedSourceRoots":[]}]}]});
        let response = json!({"schemaVersion":"java-platform-source-v1","status":"available","snapshotHash":"a".repeat(64),"contextHash":"b".repeat(64),
            "sdkIdentities":[{"sdkHome":sdk,"release":25,"identitySha256":"c".repeat(64)}],
            "sourceAuthority":{"kind":"saved-snapshot","baseSnapshotHash":"a".repeat(64)},"content":content,
            "association":{"associationHash":"d".repeat(64),"resourceUri":format!("refactorkit-java-platform-source://{}/java.base/java/lang/String.java","d".repeat(64)),
                "readOnly":true,"resourceKind":"java-platform-source","providerId":"maven-effective-v1","moduleId":"project","sourceSetId":"main",
                "sdkHome":sdk,"effectiveRelease":25,"platformRelease":25,"platformIdentitySha256":"c".repeat(64),"platformModule":"java.base",
                "binaryOrigin":{"kind":"CURRENT_JRT_IMAGE","uri":"jrt:/java.base/java/lang/String.class","classEntry":"java/lang/String.class",
                    "classSha256":"e".repeat(64),"moduleImagePath":sdk.join("lib/modules"),"moduleImageSha256":"f".repeat(64)},
                "sourceArchivePath":sdk.join("lib/src.zip"),"sourceArchiveSha256":"1".repeat(64),"sourceEntry":"java.base/java/lang/String.java",
                "sourceSha256":format!("{:x}",Sha256::digest(content.as_bytes())),"sourceFile":"String.java",
                "jvmIdentity":{"kind":"TYPE","ownerBinaryName":"java.lang.String","memberName":"","descriptor":"Ljava/lang/String;"}}});
        Self {
            root,
            request,
            context,
            response,
        }
    }
    fn read(&self, response: Value) -> Result<Value, String> {
        normalize(
            response,
            &self.request,
            "read",
            &self.context,
            &json!("0.7.0"),
            self.root.as_path(),
            &"c".repeat(64),
        )
    }
}

#[test]
fn sdk_sources_bind_current_release_standard_archive_and_actual_source_owner() {
    let f = Fixture::new();
    assert_eq!(
        f.read(f.response.clone()).unwrap()["association"]["resourceKind"],
        "java-platform-source"
    );
    for (pointer, value) in [
        ("/association/platformIdentitySha256", json!("0".repeat(64))),
        ("/association/effectiveRelease", json!(17)),
        ("/association/platformModule", json!("java.sql")),
        (
            "/association/binaryOrigin/classEntry",
            json!("java/lang/Object.class"),
        ),
        ("/association/sourceFile", json!("Object.java")),
        ("/association/sourceSetId", json!("test")),
        ("/sourceAuthority/kind", json!("immutable-editor-overlay")),
        (
            "/association/sourceArchivePath",
            json!(f.root.as_path().join("pom.xml")),
        ),
    ] {
        let mut changed = f.response.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(f.read(changed).is_err(), "accepted {pointer}");
    }
}

#[test]
fn sdk_sources_keep_native_api_profile_separate_from_source_target_syntax() {
    let mut f = Fixture::new();
    f.context["modules"][0]["sourceSets"][0]["sourceLevel"] = json!(8);
    f.context["modules"][0]["sourceSets"][0]["release"] = Value::Null;
    assert!(f.read(f.response.clone()).is_ok(), "Native SDK evidence must not be selected by language syntax");

    f.context["modules"][0]["sourceSets"][0]["release"] = json!(8);
    assert!(f.read(f.response.clone()).is_err(), "--release 8 cannot authorize current SDK sources");
    f.context["modules"][0]["sourceSets"][0]["release"] = Value::Null;
    f.context["sdk"][0]["sourceRelease"] = json!(8);
    assert!(f.read(f.response.clone()).is_err(), "Native API evidence must match the attested SDK profile");
}

#[test]
fn sdk_sources_accept_java_27_and_refuse_later_unqualified_releases() {
    let f = Fixture::new();
    let mut java27_context = f.context.clone();
    java27_context["sdk"][0]["sourceRelease"] = json!(27);
    java27_context["sdk"][0]["platformRelease"] = json!(27);
    java27_context["modules"][0]["sourceSets"][0]["release"] = json!(27);
    java27_context["modules"][0]["sourceSets"][0]["sourceLevel"] = json!(27);
    let mut java27_response = f.response.clone();
    java27_response["sdkIdentities"][0]["release"] = json!(27);
    java27_response["association"]["effectiveRelease"] = json!(27);
    java27_response["association"]["platformRelease"] = json!(27);
    assert!(normalize(
        java27_response,
        &f.request,
        "read",
        &java27_context,
        &json!("0.7.0"),
        f.root.as_path(),
        &"c".repeat(64),
    )
    .is_ok());

    let mut unsupported_context = java27_context;
    unsupported_context["sdk"][0]["sourceRelease"] = json!(28);
    unsupported_context["sdk"][0]["platformRelease"] = json!(28);
    unsupported_context["modules"][0]["sourceSets"][0]["release"] = json!(28);
    unsupported_context["modules"][0]["sourceSets"][0]["sourceLevel"] = json!(28);
    let mut unsupported_response = f.response.clone();
    unsupported_response["sdkIdentities"][0]["release"] = json!(28);
    unsupported_response["association"]["effectiveRelease"] = json!(28);
    unsupported_response["association"]["platformRelease"] = json!(28);
    assert!(normalize(
        unsupported_response,
        &f.request,
        "read",
        &unsupported_context,
        &json!("0.7.0"),
        f.root.as_path(),
        &"c".repeat(64),
    )
    .is_err());
}

#[test]
fn sdk_reads_verify_source_bytes_and_have_their_own_utf8_budget() {
    let f = Fixture::new();
    let mut changed = f.response.clone();
    changed["content"] = json!("changed source");
    assert!(f.read(changed).is_err());
    for bytes in [200000, 524288, 524290] {
        let content = "é".repeat(bytes / 2);
        let mut changed = f.response.clone();
        changed["content"] = json!(content);
        changed["association"]["sourceSha256"] =
            json!(format!("{:x}", Sha256::digest(content.as_bytes())));
        assert_eq!(f.read(changed).is_ok(), bytes <= 524288);
    }
}

#[test]
fn sdk_editor_proof_requires_every_current_document_and_exact_text_digest() {
    let mut f = Fixture::new();
    f.request.editor_overlay = Some(EditorSourceOverlay {
        expected_overlay_hash: "9".repeat(64),
        documents: vec![
            Document {
                path: f.request.document.path.clone(),
                text: f.request.document.text.clone(),
                version: 44,
            },
            Document {
                path: "src/main/java/Helper.java".into(),
                text: "class Helper { int draft; }".into(),
                version: 45,
            },
        ],
    });
    let documents = &f.request.editor_overlay.as_ref().unwrap().documents;
    f.response["providerSnapshotHash"] = json!("8".repeat(64));
    f.response["sourceAuthority"] = json!({"kind":"immutable-editor-overlay","baseSnapshotHash":"a".repeat(64),"overlayHash":"9".repeat(64),
        "documents":documents.iter().map(|d|json!({"path":d.path,"version":d.version,"contentSha256":format!("{:x}",Sha256::digest(d.text.as_bytes()))})).collect::<Vec<_>>()});
    f.read(f.response.clone()).expect("The complete SDK editor frame must remain valid");
    for (pointer, value) in [
        ("/sourceAuthority/documents/1/version", json!(46)),
        (
            "/sourceAuthority/documents/1/contentSha256",
            json!("f".repeat(64)),
        ),
        ("/sourceAuthority/overlayHash", json!("0".repeat(64))),
    ] {
        let mut changed = f.response.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(f.read(changed).is_err());
    }
}

#[test]
fn sdk_ambiguity_never_authorizes_a_source_or_a_declaration_range() {
    let f = Fixture::new();
    let raw = json!({"schemaVersion":"java-platform-source-v1","status":"ambiguous","reason":{"code":"java.platformSources.binaryOriginAmbiguous","message":"More than one SDK origin."}});
    let result = f.read(raw.clone()).unwrap();
    assert!(result["association"].is_null());
    let mut unsafe_result = raw;
    unsafe_result["association"] = f.response["association"].clone();
    assert!(f.read(unsafe_result).is_err());
}

#[test]
fn missing_standard_source_archive_returns_correlated_unavailable_without_provider_evidence() {
    let f = Fixture::new();
    fs::remove_file(f.root.join("sdk/lib/src.zip")).unwrap();
    let sdk = Path::new(f.request.project_context.sdk_home.as_str());

    for operation in ["lookup", "declaration", "read"] {
        let result = unavailable_without_standard_archive(&f.request, operation, sdk).unwrap();
        assert_eq!(result["status"], "unavailable");
        assert_eq!(result["operation"], operation);
        assert_eq!(result["requestId"], f.request.request_id);
        assert_eq!(
            result["reason"]["code"],
            "java.platformSources.archiveUnavailable"
        );
        assert!(result["association"].is_null());
        assert!(result["declaration"].is_null());
        assert!(result["content"].is_null());
    }

    fs::write(f.root.join("sdk/lib/src.zip"), "source archive").unwrap();
    assert!(unavailable_without_standard_archive(&f.request, "lookup", sdk).is_none());
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
