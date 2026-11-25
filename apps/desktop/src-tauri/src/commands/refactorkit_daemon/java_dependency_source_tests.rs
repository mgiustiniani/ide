use super::*;

#[test]
fn editor_source_requires_the_selected_complete_frame_and_attested_content() {
    let (mut request, context, mut response) = fixture();
    request.editor_overlay = Some(EditorSourceOverlay {
        expected_overlay_hash: "9".repeat(64),
        documents: vec![
            Document {
                path: request.document.path.clone(),
                text: request.document.text.clone(),
                version: 44,
            },
            Document {
                path: "Helper.java".into(),
                text: "class Helper { int draft; }".into(),
                version: 45,
            },
        ],
    });
    response["schemaVersion"] = json!("java-editor-dependency-source-v1");
    response["providerSnapshotHash"] = json!("8".repeat(64));
    response["sourceAuthority"] = json!({"kind":"immutable-editor-overlay","baseSnapshotHash":request.project_context.snapshot_hash,
        "overlayHash":"9".repeat(64),"documents":request.editor_overlay.as_ref().unwrap().documents.iter()
            .map(|document| json!({"path":document.path,"version":document.version,"contentSha256":format!("{:x}",Sha256::digest(document.text.as_bytes()))})).collect::<Vec<_>>()});
    let result = normalize(
        response.clone(),
        &request,
        "read",
        &context,
        &json!("0.7.0"),
        Path::new("/project"),
    )
    .unwrap();
    assert_eq!(
        result["editorOverlay"]["documents"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for (pointer, value) in [
        ("/schemaVersion", json!("java-dependency-source-v1")),
        ("/providerSnapshotHash", Value::Null),
        ("/sourceAuthority/kind", json!("saved-snapshot")),
        ("/sourceAuthority/overlayHash", json!("0".repeat(64))),
        ("/sourceAuthority/documents/1/version", json!(46)),
        (
            "/sourceAuthority/documents/1/contentSha256",
            json!("f".repeat(64)),
        ),
    ] {
        let mut changed = response.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            normalize(
                changed,
                &request,
                "read",
                &context,
                &json!("0.7.0"),
                Path::new("/project")
            )
            .is_err(),
            "{pointer}"
        );
    }
    request.editor_overlay.as_mut().unwrap().documents.pop();
    assert!(normalize(
        response,
        &request,
        "read",
        &context,
        &json!("0.7.0"),
        Path::new("/project")
    )
    .is_err());
}

#[test]
fn workspace_relative_provider_classpath_keeps_the_same_binary_owner() {
    let (request, mut context, mut response) = fixture();
    context["modules"][0]["sourceSets"][0]["compileClasspath"][0]["path"] =
        json!("repository/library.jar");
    response["association"]["binaryPath"] = json!("/project/repository/library.jar");
    assert_eq!(
        normalize(
            response.clone(),
            &request,
            "read",
            &context,
            &json!("0.7.0"),
            Path::new("/project")
        )
        .unwrap()["status"],
        "available"
    );
    for path in [
        "../repository/library.jar",
        "/other/repository/library.jar",
        "repository/../../library.jar",
    ] {
        let mut changed = context.clone();
        changed["modules"][0]["sourceSets"][0]["compileClasspath"][0]["path"] = json!(path);
        assert!(normalize(
            response.clone(),
            &request,
            "read",
            &changed,
            &json!("0.7.0"),
            Path::new("/project")
        )
        .is_err());
    }
}

#[test]
fn declaration_ranges_require_jdt_evidence_a_nonempty_name_and_containment() {
    let (request, context, mut response) = fixture();
    response["schemaVersion"] = json!("java-dependency-source-declaration-v1");
    response["declaration"] = json!({"nameRange":{"start":{"line":0,"character":31},"end":{"line":0,"character":38}},
        "declarationRange":{"start":{"line":0,"character":18},"end":{"line":0,"character":41}},"evidence":"JDT_SOURCE_BINDING","bindingKey":"Lexternal/Library;"});
    let result = normalize(
        response.clone(),
        &request,
        "declaration",
        &context,
        &json!("0.7.0"),
        Path::new("/project"),
    )
    .unwrap();
    assert_eq!(
        result["declaration"]["nameRange"],
        response["declaration"]["nameRange"]
    );
    assert!(result["content"].is_null());
    for (pointer, value) in [
        ("/declaration/evidence", json!("TOKEN_GUESS")),
        ("/declaration/nameRange/end/character", json!(31)),
        ("/declaration/nameRange/end/character", json!(45)),
        ("/declaration/declarationRange/end/line", json!(-1)),
        ("/declaration/bindingKey", json!("")),
    ] {
        let mut changed = response.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            normalize(
                changed,
                &request,
                "declaration",
                &context,
                &json!("0.7.0"),
                Path::new("/project")
            )
            .is_err(),
            "{pointer}"
        );
    }
}

#[test]
fn ambiguous_declarations_are_not_promoted_to_a_range_or_guessed_candidate() {
    let (request, context, _) = fixture();
    let response = json!({"schemaVersion":"java-dependency-source-declaration-v1","status":"ambiguous","reason":{"code":"java.sources.declarationAmbiguous","message":"Multiple source declarations."}});
    let result = normalize(
        response,
        &request,
        "declaration",
        &context,
        &json!("0.7.0"),
        Path::new("/project"),
    )
    .unwrap();
    assert_eq!(result["status"], "ambiguous");
    assert!(result["declaration"].is_null());
    assert!(result["association"].is_null());
}

fn fixture() -> (Request, Value, Value) {
    let request = serde_json::from_value(json!({"workspaceId":"one","generation":1,"requestId":"source","document":{"path":"Main.java","text":"class Main {}","version":1},
        "position":{"line":0,"character":0},"projectContext":{"projectPath":"","sdkHome":"/jdk","mavenRepository":"/repository","activeMavenProfiles":[],"inactiveMavenProfiles":[],
            "snapshotHash":"a".repeat(64),"contextHash":"b".repeat(64),"platformIdentities":["c".repeat(64)]},"expectedAssociationHash":"d".repeat(64)})).unwrap();
    let context = json!({"sdk":[{"home":"/jdk","sourceRelease":17,"identitySha256":"c".repeat(64)}],"modules":[{"id":"app","sourceSets":[{"id":"main","compileClasspath":[
        {"path":"/repository/library.jar","providerId":"maven-effective-v1","fingerprint":"e".repeat(64)}]}]}]});
    let content = "package external; public class Library {}";
    let response = json!({"schemaVersion":"java-dependency-source-v1","status":"available","snapshotHash":"a".repeat(64),"contextHash":"b".repeat(64),
        "sdkIdentities":[{"sdkHome":"/jdk","release":17,"identitySha256":"c".repeat(64)}],"content":content,
        "association":{"associationHash":"d".repeat(64),"resourceUri":format!("refactorkit-java-source://{}/external%2FLibrary.java","d".repeat(64)),"readOnly":true,"providerId":"maven-effective-v1",
            "moduleId":"app","sourceSetId":"main","binaryPath":"/repository/library.jar","binarySha256":"e".repeat(64),"sourceArchivePath":"/repository/library-sources.jar","sourceArchiveSha256":"f".repeat(64),
            "sourceEntry":"external/Library.java","sourceSha256":format!("{:x}",Sha256::digest(content.as_bytes())),
            "jvmIdentity":{"kind":"TYPE","ownerBinaryName":"external.Library","memberName":"","descriptor":"Lexternal/Library;"},
            "provenance":{"kind":"MAVEN_SELECTED_COORDINATE_AND_CLASSFILE_SOURCE_FILE","componentId":"external:library:1","sourceFile":"Library.java"}}});
    (request, context, response)
}

#[test]
fn guarded_read_accepts_owning_source_bytes_and_does_not_make_an_editable_file() {
    let (request, context, response) = fixture();
    let result = normalize(
        response.clone(),
        &request,
        "read",
        &context,
        &json!("0.7.0"),
        Path::new("/project"),
    )
    .unwrap();
    assert_eq!(result["association"]["readOnly"], true);
    assert_eq!(result["content"], response["content"]);
    assert_eq!(result["documentPath"], "Main.java");
    assert!(result["association"]["range"].is_null());
}

#[test]
fn rejects_changed_sdk_context_binary_ownership_and_source_bytes() {
    let (request, context, response) = fixture();
    for pointer in [
        "/snapshotHash",
        "/contextHash",
        "/sdkIdentities/0/identitySha256",
        "/sdkIdentities/0/sdkHome",
        "/association/moduleId",
        "/association/sourceSetId",
        "/association/providerId",
        "/association/binaryPath",
        "/association/sourceSha256",
        "/association/associationHash",
        "/content",
    ] {
        let mut changed = response.clone();
        *changed.pointer_mut(pointer).unwrap() = json!("1".repeat(64));
        assert!(
            normalize(
                changed,
                &request,
                "read",
                &context,
                &json!("0.7.0"),
                Path::new("/project")
            )
            .is_err(),
            "{pointer}"
        );
    }
}

#[test]
fn refuses_writable_uri_escaping_archive_entry_and_excessive_utf8_content() {
    let (request, context, response) = fixture();
    for (pointer, value) in [
        ("/association/readOnly", json!(false)),
        (
            "/association/resourceUri",
            json!("file:///tmp/Library.java"),
        ),
        ("/association/sourceEntry", json!("../Library.java")),
        ("/association/sourceEntry", json!("/external/Library.java")),
        ("/content", json!("😀".repeat(32769))),
    ] {
        let mut changed = response.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            normalize(
                changed,
                &request,
                "read",
                &context,
                &json!("0.7.0"),
                Path::new("/project")
            )
            .is_err(),
            "{pointer}"
        );
    }
}

#[test]
fn ambiguity_preserves_candidates_and_never_selects_a_binary() {
    let (request, context, _) = fixture();
    let response = json!({"schemaVersion":"java-dependency-source-v1","status":"ambiguous","reason":{"code":"java.sources.ambiguousBinary","message":"Multiple dependency owners."},
        "candidates":[{"binaryPath":"/one/library.jar"},{"binaryPath":"/two/library.jar"}]});
    let result = normalize(
        response,
        &request,
        "lookup",
        &context,
        &json!("0.7.0"),
        Path::new("/project"),
    )
    .unwrap();
    assert_eq!(result["status"], "ambiguous");
    assert_eq!(result["candidates"].as_array().unwrap().len(), 2);
    assert!(result["association"].is_null());
    assert!(result["content"].is_null());
}

#[test]
fn source_lookup_requires_one_explicit_read_only_capability() {
    let caps = json!({"name":"RefactorKit","apiVersion":"0.2","protocol":"json-rpc-2.0","transport":"stdio","methods":[
        {"name":"java.dependencySource.lookup","requiresProject":true,"writesWorkspace":false}]});
    assert!(available_method(&caps, "java.dependencySource.lookup"));
    for pointer in ["/methods/0/writesWorkspace", "/methods/0/requiresProject"] {
        let mut changed = caps.clone();
        *changed.pointer_mut(pointer).unwrap() = json!(pointer.ends_with("writesWorkspace"));
        assert!(!available_method(&changed, "java.dependencySource.lookup"));
    }
    let mut duplicate = caps.clone();
    duplicate["methods"]
        .as_array_mut()
        .unwrap()
        .push(caps["methods"][0].clone());
    assert!(!available_method(
        &duplicate,
        "java.dependencySource.lookup"
    ));
}

#[test]
fn caller_cannot_inject_a_source_archive_or_workspace_write_path() {
    let (request, _, _) = fixture();
    let mut wire = json!({"workspaceId":request.workspace_id,"generation":1,"requestId":"source", "projectContext":request.project_context,
        "document":{"path":"Main.java","text":"class Main {}","version":1},"position":{"line":0,"character":0},"sourceArchivePath":"/unowned.jar"});
    assert!(serde_json::from_value::<Request>(wire.clone()).is_err());
    wire.as_object_mut().unwrap().remove("sourceArchivePath");
    wire["targetPath"] = json!("Main.java");
    assert!(serde_json::from_value::<Request>(wire).is_err());
}
