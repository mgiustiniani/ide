//! Closed Java 25 response validation; semantic selection stays in RefactorKit.
use super::{relative, source, text, valid_position, Position, Request};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::Path};

const INVALID: &str = "Invalid or uncorrelated Java 25 entry-point discovery.";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Wire {
    schema_version: String,
    request_id: String,
    kind: String,
    status: String,
    snapshot_hash: String,
    index_generation: u64,
    context_hash: String,
    context_schema_version: String,
    provider_id: String,
    backend: String,
    evidence: String,
    provenance_hash: String,
    scope: super::Scope,
    platform_identities: Vec<String>,
    launcher_release: u64,
    launch_profile: String,
    scope_analysis_complete: bool,
    complete: bool,
    coverage: Coverage,
    returned_count: usize,
    total_eligible_count: usize,
    observed_eligible_lower_bound: usize,
    truncated: bool,
    candidates: Vec<Candidate>,
    launcher: Launcher,
    analysis: Analysis,
    ineligible_count: usize,
    ineligible_types_truncated: bool,
    ineligible_types: Vec<Ineligible>,
    selection: Option<Selection>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Coverage {
    qualified_profiles: Vec<String>,
    unqualified_profiles: Vec<String>,
    qualified_cell: Cell,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cell {
    source_level: u64,
    target_level: u64,
    platform_release: u64,
    launcher_release: u64,
    preview: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Launcher {
    sdk_home: String,
    executable: String,
    executable_sha256: String,
    compiler_sha256: String,
    platform_identity: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Analysis {
    snapshot_hash: String,
    worker_sha256: String,
    source_level: u64,
    target_level: u64,
    analyzed_source_count: usize,
    classpath_inputs: Vec<Input>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    path: String,
    sha256: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Candidate {
    entry_point_id: String,
    binary_name: String,
    declaring_binary_name: String,
    descriptor: String,
    invocation: String,
    inherited: bool,
    generated: bool,
    source_level: u64,
    target_level: u64,
    source: LaunchSource,
    declaration: Declaration,
    construction: Option<Construction>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Range {
    start: Position,
    end: Position,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Location {
    path: String,
    range: Range,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LaunchSource {
    path: String,
    range: Range,
    form: String,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum Declaration {
    Source {
        path: String,
        range: Range,
    },
    Binary {
        #[serde(rename = "originKind")]
        origin_kind: String,
        uri: String,
        #[serde(rename = "inputPath")]
        input_path: String,
        #[serde(rename = "inputSha256")]
        input_sha256: String,
        #[serde(rename = "moduleName")]
        module_name: Option<String>,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Construction {
    binary_name: String,
    descriptor: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ineligible {
    binary_name: String,
    reason: String,
    source: Location,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    mode: String,
    path: String,
    position: Position,
    binary_name: String,
    range: Range,
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn binary(value: &str) -> bool {
    text(value, 1024)
        && !value
            .chars()
            .any(|c| c.is_whitespace() || "/;[\\".contains(c))
}
fn absolute(value: &str) -> bool {
    text(value, 8192) && !value.contains(['\r', '\n']) && Path::new(value).is_absolute()
}
fn location(root: &Path, path: &str, range: &Range) -> Result<(), String> {
    if !relative(path) || !path.ends_with(".java") {
        return Err(INVALID.into());
    }
    let saved = source(root, path)?;
    if !valid_position(&saved, &range.start)
        || !valid_position(&saved, &range.end)
        || (range.start.line, range.start.character) >= (range.end.line, range.end.character)
    {
        return Err(INVALID.into());
    }
    Ok(())
}
fn executable_hash(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| INVALID)?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Err(INVALID.into());
    }
    let bytes = fs::read(path).map_err(|_| INVALID)?;
    if bytes.len() as u64 != metadata.len() {
        return Err(INVALID.into());
    }
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn remap(path: &str, request: &Request) -> String {
    if request.project_context.project_path.is_empty() {
        path.into()
    } else {
        format!("{}/{path}", request.project_context.project_path)
    }
}

pub(super) fn validate_and_remap(
    raw: &mut Value,
    request: &Request,
    root: &Path,
    sdk: &Path,
) -> Result<(), String> {
    if !request.modern() || !request.valid_profile() || !(1..=200).contains(&request.limit) {
        return Err(INVALID.into());
    }
    let executable = |name: &str| {
        sdk.join("bin").join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_owned()
        })
    };
    let wire: Wire = serde_json::from_value(raw.clone()).map_err(|_| INVALID)?;
    let context = &request.project_context;
    let cell = &wire.coverage.qualified_cell;
    let launcher = &wire.launcher;
    if wire.schema_version != "java-entry-points-v2"
        || wire.request_id != request.request_id
        || wire.kind != "entryPoints"
        || wire.status != "ready"
        || wire.snapshot_hash != context.snapshot_hash
        || wire.context_hash != context.context_hash
        || wire.context_schema_version != context.context_schema_version
        || !matches!(
            wire.context_schema_version.as_str(),
            "java-project-context-v2"
                | "java-project-context-v3"
                | "java-project-context-v4"
                | "java-project-context-v5"
                | "java-project-context-v6"
                | "java-project-context-v7"
        )
        || !hash(&wire.snapshot_hash)
        || !hash(&wire.context_hash)
        || wire.index_generation == 0
        || wire.provider_id != "java-sdk-launcher-v2"
        || wire.backend != "jdk25-javac"
        || wire.evidence != "compiler"
        || !hash(&wire.provenance_hash)
        || wire.scope.provider_id != request.scope.provider_id
        || wire.scope.module_id != request.scope.module_id
        || wire.scope.source_set_id != request.scope.source_set_id
        || wire.platform_identities != context.platform_identities
        || wire.platform_identities.is_empty()
        || wire.platform_identities.len() > 256
        || wire.platform_identities.iter().any(|id| !hash(id))
        || wire.launcher_release != 25
        || wire.launch_profile != request.profile()
        || !wire.scope_analysis_complete
        || wire.coverage.qualified_profiles != [request.profile()]
        || wire.coverage.unqualified_profiles != ["compact-preview-v1"]
        || [
            cell.source_level,
            cell.target_level,
            cell.platform_release,
            cell.launcher_release,
        ] != [25; 4]
        || cell.preview
        || !absolute(&launcher.sdk_home)
        || Path::new(&launcher.sdk_home)
            .canonicalize()
            .map_err(|_| INVALID)?
            != sdk
        || !absolute(&launcher.executable)
        || Path::new(&launcher.executable)
            .canonicalize()
            .map_err(|_| INVALID)?
            != executable("java").canonicalize().map_err(|_| INVALID)?
        || !wire
            .platform_identities
            .contains(&launcher.platform_identity)
        || launcher.executable_sha256 != executable_hash(&executable("java"))?
        || launcher.compiler_sha256 != executable_hash(&executable("javac"))?
    {
        return Err(INVALID.into());
    }
    let analysis = &wire.analysis;
    if !hash(&analysis.snapshot_hash)
        || !hash(&analysis.worker_sha256)
        || analysis.source_level != 25
        || analysis.target_level != 25
        || !(1..=10000).contains(&analysis.analyzed_source_count)
        || analysis.classpath_inputs.len() > 1024
    {
        return Err(INVALID.into());
    }
    let mut input_paths = HashSet::new();
    for input in &analysis.classpath_inputs {
        if !absolute(&input.path) || !hash(&input.sha256) || !input_paths.insert(&input.path) {
            return Err(INVALID.into());
        }
    }
    if wire.candidates.len() > request.limit as usize
        || wire.candidates.len() > 200
        || wire.ineligible_types.len() > 200
        || wire.ineligible_count > 16384
        || wire.returned_count != wire.candidates.len()
        || wire.total_eligible_count < wire.returned_count
        || wire.observed_eligible_lower_bound != wire.total_eligible_count
        || wire.truncated != (wire.total_eligible_count > wire.returned_count)
        || wire.ineligible_count < wire.ineligible_types.len()
        || wire.ineligible_types_truncated != (wire.ineligible_count > wire.ineligible_types.len())
        || wire.complete != (!wire.truncated && !wire.ineligible_types_truncated)
    {
        return Err(INVALID.into());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for (index, candidate) in wire.candidates.iter().enumerate() {
        if !candidate
            .entry_point_id
            .strip_prefix("java-entry:")
            .is_some_and(hash)
            || !ids.insert(&candidate.entry_point_id)
            || !binary(&candidate.binary_name)
            || !binary(&candidate.declaring_binary_name)
            || !names.insert(&candidate.binary_name)
            || !["()V", "([Ljava/lang/String;)V"].contains(&candidate.descriptor.as_str())
            || !["static", "instance"].contains(&candidate.invocation.as_str())
            || candidate.source_level != 25
            || candidate.target_level != 25
            || candidate.inherited != (candidate.binary_name != candidate.declaring_binary_name)
            || !["declared", "compact"].contains(&candidate.source.form.as_str())
            || (request.profile() == "inherited-v1"
                && (candidate.invocation != "static"
                    || candidate.descriptor != "([Ljava/lang/String;)V"))
        {
            return Err(INVALID.into());
        }
        let _ = candidate.generated;
        location(root, &candidate.source.path, &candidate.source.range)?;
        match (&candidate.construction, candidate.invocation.as_str()) {
            (Some(construction), "instance")
                if construction.binary_name == candidate.binary_name
                    && construction.descriptor == "()V" => {}
            (None, "static") if raw["candidates"][index].get("construction").is_none() => {}
            _ => return Err(INVALID.into()),
        }
        match &candidate.declaration {
            Declaration::Source { path, range } => {
                location(root, path, range)?;
                raw["candidates"][index]["declaration"]["path"] =
                    Value::String(remap(path, request));
            }
            Declaration::Binary {
                origin_kind,
                uri,
                input_path,
                input_sha256,
                module_name,
            } => {
                if origin_kind == "platform" {
                    let input = Path::new(input_path).canonicalize().map_err(|_| INVALID)?;
                    if !input.starts_with(sdk) || executable_hash(&input)? != *input_sha256 {
                        return Err(INVALID.into());
                    }
                }
                if module_name.is_none()
                    && raw["candidates"][index]["declaration"]
                        .get("moduleName")
                        .is_some()
                {
                    return Err(INVALID.into());
                }
                if !["classpath", "platform"].contains(&origin_kind.as_str())
                    || !text(uri, 8192)
                    || !["file:", "jar:file:", "jrt:"]
                        .iter()
                        .any(|prefix| uri.starts_with(prefix))
                    || !absolute(input_path)
                    || !hash(input_sha256)
                    || module_name.as_ref().is_some_and(|name| !text(name, 256))
                    || (origin_kind == "classpath"
                        && !analysis.classpath_inputs.iter().any(|input| {
                            input.path == *input_path && input.sha256 == *input_sha256
                        }))
                {
                    return Err(INVALID.into());
                }
            }
        }
    }
    let mut excluded = HashSet::new();
    for (index, entry) in wire.ineligible_types.iter().enumerate() {
        if !binary(&entry.binary_name)
            || names.contains(&entry.binary_name)
            || !excluded.insert(&entry.binary_name)
            || entry.reason != "java.entryPoints.instanceCreationIneligible"
        {
            return Err(INVALID.into());
        }
        location(root, &entry.source.path, &entry.source.range)?;
        raw["ineligibleTypes"][index]["source"]["path"] =
            Value::String(remap(&entry.source.path, request));
    }
    if let Some(selection) = &wire.selection {
        if selection.mode != "enclosing-type"
            || !binary(&selection.binary_name)
            || request.position.as_ref().is_none_or(|p| {
                p.line != selection.position.line || p.character != selection.position.character
            })
        {
            return Err(INVALID.into());
        }
        location(root, &selection.path, &selection.range)?;
    } else if raw.get("selection").is_some() {
        return Err(INVALID.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
        project: PathBuf,
        sdk: PathBuf,
        request: Request,
        raw: Value,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "ide-entry-v2-wire-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            let project = root.join("project");
            let sdk = root.join("sdk");
            fs::create_dir_all(&project).unwrap();
            fs::create_dir_all(sdk.join("bin")).unwrap();
            // These are integrity-boundary fixtures, never executable JDK substitutes.
            let suffix = if cfg!(windows) { ".exe" } else { "" };
            let java = sdk.join("bin").join(format!("java{suffix}"));
            let javac = sdk.join("bin").join(format!("javac{suffix}"));
            fs::write(&java, b"recorded runtime bytes").unwrap();
            fs::write(&javac, b"recorded compiler bytes").unwrap();
            let code = "// 😀\nclass Main { void main() {} }\n";
            fs::write(project.join("Main.java"), code).unwrap();
            let request: Request = serde_json::from_value(json!({"workspaceId":"workspace","generation":1,"requestId":"modern",
                "projectContext":{"projectPath":"project","sdkHome":sdk,"mavenRepository":"","activeMavenProfiles":[],"inactiveMavenProfiles":[],
                    "snapshotHash":"0".repeat(64),"contextHash":"1".repeat(64),"contextSchemaVersion":"java-project-context-v7","platformIdentities":["2".repeat(64)]},
                "scope":{"providerId":"maven-effective-v1","moduleId":"app","sourceSetId":"main"},"limit":100,
                "entryPointSchemaVersion":"java-entry-points-v2","launchProfile":"java25-v1"})).unwrap();
            let range = json!({"start":{"line":0,"character":0},"end":{"line":1,"character":code.lines().nth(1).unwrap().encode_utf16().count()}});
            let candidate = json!({"entryPointId":format!("java-entry:{}","3".repeat(64)),"binaryName":"Main","declaringBinaryName":"Main",
                "descriptor":"()V","invocation":"instance","inherited":false,"generated":false,"sourceLevel":25,"targetLevel":25,
                "source":{"path":"Main.java","range":range,"form":"declared"},
                "declaration":{"kind":"source","path":"Main.java","range":range},"construction":{"binaryName":"Main","descriptor":"()V"}});
            let raw = json!({"schemaVersion":"java-entry-points-v2","requestId":"modern","kind":"entryPoints","status":"ready",
                "snapshotHash":"0".repeat(64),"indexGeneration":1,"contextHash":"1".repeat(64),"contextSchemaVersion":"java-project-context-v7",
                "providerId":"java-sdk-launcher-v2","backend":"jdk25-javac","evidence":"compiler","provenanceHash":"6".repeat(64),
                "scope":{"providerId":"maven-effective-v1","moduleId":"app","sourceSetId":"main"},"platformIdentities":["2".repeat(64)],
                "launcherRelease":25,"launchProfile":"java25-v1","scopeAnalysisComplete":true,"complete":true,
                "coverage":{"qualifiedProfiles":["java25-v1"],"unqualifiedProfiles":["compact-preview-v1"],
                    "qualifiedCell":{"sourceLevel":25,"targetLevel":25,"platformRelease":25,"launcherRelease":25,"preview":false}},
                "launcher":{"sdkHome":sdk,"executable":java,"executableSha256":executable_hash(&java).unwrap(),"compilerSha256":executable_hash(&javac).unwrap(),"platformIdentity":"2".repeat(64)},
                "analysis":{"snapshotHash":"4".repeat(64),"workerSha256":"5".repeat(64),"sourceLevel":25,"targetLevel":25,"analyzedSourceCount":1,"classpathInputs":[]},
                "returnedCount":1,"totalEligibleCount":1,"observedEligibleLowerBound":1,"truncated":false,
                "ineligibleCount":0,"ineligibleTypesTruncated":false,"ineligibleTypes":[],
                "candidates":[candidate]});
            Self {
                root,
                project,
                sdk,
                request,
                raw,
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn closed_wire_validates_recorded_sdk_bytes_and_remaps_declaration_without_running_code() {
        let mut fixture = Fixture::new();
        validate_and_remap(
            &mut fixture.raw,
            &fixture.request,
            &fixture.project,
            &fixture.sdk,
        )
        .unwrap();
        assert_eq!(
            fixture.raw["candidates"][0]["declaration"]["path"],
            "project/Main.java"
        );
        assert_eq!(fixture.raw["analysis"]["snapshotHash"], "4".repeat(64));
        assert_eq!(fixture.raw["snapshotHash"], "0".repeat(64));
    }
    #[test]
    fn malformed_frames_and_split_utf16_ranges_are_refused_before_projection() {
        let fixture = Fixture::new();
        for (pointer, value) in [
            ("/schemaVersion", json!("java-entry-points-v1")),
            ("/launcher/compilerSha256", json!("f".repeat(64))),
            ("/launcher/platformIdentity", json!("7".repeat(64))),
            ("/analysis/sourceLevel", json!(24)),
            ("/coverage/qualifiedCell/preview", json!(true)),
            ("/candidates/0/construction/binaryName", json!("Other")),
            ("/candidates/0/source/range/start/character", json!(4)),
            ("/ineligibleCount", json!(1)),
            ("/complete", json!(false)),
        ] {
            let mut raw = fixture.raw.clone();
            *raw.pointer_mut(pointer).unwrap() = value;
            assert!(
                validate_and_remap(&mut raw, &fixture.request, &fixture.project, &fixture.sdk)
                    .is_err(),
                "{pointer}"
            );
        }
        let mut extra = fixture.raw.clone();
        extra["candidates"][0]["source"]["guessed"] = json!(true);
        assert!(
            validate_and_remap(&mut extra, &fixture.request, &fixture.project, &fixture.sdk)
                .is_err()
        );
    }
    #[test]
    fn changed_sdk_tools_are_refused_with_the_original_attestation() {
        let fixture = Fixture::new();
        let name = if cfg!(windows) { "javac.exe" } else { "javac" };
        fs::write(
            fixture.sdk.join("bin").join(name),
            b"replaced compiler bytes",
        )
        .unwrap();
        assert!(validate_and_remap(
            &mut fixture.raw.clone(),
            &fixture.request,
            &fixture.project,
            &fixture.sdk
        )
        .is_err());
    }
}
