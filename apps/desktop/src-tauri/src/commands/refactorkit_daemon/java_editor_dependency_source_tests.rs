use super::*;
use std::process::Command;

#[test]
#[ignore = "requires frozen editor dependency-source daemon and full selected JDK; run with --test-threads=1"]
fn real_editor_dependency_sources_select_the_dirty_companion_binding_without_saving() {
    use super::super::super::java_dependency_source;
    use super::super::super::java_navigation;
    let daemon = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set frozen editor daemon");
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
    let fixture = Fixture::new();
    let repository = fixture.root.join("repository");
    let mut jars = vec![];
    let mut inputs = vec![];
    let compile = |arguments: &[&std::ffi::OsStr]| {
        let output = Command::new(sdk.join("bin/javac"))
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    for (artifact, class, value) in [
        ("first", "FirstApi", "first"),
        ("second", "SecondApi", "second"),
    ] {
        let root = repository.join(format!("external/{artifact}/1"));
        let sources = root.join("src/external");
        let classes = root.join("classes");
        fs::create_dir_all(&sources).unwrap();
        fs::create_dir_all(&classes).unwrap();
        let source = sources.join(format!("{class}.java"));
        fs::write(&source,format!("package external; public class {class} {{ public String call(int n) {{ return \"{value}\"; }} }}\n")).unwrap();
        compile(&[
            "--release".as_ref(),
            "17".as_ref(),
            "-d".as_ref(),
            classes.as_os_str(),
            source.as_os_str(),
        ]);
        for (suffix, directory) in [("", classes), ("-sources", root.join("src"))] {
            let jar = root.join(format!("{artifact}-1{suffix}.jar"));
            let result = Command::new(sdk.join("bin/jar"))
                .arg("cf")
                .arg(&jar)
                .arg("-C")
                .arg(directory)
                .arg(".")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            inputs.push((jar.clone(), fs::read(&jar).unwrap()));
            if suffix.is_empty() {
                jars.push(jar);
            }
        }
        let pom = root.join(format!("{artifact}-1.pom"));
        fs::write(&pom,format!("<project><modelVersion>4.0.0</modelVersion><groupId>external</groupId><artifactId>{artifact}</artifactId><version>1</version></project>")).unwrap();
        inputs.push((pom.clone(), fs::read(&pom).unwrap()));
    }
    let pom = fixture.root.join("pom.xml");
    fs::write(&pom,"<project><modelVersion>4.0.0</modelVersion><groupId>consumer</groupId><artifactId>app</artifactId><version>1</version><properties><maven.compiler.release>17</maven.compiler.release></properties><dependencies><dependency><groupId>external</groupId><artifactId>first</artifactId><version>1</version></dependency><dependency><groupId>external</groupId><artifactId>second</artifactId><version>1</version></dependency></dependencies></project>").unwrap();
    inputs.push((pom.clone(), fs::read(&pom).unwrap()));
    let main_path = "src/main/java/example/Main.java";
    let helper_path = "src/main/java/example/Helper.java";
    let main = "package example; public class Main { public String run() { return Helper.api().call(1); } }\n";
    let helper = "package example; class Helper { static external.FirstApi api() { return new external.FirstApi(); } }\n";
    let main_file = fixture.root.join(main_path);
    let helper_file = fixture.root.join(helper_path);
    fs::create_dir_all(main_file.parent().unwrap()).unwrap();
    fs::write(&main_file, main).unwrap();
    fs::write(&helper_file, helper).unwrap();
    inputs.push((main_file.clone(), main.as_bytes().to_vec()));
    inputs.push((helper_file.clone(), helper.as_bytes().to_vec()));
    let output = fixture.root.join("target/classes");
    fs::create_dir_all(&output).unwrap();
    let classpath = std::env::join_paths(&jars).unwrap();
    compile(&[
        "--release".as_ref(),
        "17".as_ref(),
        "-cp".as_ref(),
        &classpath,
        "-d".as_ref(),
        output.as_os_str(),
        main_file.as_os_str(),
        helper_file.as_os_str(),
    ]);
    let state = JavaProjectContextState::default();
    let mut context_request = fixture.request();
    context_request.sdk_home = sdk.to_string_lossy().into_owned();
    context_request.maven_repository = repository.to_string_lossy().into_owned();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let acquired = query_owned(
        fixture.binding.clone(),
        context_request.clone(),
        state.shared(),
        ticket,
    )
    .unwrap();
    assert_eq!(acquired["status"], "available", "{acquired}");
    let context = &acquired["context"];
    let project = json!({"projectPath":"","sdkHome":context_request.sdk_home,"mavenRepository":context_request.maven_repository,
        "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],
        "platformIdentities":context["sdk"].as_array().unwrap().iter().map(|sdk|sdk["identitySha256"].clone()).collect::<Vec<_>>()});
    let draft = format!("// editor draft\n{main}");
    let dirty_helper = helper.replace("FirstApi", "SecondApi");
    let documents = json!([{"path":main_path,"text":draft,"version":44},{"path":helper_path,"text":dirty_helper,"version":45}]);
    let cursor = json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"requestId":"editor-library",
        "projectContext":project,"document":{"path":main_path,"text":draft,"version":1},
        "position":{"line":1,"character":main.find("call(1)").unwrap()+1}});
    let nav_state = java_navigation::JavaNavigationState::new(&state);
    let select = |docs: Value| {
        let mut request = cursor.clone();
        request["kind"] = json!("definition");
        request["limit"] = json!(1);
        request["includeDeclaration"] = json!(true);
        request["editorOverlay"] = json!({"documents":docs});
        java_navigation::query_at(
            fixture.binding.clone(),
            serde_json::from_value(request).unwrap(),
            &nav_state,
        )
        .unwrap()
    };
    let selected = select(documents.clone());
    assert_eq!(selected["status"], "ready", "{selected}");
    assert_eq!(
        selected["locations"].as_array().unwrap().len(),
        0,
        "{selected}"
    );
    let mut request = cursor.clone();
    request["editorOverlay"] = json!({"expectedOverlayHash":selected["editorOverlay"]["overlayHash"],"documents":documents});
    let run = |wire: Value, operation| {
        java_dependency_source::query(
            fixture.binding.clone(),
            serde_json::from_value(wire).unwrap(),
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
    let declaration = run(request.clone(), "declaration");
    assert_eq!(declaration["status"], "available", "{declaration}");
    assert_eq!(
        declaration["association"]["jvmIdentity"]["ownerBinaryName"], "external.SecondApi",
        "{declaration}"
    );
    assert_eq!(
        declaration["association"]["binaryPath"],
        jars[1].to_string_lossy().as_ref()
    );
    assert_eq!(
        declaration["editorOverlay"]["documents"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    request["expectedAssociationHash"] = declaration["association"]["associationHash"].clone();
    let read = run(request.clone(), "read");
    assert_eq!(read["status"], "available", "{read}");
    assert!(read["content"].as_str().unwrap().contains("\"second\""));
    let mut missing = request.clone();
    missing["editorOverlay"]["documents"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert_eq!(
        run(missing, "read")["reason"]["code"],
        "java.overlay.hashStale"
    );
    let mut changed = request.clone();
    changed["editorOverlay"]["documents"][1]["text"] = json!(helper);
    assert_eq!(
        run(changed, "read")["reason"]["code"],
        "java.overlay.versionStale"
    );
    let mut next_documents = request["editorOverlay"]["documents"].clone();
    next_documents[1]["version"] = json!(46);
    let selected_next = select(next_documents.clone());
    assert_eq!(selected_next["status"], "ready", "{selected_next}");
    let mut old_association = request.clone();
    old_association["editorOverlay"] = json!({"expectedOverlayHash":selected_next["editorOverlay"]["overlayHash"],"documents":next_documents});
    assert_eq!(
        run(old_association, "read")["reason"]["code"],
        "java.sources.associationStale"
    );
    for (path, bytes) in inputs {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
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
    let wire = fixture.root.join("source-consumer-decoder.json");
    fs::write(
        &wire,
        serde_json::to_vec(&json!({"request":request,"declaration":declaration,"read":read}))
            .unwrap(),
    )
    .unwrap();
    let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let decoded = Command::new("node").current_dir(repository_root).args(["--import","tsx","--input-type=module","-e",
        "import fs from 'node:fs';import{normalizeJavaDependencySource,normalizeJavaDependencySourceDeclaration}from './packages/tauri-adapters/src/java-dependency-source-tauri.ts';const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for(const op of ['declaration','read']){const r=op==='declaration'?normalizeJavaDependencySourceDeclaration(x[op],x.request):normalizeJavaDependencySource(x[op],x.request,'read');if(r.status!=='available'||r.editorOverlay.documents.length!==2||r.association.jvmIdentity.ownerBinaryName!=='external.SecondApi')throw Error('Consumer rejected editor source');}console.log('PRODUCTION_EDITOR_SOURCE_DECODER_ACCEPTED');"
    ]).arg(&wire).output().unwrap();
    fs::remove_file(wire).unwrap();
    assert!(
        decoded.status.success(),
        "{}",
        String::from_utf8_lossy(&decoded.stderr)
    );
    assert!(String::from_utf8_lossy(&decoded.stdout)
        .contains("PRODUCTION_EDITOR_SOURCE_DECODER_ACCEPTED"));
    let mut active = state.0.active.lock().unwrap();
    reset(&mut active);
    assert!(active.is_none());
    eprintln!("EDITOR_DEPENDENCY_SOURCE_ACCEPTED SDK={} owningOutputs=compiled selectedBinary=second.jar dirtyCursor=preserved dirtyCompanion=preserved omittedDocument=refused sameVersionChangedText=refused versionOnlyOldAssociation=refused inputs=unchanged",sdk.display());
}
