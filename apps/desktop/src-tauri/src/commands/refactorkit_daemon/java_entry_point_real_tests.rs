//! Isolated real-provider qualification of the IDE's production entry-point service.
use super::*;
use crate::commands::refactorkit_daemon::java_entry_points as discovery;

#[test]
#[ignore = "requires isolated v2 RefactorKit candidate and full selected JDK25"]
fn real_entry_point_v2_service_preserves_modern_owners_and_refuses_stale_sources() {
    let engine = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set isolated daemon");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("IDE_REFACTORKIT_DAEMON", value),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let fixture = Fixture::new();
    let materials = [
        ("pom.xml", "<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>modern</artifactId><version>1</version><properties><maven.compiler.release>25</maven.compiler.release></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin></plugins></build></project>"),
        ("src/main/java/demo/Child.java", "package demo; class Parent { public static void main(String[] args) { throw new AssertionError(); } } public class Child extends Parent { /* 😀 cursor */ static class NoMain {} }\n"),
        ("src/main/java/record.java", "void main() { throw new AssertionError(); }\n"),
        ("src/main/java/cla\u{200c}ss.java", "void main() { throw new AssertionError(); }\n"),
        ("src/main/java/demo/AbstractMain.java", "package demo; public abstract class AbstractMain { void main() {} }\n"),
        ("src/main/java/demo/NeedsArgument.java", "package demo; class NeedsArgument { NeedsArgument(int value) {} void main() {} }\n"),
        ("src/test/java/record.java", "void main() { throw new AssertionError(); }\n"),
    ];
    for (path, contents) in materials {
        let file = fixture.root.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, contents).unwrap();
    }
    let state = JavaProjectContextState::default();
    let mut settings = fixture.request();
    settings.sdk_home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Set JDK25");
    settings.maven_repository =
        std::env::var("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY").unwrap_or_default();
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let response = query_owned(
        fixture.binding.clone(),
        settings.clone(),
        state.0.clone(),
        ticket,
    )
    .unwrap();
    assert_eq!(response["status"], "available", "{response}");
    let context = &response["context"];
    let module = &context["modules"][0];
    let mut request = json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"requestId":"modern-entry-service",
        "projectContext":{"projectPath":"","sdkHome":settings.sdk_home,"mavenRepository":settings.maven_repository,
          "activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],
          "contextSchemaVersion":context["schemaVersion"],"platformIdentities":context["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()},
        "scope":{"providerId":module["providerId"],"moduleId":module["id"],"sourceSetId":"main"},"limit":100,
        "entryPointSchemaVersion":"java-entry-points-v2","launchProfile":"java25-v1"});
    let pending = discovery::JavaEntryPointState::default();
    let query = |value: &Value| {
        discovery::prepare_bound(
            serde_json::from_value(value.clone()).unwrap(),
            &state,
            &pending,
            fixture.binding.clone(),
        )
        .unwrap()()
    };
    let result = query(&request).unwrap();
    assert_eq!(result["status"], "ready", "{result}");
    let data = &result["discovery"];
    assert_eq!(data["schemaVersion"], "java-entry-points-v2");
    assert_eq!(data["complete"], true);
    assert_eq!(data["ineligibleCount"], 2);
    let candidates = data["candidates"].as_array().unwrap();
    for name in ["record", "cla\u{200c}ss", "demo.Child", "demo.Parent"] {
        assert!(
            candidates
                .iter()
                .any(|candidate| candidate["binaryName"] == name),
            "{data}"
        );
    }
    assert!(candidates
        .iter()
        .all(|candidate| candidate["source"]["path"]
            .as_str()
            .unwrap()
            .starts_with("src/main/java/")));
    for name in ["record", "cla\u{200c}ss"] {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate["binaryName"] == name)
            .unwrap();
        assert_eq!(candidate["invocation"], "instance");
        assert_eq!(candidate["descriptor"], "()V");
        assert_eq!(candidate["source"]["form"], "compact");
        assert_eq!(candidate["construction"]["binaryName"], name);
    }
    let cursor_source = materials[1].1;
    request["path"] = json!(materials[1].0);
    request["position"] = json!({"line":0,"character":cursor_source[..cursor_source.find("cursor").unwrap()].encode_utf16().count()});
    let selected = query(&request).unwrap();
    assert_eq!(selected["status"], "ready", "{selected}");
    assert_eq!(
        selected["discovery"]["candidates"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        selected["discovery"]["candidates"][0]["binaryName"],
        "demo.Child"
    );
    assert_eq!(
        selected["discovery"]["candidates"][0]["declaringBinaryName"],
        "demo.Parent"
    );
    request["position"]["character"] = json!(cursor_source
        [..cursor_source.find("NoMain").unwrap()]
        .encode_utf16()
        .count());
    let inner = query(&request).unwrap();
    assert_eq!(inner["status"], "ready", "{inner}");
    assert_eq!(
        inner["discovery"]["selection"]["binaryName"],
        "demo.Child$NoMain"
    );
    assert_eq!(inner["discovery"]["returnedCount"], 0);
    request.as_object_mut().unwrap().remove("position");
    request["path"] = json!(materials[5].0);
    assert_eq!(query(&request).unwrap()["status"], "refused");
    request.as_object_mut().unwrap().remove("path");
    request["launchProfile"] = json!("inherited-v1");
    let inherited = query(&request).unwrap();
    println!(
        "JAVA_ENTRY_POINTS_V2_PARTIAL_EVIDENCE={}",
        json!({"modern":result,"selected":selected,"inner":inner,"inherited":inherited})
    );
    for (path, contents) in materials {
        assert_eq!(
            fs::read_to_string(fixture.root.join(path)).unwrap(),
            contents
        );
    }
    request["launchProfile"] = json!("java25-v1");
    fs::write(fixture.root.join(materials[2].0), "void main() {}\n").unwrap();
    let stale = query(&request).unwrap();
    assert_eq!(stale["status"], "refused", "{stale}");
    assert!(stale["discovery"].is_null());
    println!(
        "JAVA_ENTRY_POINTS_V2_IDE_EVIDENCE={}",
        json!({"modern":result,"selected":selected,"inner":inner,"inherited":inherited,"stale":stale,"inputPreservation":true})
    );
    assert_eq!(inherited["status"], "ready", "{inherited}");
    assert!(inherited["discovery"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .all(|candidate| candidate["invocation"] == "static"
            && candidate["descriptor"] == "([Ljava/lang/String;)V"));
    assert!(inherited["discovery"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .any(|candidate| candidate["binaryName"] == "demo.Child"));
}

#[test]
#[ignore = "requires qualified isolated RefactorKit candidate and selected full JDK"]
fn real_entry_point_service_preserves_scope_sources_and_cancellation() {
    let engine = std::env::var_os("IDE_REAL_REFACTORKIT_DAEMON").expect("Set isolated daemon");
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(v) => std::env::set_var("IDE_REFACTORKIT_DAEMON", v),
                None => std::env::remove_var("IDE_REFACTORKIT_DAEMON"),
            }
        }
    }
    let _restore = Restore(std::env::var_os("IDE_REFACTORKIT_DAEMON"));
    std::env::set_var("IDE_REFACTORKIT_DAEMON", engine);
    let fixture = Fixture::new();
    let release = std::env::var("IDE_ENTRY_POINTS_RELEASE").unwrap_or_else(|_| "8".into());
    let release_number = release
        .parse::<u64>()
        .expect("Numeric fixture language level");
    let properties = if std::env::var_os("IDE_ENTRY_POINTS_SOURCE_TARGET").is_some() {
        format!("<maven.compiler.source>{release}</maven.compiler.source><maven.compiler.target>{release}</maven.compiler.target>")
    } else {
        format!("<maven.compiler.release>{release}</maven.compiler.release>")
    };
    let pom = "<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>entrypoints</artifactId><version>1</version><properties><maven.compiler.release>8</maven.compiler.release></properties><build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin></plugins></build></project>\n".replace("<maven.compiler.release>8</maven.compiler.release>", &properties);
    let modern_api = std::env::var_os("IDE_ENTRY_POINTS_MODERN_API").is_some();
    let runner = if modern_api {
        "package demo; public class Runner { /* 😀 */ public static void main(String[] args) { java.util.List<String> values = java.util.List.of(\"native SDK API\"); throw new AssertionError(values); } static class Dormant {} } class Secondary { public static void main(String[] args) { throw new AssertionError(); } }\n"
    } else {
        "package demo; public class Runner { /* 😀 */ public static void main(String[] args) { throw new AssertionError(); } static class Dormant {} } class Secondary { public static void main(String[] args) { throw new AssertionError(); } }\n"
    };
    let material=[
        ("pom.xml",pom.as_str()),
        ("src/main/java/demo/Runner.java",runner),
        ("src/main/java/demo/Container.java","package demo; public class Container { public static class Nested { public static void main(String... args) { throw new AssertionError(); } } }\n"),
        ("src/test/java/demo/Runner.java","package demo; public class Runner { public static void main(String[] args) { throw new AssertionError(); } }\n")];
    for (path, text) in material {
        let path = fixture.root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    let state = JavaProjectContextState::default();
    let mut settings = fixture.request();
    settings.sdk_home = std::env::var("IDE_JAVA_CONTEXT_TEST_JDK").expect("Set full JDK");
    settings.maven_repository =
        std::env::var("IDE_JAVA_CONTEXT_MAVEN_REPOSITORY").unwrap_or_default();
    let declared = std::env::var_os("IDE_ENTRY_POINTS_DECLARED").is_some();
    let declaration = if declared {
        fs::remove_file(fixture.root.join("pom.xml")).unwrap();
        fs::create_dir_all(fixture.root.join(".refactorkit")).unwrap();
        let value = json!({"schemaVersion":"java-declared-project-v1","sdkHome":settings.sdk_home,"modules":[{"id":"app","root":".","sourceSets":[
            {"id":"main","kind":"main","sourceRoots":["src/main/java"],"generatedSourceRoots":[],"outputDirectories":["target/classes"],"compileClasspath":[],"runtimeClasspath":["target/classes"],"release":release_number,"proc":"none"},
            {"id":"test","kind":"test","sourceRoots":["src/test/java"],"generatedSourceRoots":[],"outputDirectories":["target/test-classes"],"compileClasspath":[],"runtimeClasspath":["target/test-classes"],"release":release_number,"proc":"none"}
        ]}]});
        let bytes = serde_json::to_vec_pretty(&value).unwrap();
        fs::write(fixture.root.join(".refactorkit/java-project.json"), &bytes).unwrap();
        Some(bytes)
    } else {
        None
    };
    let ticket = state.0.revision.fetch_add(1, Ordering::SeqCst) + 1;
    let response = query_owned(
        fixture.binding.clone(),
        settings.clone(),
        state.0.clone(),
        ticket,
    )
    .unwrap();
    assert_eq!(response["status"], "available", "{response}");
    let context = &response["context"];
    let module = &context["modules"][0];
    if modern_api {
        assert!(!declared, "This matrix qualifies Maven compiler modes");
        let expected_api = std::env::var("IDE_ENTRY_POINTS_EXPECT_API_RELEASE")
            .expect("Set expected SDK API release")
            .parse::<u64>()
            .unwrap();
        let sdks = context["sdk"].as_array().unwrap();
        assert!(!sdks.is_empty());
        for sdk in sdks {
            assert_eq!(sdk["sourceRelease"], expected_api, "{context}");
        }
        for source_set in module["sourceSets"].as_array().unwrap() {
            assert_eq!(source_set["sourceLevel"], release_number);
            assert_eq!(
                source_set["release"],
                if std::env::var_os("IDE_ENTRY_POINTS_SOURCE_TARGET").is_some() {
                    Value::Null
                } else {
                    json!(release_number)
                }
            );
        }
    }
    if declared {
        assert_eq!(module["providerId"], "java-declared-v1");
        assert_eq!(module["root"], "");
    }
    let mut request = json!({"workspaceId":fixture.binding.workspace_id,"generation":1,"requestId":"entry-service","projectContext":{"projectPath":"","sdkHome":settings.sdk_home,"mavenRepository":settings.maven_repository,"activeMavenProfiles":[],"inactiveMavenProfiles":[],"snapshotHash":context["snapshotHash"],"contextHash":context["contextHash"],"contextSchemaVersion":context["schemaVersion"],"platformIdentities":context["sdk"].as_array().unwrap().iter().map(|s|s["identitySha256"].clone()).collect::<Vec<_>>()},"scope":{"providerId":module["providerId"],"moduleId":module["id"],"sourceSetId":"main"},"limit":100});
    let requests = discovery::JavaEntryPointState::default();
    if declared {
        use crate::commands::refactorkit_daemon::{
            JavaExecutionProjectContext, JavaExecutionProjectSelection,
        };
        let selection: JavaExecutionProjectSelection = serde_json::from_value(json!({
            "providerId":module["providerId"],"moduleId":module["id"],"sourceSetId":"main","context":request["projectContext"]
        })).unwrap();
        let service = JavaExecutionProjectContext::new(&state);
        let execution = service
            .resolve(&fixture.binding, 1, &selection, false, false)
            .unwrap();
        assert_eq!(execution.build_tool, "jdk");
        let compiler = execution.declared_jdk.unwrap();
        assert_eq!(compiler.release, release_number);
        assert_eq!(
            compiler.source_roots,
            vec![fixture.root.join("src/main/java")]
        );
        assert!(compiler.compile_classpath.is_empty());
        assert_eq!(compiler.output, fixture.root.join("target/classes"));
    }
    let query = |r: &Value| {
        discovery::prepare_bound(
            serde_json::from_value(r.clone()).unwrap(),
            &state,
            &requests,
            fixture.binding.clone(),
        )
        .unwrap()()
    };
    let result = query(&request).unwrap();
    if modern_api && std::env::var_os("IDE_ENTRY_POINTS_SOURCE_TARGET").is_none() {
        assert_eq!(result["status"], "refused", "{result}");
        assert!(result["discovery"].is_null());
        assert!(
            result["message"]
                .as_str()
                .unwrap()
                .contains("compiler errors"),
            "{result}"
        );
    } else if std::env::var_os("IDE_ENTRY_POINTS_EXPECT_UNAVAILABLE").is_some() {
        assert_eq!(result["status"], "unavailable", "{result}");
        assert!(result["discovery"].is_null());
    } else {
        assert_eq!(result["status"], "ready", "{result}");
        let result = &result["discovery"];
        assert_eq!(result["complete"], false);
        assert_eq!(result["scopeAnalysisComplete"], true);
        for candidate in result["candidates"].as_array().unwrap() {
            assert_eq!(candidate["sourceLevel"], release_number);
            assert_eq!(candidate["targetLevel"], release_number);
        }

        let names = result["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["binaryName"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec!["demo.Container$Nested", "demo.Runner", "demo.Secondary"]
        );
        if std::env::var_os("IDE_ENTRY_POINTS_CURSOR").is_some() {
            let select = |request: &mut Value, path: &str, marker: &str| {
                let text = material.iter().find(|(p, _)| *p == path).unwrap().1;
                let byte = text.find(marker).expect("Fixture cursor marker");
                request["path"] = json!(path);
                request["position"] =
                    json!({"line":0,"character":text[..byte].encode_utf16().count()});
            };
            select(
                &mut request,
                "src/main/java/demo/Runner.java",
                "throw new AssertionError",
            );
            let primary = query(&request).unwrap();
            if std::env::var_os("IDE_ENTRY_POINTS_EXPECT_CURSOR_UNAVAILABLE").is_some() {
                assert_eq!(primary["status"], "unavailable", "{primary}");
                assert!(primary["discovery"].is_null());
            } else {
                assert_eq!(primary["status"], "ready", "{primary}");
                assert_eq!(
                    primary["discovery"]["selection"]["binaryName"],
                    "demo.Runner"
                );
                assert_eq!(
                    primary["discovery"]["candidates"].as_array().unwrap().len(),
                    1
                );
                select(
                    &mut request,
                    "src/main/java/demo/Runner.java",
                    "class Secondary",
                );
                let secondary = query(&request).unwrap();
                assert_eq!(
                    secondary["discovery"]["selection"]["binaryName"],
                    "demo.Secondary"
                );
                assert_eq!(
                    secondary["discovery"]["candidates"][0]["binaryName"],
                    "demo.Secondary"
                );
                select(
                    &mut request,
                    "src/main/java/demo/Container.java",
                    "throw new AssertionError",
                );
                let nested = query(&request).unwrap();
                assert_eq!(
                    nested["discovery"]["selection"]["binaryName"],
                    "demo.Container$Nested"
                );
                select(
                    &mut request,
                    "src/main/java/demo/Runner.java",
                    "class Dormant",
                );
                let dormant = query(&request).unwrap();
                assert_eq!(dormant["status"], "ready");
                assert_eq!(
                    dormant["discovery"]["selection"]["binaryName"],
                    "demo.Runner$Dormant"
                );
                assert_eq!(dormant["discovery"]["candidates"], json!([]));
                assert_eq!(dormant["discovery"]["complete"], false);
                request["position"] = json!({"line":0,"character":0});
                assert_eq!(query(&request).unwrap()["status"], "refused");
                let text = material[1].1;
                let emoji = text.find('😀').unwrap();
                request["position"] =
                    json!({"line":0,"character":text[..emoji].encode_utf16().count()+1});
                assert_eq!(query(&request).unwrap()["status"], "refused");
                select(
                    &mut request,
                    "src/main/java/demo/Runner.java",
                    "throw new AssertionError",
                );
                request["scope"]["sourceSetId"] = json!("test");
                assert_eq!(query(&request).unwrap()["status"], "refused");
                request["scope"]["sourceSetId"] = json!("main");
            }
            request.as_object_mut().unwrap().remove("position");
            request.as_object_mut().unwrap().remove("path");
        }
        request["path"] = json!("src/main/java/demo/Runner.java");
        let filtered = query(&request).unwrap();
        assert_eq!(
            filtered["discovery"]["candidates"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        request.as_object_mut().unwrap().remove("path");
        request["scope"]["sourceSetId"] = json!("missing");
        let refused = query(&request).unwrap();
        assert_eq!(refused["status"], "refused", "{refused}");
        request["scope"]["sourceSetId"] = json!("main");
        let task = discovery::prepare_bound(
            serde_json::from_value(request.clone()).unwrap(),
            &state,
            &requests,
            fixture.binding.clone(),
        )
        .unwrap();
        discovery::cancel(
            &requests,
            fixture.binding.workspace_id.clone(),
            1,
            "entry-service".into(),
        )
        .unwrap();
        assert_eq!(task().unwrap()["status"], "cancelled");
        assert_eq!(
            query(&request).unwrap()["status"],
            "ready",
            "Cancelled registration must be released"
        );
        fs::write(
            fixture.root.join(material[1].0),
            format!("{}\n", material[1].1),
        )
        .unwrap();
        assert_eq!(query(&request).unwrap()["status"], "refused");
        fs::write(fixture.root.join(material[1].0), material[1].1).unwrap();
    }
    for (path, text) in material {
        if declared && path == "pom.xml" {
            continue;
        }
        assert_eq!(fs::read_to_string(fixture.root.join(path)).unwrap(), text);
    }
    if let Some(bytes) = declaration {
        assert_eq!(
            fs::read(fixture.root.join(".refactorkit/java-project.json")).unwrap(),
            bytes
        );
        assert!(!fixture.root.join("pom.xml").exists());
    }
    assert!(
        !fixture.root.join("target").exists(),
        "Discovery must not compile or run user code"
    );
    if let Some(output) = std::env::var_os("IDE_ENTRY_POINTS_EVIDENCE") {
        fs::write(&output, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        if declared || modern_api {
            let mut context_path = output;
            context_path.push(".context.json");
            fs::write(context_path, serde_json::to_vec_pretty(&response).unwrap()).unwrap();
        }
    }
    state.shutdown_all();
}
