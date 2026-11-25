use super::*;
use std::process::Command;

#[test]
#[ignore = "requires frozen SDK source daemon and real selected JDK; run with --test-threads=1"]
fn real_platform_sources_use_current_sdk_and_dirty_companion_without_saving() {
    use super::super::super::{java_dependency_source, java_navigation};
    let daemon =
        std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set the frozen SDK-source daemon");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            if let Some(value) = &self.0 {
                std::env::set_var("IDE_REFACTORKIT_DAEMON", value);
            } else {
                std::env::remove_var("IDE_REFACTORKIT_DAEMON");
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", daemon);
    let sdk =
        PathBuf::from(std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Set the selected JDK"))
            .canonicalize()
            .unwrap();
    let release = fs::read_to_string(sdk.join("release"))
        .unwrap()
        .lines()
        .find_map(|line| {
            line.strip_prefix("JAVA_VERSION=\"")
                .and_then(|v| v.split(['.', '\"', '-']).next())
                .and_then(|v| v.parse::<u32>().ok())
        })
        .unwrap();
    let f = Fixture::new();
    let main_path = "src/main/java/example/Main.java";
    let helper_path = "src/main/java/example/Helper.java";
    let source_target = std::env::var("IDE_PLATFORM_SOURCE_SOURCE_TARGET").ok();
    let main = if source_target.is_some() {
        "package example; public class Main { public String run() { java.util.List.of(\"selected SDK API\"); return Helper.api().toString(); } }\n"
    } else {
        "package example; public class Main { public String run() { return Helper.api().toString(); } }\n"
    };
    let helper="package example; class Helper { static java.lang.String api() { return new java.lang.String(); } }\n";
    fs::create_dir_all(f.root.join("src/main/java/example")).unwrap();
    fs::write(f.root.join(main_path), main).unwrap();
    fs::write(f.root.join(helper_path), helper).unwrap();
    let properties = if let Some(level) = &source_target {
        assert_eq!(level, "8", "The native API qualification uses syntax 8");
        format!("<maven.compiler.source>{level}</maven.compiler.source><maven.compiler.target>{level}</maven.compiler.target>")
    } else {
        format!("<maven.compiler.release>{release}</maven.compiler.release>")
    };
    let pom=format!("<project><modelVersion>4.0.0</modelVersion><groupId>consumer</groupId><artifactId>app</artifactId><version>1</version><properties>{properties}</properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>");
    fs::write(f.root.join("pom.xml"), &pom).unwrap();
    fs::create_dir_all(f.root.join("target/classes")).unwrap();
    let compiler_mode = if source_target.is_some() {
        vec!["-source".to_owned(), "8".to_owned(), "-target".to_owned(), "8".to_owned()]
    } else {
        vec!["--release".to_owned(), release.to_string()]
    };
    let compiled = Command::new(sdk.join("bin/javac"))
        .args(&compiler_mode)
        .arg("-d")
        .arg(f.root.join("target/classes"))
        .arg(f.root.join(main_path))
        .arg(f.root.join(helper_path))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let class = f.root.join("target/classes/example/Helper.class");
    let class_bytes = fs::read(&class).unwrap();
    let state = JavaProjectContextState::default();
    let mut context_request = f.request();
    context_request.sdk_home = sdk.to_string_lossy().into_owned();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let acquired = query_owned(
        f.binding.clone(),
        context_request.clone(),
        state.shared(),
        ticket,
    )
    .unwrap();
    assert_eq!(acquired["status"], "available", "{acquired}");
    let context = &acquired["context"];
    let identity = context["sdk"][0]["identitySha256"]
        .as_str()
        .unwrap()
        .to_owned();
    let project = json!({"projectPath":"","sdkHome":context_request.sdk_home,"mavenRepository":context_request.maven_repository,
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],"contextSchemaVersion":context["schemaVersion"],
        "platformIdentities":context["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()});
    let saved = json!({"workspaceId":f.binding.workspace_id,"generation":1,"requestId":"platform-saved","projectContext":project,
        "document":{"path":main_path,"text":main,"version":1},"position":{"line":0,"character":main.find("toString").unwrap()+1}});
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
    let run = |request: Value, operation| {
        java_dependency_source::query_source(
            f.binding.clone(),
            serde_json::from_value(request).unwrap(),
            operation,
            state.shared(),
            Some(identity.clone()),
        )
        .unwrap()
    };
    let lookup = run(saved.clone(), "lookup");
    if let Some(output) = std::env::var_os("IDE_PLATFORM_SOURCE_EVIDENCE") {
        let mut probe = output;
        probe.push(".probe.json");
        let refreshed = if lookup["status"] != "available" {
            let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
            Some(query_owned(f.binding.clone(), context_request.clone(), state.shared(), ticket).unwrap())
        } else { None };
        fs::write(probe, serde_json::to_vec_pretty(&json!({"schemaVersion":context["schemaVersion"],
            "snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],
            "afterLookup":refreshed.as_ref().map(|v| json!({"status":v["status"],
                "schemaVersion":v["context"]["schemaVersion"],"snapshotHash":v["context"]["snapshotHash"],
                "contextHash":v["context"]["contextHash"]})),
            "lookup":lookup,"sourceTarget":source_target,"sdkRelease":release})).unwrap()).unwrap();
    }
    let mut evidence = vec![];
    if !sdk.join("lib/src.zip").is_file() {
        assert_eq!(lookup["status"], "unavailable", "{lookup}");
        assert_eq!(
            lookup["reason"]["code"], "java.platformSources.sourceArchiveUnavailable",
            "{lookup}"
        );
        assert!(lookup["association"].is_null());
    } else {
        assert_eq!(lookup["status"], "available", "{lookup}");
        assert_eq!(
            lookup["association"]["jvmIdentity"]["ownerBinaryName"],
            "java.lang.String"
        );
        let declaration = run(saved.clone(), "declaration");
        assert_eq!(declaration["status"], "available", "{declaration}");
        let mut read_request = saved.clone();
        read_request["expectedAssociationHash"] = lookup["association"]["associationHash"].clone();
        let read = run(read_request.clone(), "read");
        assert_eq!(read["status"], "available", "{read}");
        assert!(
            read["content"].as_str().unwrap().len() > 131072,
            "The SDK source must exercise the separate budget"
        );
        evidence.push(json!({"request":saved,"result":lookup,"operation":"lookup"}));
        evidence.push(json!({"request":read_request,"result":read,"operation":"read"}));
        evidence.push(json!({"request":saved,"result":declaration,"operation":"declaration"}));
        let draft = format!("// draft\n{main}");
        let dirty_helper = helper.replace("java.lang.String", "java.lang.StringBuilder");
        let documents = json!([{"path":main_path,"text":draft,"version":44},{"path":helper_path,"text":dirty_helper,"version":45}]);
        let mut cursor = saved.clone();
        cursor["requestId"] = json!("platform-editor");
        cursor["document"]["text"] = json!(draft);
        cursor["position"]["line"] = json!(1);
        let mut nav = cursor.clone();
        nav["kind"] = json!("definition");
        nav["limit"] = json!(1);
        nav["includeDeclaration"] = json!(true);
        nav["editorOverlay"] = json!({"documents":documents});
        let nav_state = java_navigation::JavaNavigationState::new(&state);
        let selected = java_navigation::query_at(
            f.binding.clone(),
            serde_json::from_value(nav).unwrap(),
            &nav_state,
        )
        .unwrap();
        assert_eq!(selected["status"], "ready", "{selected}");
        cursor["editorOverlay"] = json!({"expectedOverlayHash":selected["editorOverlay"]["overlayHash"],"documents":documents});
        let declaration = run(cursor.clone(), "declaration");
        assert_eq!(declaration["status"], "available", "{declaration}");
        assert_eq!(
            declaration["association"]["jvmIdentity"]["ownerBinaryName"],
            "java.lang.StringBuilder"
        );
        let mut read_request = cursor.clone();
        read_request["expectedAssociationHash"] =
            declaration["association"]["associationHash"].clone();
        let read = run(read_request.clone(), "read");
        assert_eq!(read["status"], "available", "{read}");
        evidence.push(json!({"request":cursor,"result":declaration,"operation":"declaration"}));
        evidence.push(json!({"request":read_request,"result":read,"operation":"read"}));
        let mut missing = cursor.clone();
        missing["editorOverlay"]["documents"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert_eq!(run(missing, "declaration")["status"], "refused");
        let wire = f.root.join("platform-source-consumer.json");
        for item in &mut evidence {
            item["request"]["expectedPlatformIdentitySha256"] = json!(identity);
        }
        fs::write(&wire, serde_json::to_vec(&evidence).unwrap()).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap();
        let decoded=Command::new("node").current_dir(root).args(["--import","tsx","--input-type=module","-e",
            "import fs from 'node:fs';import{normalizeJavaPlatformSource}from './packages/tauri-adapters/src/java-platform-source-tauri.ts';for(const x of JSON.parse(fs.readFileSync(process.argv[1],'utf8'))){const r=normalizeJavaPlatformSource(x.result,x.request,x.operation);if(r.status!=='available'||!r.association.readOnly)throw Error('SDK consumer rejected provider');}console.log('PRODUCTION_PLATFORM_SOURCE_DECODER_ACCEPTED');"])
            .arg(&wire).output().unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        fs::remove_file(wire).unwrap();
    }
    assert_eq!(fs::read_to_string(f.root.join(main_path)).unwrap(), main);
    assert_eq!(
        fs::read_to_string(f.root.join(helper_path)).unwrap(),
        helper
    );
    assert_eq!(fs::read_to_string(f.root.join("pom.xml")).unwrap(), pom);
    assert_eq!(fs::read(class).unwrap(), class_bytes);
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
    if let Some(output) = std::env::var_os("IDE_PLATFORM_SOURCE_EVIDENCE") {
        fs::write(output, serde_json::to_vec_pretty(&json!({"sdkRelease":release,
            "sourceTarget":source_target,"sourceAvailable":sdk.join("lib/src.zip").is_file(),
            "operations":evidence,"inputsPreserved":true,"compiledOutputPreserved":true,
            "sessionPreserved":true})).unwrap()).unwrap();
    }
    reset(&mut state.0.active.lock().unwrap());
    eprintln!("PLATFORM_SOURCE_CONSUMER_ACCEPTED SDK={} release={release} sourceAvailable={} drafts=unchanged outputs=unchanged",sdk.display(),sdk.join("lib/src.zip").is_file());
}
