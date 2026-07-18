use std::collections::HashMap;

use git2::{ErrorCode, ObjectType, Oid, Repository, Tree};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{ExpectedRepositoryIdentity, FoundryOperationGrant};

const PACK_ID: &str = "ide.xcom2.empt-v1_4";
const SOURCE_POLICY: &str =
    "Committed Git objects only; working-tree modifications and untracked files are ignored";
const GENERATED_READ_ME: &str = "X2ModBuildCommon v1.2.1 successfully installed.\n\
Edit .scripts\\build.ps1 if you want to enable cooking or build against Highlander.\n\
\n\
Enjoy making your mod, and may the odds be ever in your favor.\n\
\n\
\n\
Created with Enhanced Mod Project Template v1.4\n\
\n\
Get news and updates here:\n\
https://github.com/Iridar/EnhancedModProjectTemplate\n";

const COPIED_SOURCES: &[(&str, OutputPath)] = &[
    (".gitignore", OutputPath::Literal(".gitignore")),
    (
        ".scripts/X2ModBuildCommon/CHANGELOG.md",
        OutputPath::Literal(".scripts/X2ModBuildCommon/CHANGELOG.md"),
    ),
    (
        ".scripts/X2ModBuildCommon/EmptyUMap",
        OutputPath::Literal(".scripts/X2ModBuildCommon/EmptyUMap"),
    ),
    (
        ".scripts/X2ModBuildCommon/InvokePowershellTask.cs",
        OutputPath::Literal(".scripts/X2ModBuildCommon/InvokePowershellTask.cs"),
    ),
    (
        ".scripts/X2ModBuildCommon/LICENSE",
        OutputPath::Literal(".scripts/X2ModBuildCommon/LICENSE"),
    ),
    (
        ".scripts/X2ModBuildCommon/README.md",
        OutputPath::Literal(".scripts/X2ModBuildCommon/README.md"),
    ),
    (
        ".scripts/X2ModBuildCommon/XCOM2.targets",
        OutputPath::Literal(".scripts/X2ModBuildCommon/XCOM2.targets"),
    ),
    (
        ".scripts/X2ModBuildCommon/build_common.ps1",
        OutputPath::Literal(".scripts/X2ModBuildCommon/build_common.ps1"),
    ),
    (
        ".scripts/X2ModBuildCommon/clean.ps1",
        OutputPath::Literal(".scripts/X2ModBuildCommon/clean.ps1"),
    ),
    (
        ".scripts/X2ModBuildCommon/clean_cooker_output.ps1",
        OutputPath::Literal(".scripts/X2ModBuildCommon/clean_cooker_output.ps1"),
    ),
    (
        "Config/XComTemplateCreator.ini",
        OutputPath::UnderMod("Config/XComTemplateCreator.ini"),
    ),
    (
        "Config/XComTemplateEditor.ini",
        OutputPath::UnderMod("Config/XComTemplateEditor.ini"),
    ),
    (
        "ContentOptions.json",
        OutputPath::UnderMod("ContentOptions.json"),
    ),
    (
        "Localization/XComGame.int",
        OutputPath::UnderMod("Localization/XComGame.int"),
    ),
    ("ModPreview.jpg", OutputPath::UnderMod("ModPreview.jpg")),
];

const TRANSFORMED_SOURCES: &[(&str, TransformedOutput)] = &[
    (".scripts/build.ps1", TransformedOutput::BuildScript),
    (
        "Config/Base/XComEditor.ini",
        TransformedOutput::UnderMod("Config/Base/XComEditor.ini"),
    ),
    (
        "Config/Base/XComEngine.ini",
        TransformedOutput::UnderMod("Config/Base/XComEngine.ini"),
    ),
    (
        "Config/Base/XComGame.ini",
        TransformedOutput::UnderMod("Config/Base/XComGame.ini"),
    ),
    ("Mod.int", TransformedOutput::Localization),
    (
        "ConfigEngine.uc",
        TransformedOutput::Class("ConfigEngine.uc"),
    ),
    ("Help.uc", TransformedOutput::Class("Help.uc")),
    ("X2DLCInfo_Mod.uc", TransformedOutput::DlcInfoClass),
    ("extra_globals.uci", TransformedOutput::ExtraGlobals),
];

const REQUIRED_PROJECT_SOURCE: &str = "ProjectTemplate.x2proj";

#[cfg(test)]
pub(super) fn required_source_paths() -> Vec<&'static str> {
    let mut paths = COPIED_SOURCES
        .iter()
        .map(|(path, _)| *path)
        .chain(TRANSFORMED_SOURCES.iter().map(|(path, _)| *path))
        .collect::<Vec<_>>();
    paths.push(REQUIRED_PROJECT_SOURCE);
    paths.sort_unstable();
    paths
}

#[derive(Clone, Copy)]
enum OutputPath {
    Literal(&'static str),
    UnderMod(&'static str),
}

impl OutputPath {
    fn render(self, mod_id: &str) -> String {
        match self {
            Self::Literal(path) => path.to_string(),
            Self::UnderMod(path) => format!("{mod_id}/{path}"),
        }
    }
}

#[derive(Clone, Copy)]
enum TransformedOutput {
    BuildScript,
    UnderMod(&'static str),
    Localization,
    Class(&'static str),
    DlcInfoClass,
    ExtraGlobals,
}

impl TransformedOutput {
    fn render(self, mod_id: &str) -> String {
        match self {
            Self::BuildScript => ".scripts/build.ps1".to_string(),
            Self::UnderMod(path) => format!("{mod_id}/{path}"),
            Self::Localization => format!("{mod_id}/Localization/{mod_id}.int"),
            Self::Class(name) => format!("{mod_id}/Src/{mod_id}/Classes/{name}"),
            Self::DlcInfoClass => {
                format!("{mod_id}/Src/{mod_id}/Classes/X2DLCInfo_{mod_id}.uc")
            }
            Self::ExtraGlobals => format!("{mod_id}/Src/extra_globals.uci"),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundryRenderedPlanBody {
    pub schema_version: u8,
    pub canonicalization: String,
    pub digest_algorithm: String,
    pub pack_id: String,
    pub platform: String,
    pub publication_status: String,
    pub source: FoundryRenderedSource,
    pub project: FoundryRenderedProjectIdentity,
    pub destination: FoundryRenderedDestination,
    pub symlinks: String,
    pub directories: Vec<FoundryRenderedDirectory>,
    pub files: Vec<FoundryRenderedFile>,
    pub generated_previews: Vec<FoundryGeneratedPreview>,
    pub absences: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundryRenderedSource {
    pub repository: String,
    pub grant_identity: String,
    pub commit: String,
    pub tree: String,
    pub fingerprint_result: String,
    pub policy: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundryRenderedProjectIdentity {
    pub mod_id: String,
    pub guid: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundryRenderedDestination {
    pub parent: String,
    pub parent_grant_identity: String,
    pub derived_absent_destination: String,
    pub operation_grant_identity: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FoundryRenderedDirectory {
    pub path: String,
    pub mode: String,
    pub state: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FoundryFileClassification {
    Copied,
    Transformed,
    Generated,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FoundryRenderedFile {
    pub path: String,
    pub classification: FoundryFileClassification,
    pub mode: String,
    pub bytes: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundryGeneratedPreview {
    pub path: String,
    pub encoding: String,
    pub byte_order_mark: String,
    pub line_endings: String,
    pub escaped_byte_preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FoundryRenderedOutputFile {
    pub path: String,
    pub classification: FoundryFileClassification,
    pub mode: u32,
    pub bytes: Vec<u8>,
}

/// One renderer-owned result. `output_files` is deliberately internal and is the future Apply
/// byte authority; the command serializes only `plan_body`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FoundryRenderedProject {
    pub plan_body: FoundryRenderedPlanBody,
    pub output_files: Vec<FoundryRenderedOutputFile>,
}

#[derive(Debug, Clone)]
pub(crate) struct FoundryPlanBinding<'a> {
    pub repository: &'a str,
    pub source_grant_identity: &'a str,
    pub parent: &'a str,
    pub parent_grant_identity: &'a str,
    pub derived_destination: &'a str,
    pub operation_grant: &'a FoundryOperationGrant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RenderFailure {
    CommitMissing,
    CommitUnreadable,
    CommitMismatched,
    CommitFingerprintInvalid,
    TreeMissing,
    TreeUnreadable,
    TreeMismatched,
    TreeFingerprintInvalid,
    BlobMissing,
    BlobUnreadable,
    BlobMismatched,
    BlobFingerprintInvalid,
    RenderedPlanInvalid,
}

/// Reads and renders every authoritative output byte from the pinned Git object database.
/// No working-tree path is opened and no output path is written.
pub(crate) fn render_from_git_objects(
    repository: &Repository,
    expected: &ExpectedRepositoryIdentity,
    mod_id: &str,
) -> Result<RenderedOutput, RenderFailure> {
    let tree = open_pinned_tree(repository, expected)?;
    let mut required = HashMap::new();
    for (path, _) in COPIED_SOURCES {
        required.insert(*path, read_required_blob(repository, &tree, path)?);
    }
    for (path, _) in TRANSFORMED_SOURCES {
        required.insert(*path, read_required_blob(repository, &tree, path)?);
    }
    required.insert(
        REQUIRED_PROJECT_SOURCE,
        read_required_blob(repository, &tree, REQUIRED_PROJECT_SOURCE)?,
    );

    let guid = derive_project_guid(mod_id);
    let mut files = Vec::with_capacity(27);
    for (source, output) in COPIED_SOURCES {
        files.push(FoundryRenderedOutputFile {
            path: output.render(mod_id),
            classification: FoundryFileClassification::Copied,
            mode: 0o644,
            bytes: required
                .get(source)
                .ok_or(RenderFailure::RenderedPlanInvalid)?
                .clone(),
        });
    }
    for (source, output) in TRANSFORMED_SOURCES {
        files.push(FoundryRenderedOutputFile {
            path: output.render(mod_id),
            classification: FoundryFileClassification::Transformed,
            mode: 0o644,
            bytes: replace_recognized_tokens(
                required
                    .get(source)
                    .ok_or(RenderFailure::RenderedPlanInvalid)?,
                mod_id,
                &guid,
            )?,
        });
    }
    files.push(FoundryRenderedOutputFile {
        path: format!("{mod_id}/{mod_id}.x2proj"),
        classification: FoundryFileClassification::Transformed,
        mode: 0o644,
        bytes: render_project_file(
            required
                .get(REQUIRED_PROJECT_SOURCE)
                .ok_or(RenderFailure::RenderedPlanInvalid)?,
            mod_id,
            &guid,
        )?,
    });
    files.push(FoundryRenderedOutputFile {
        path: format!("{mod_id}.XCOM_sln"),
        classification: FoundryFileClassification::Generated,
        mode: 0o644,
        bytes: render_solution(mod_id, &guid).into_bytes(),
    });
    files.push(FoundryRenderedOutputFile {
        path: format!("{mod_id}/ReadMe.txt"),
        classification: FoundryFileClassification::Generated,
        mode: 0o644,
        bytes: GENERATED_READ_ME.as_bytes().to_vec(),
    });
    files.sort_by(|left, right| left.path.cmp(&right.path));
    validate_internal_output(mod_id, &guid, &files)?;
    Ok(RenderedOutput { guid, files })
}

/// Completes the renderer result after native grant code has revalidated destination absence and
/// minted the replacement operation identity.
pub(crate) fn bind_rendered_plan(
    expected: &ExpectedRepositoryIdentity,
    mod_id: &str,
    output: RenderedOutput,
    binding: FoundryPlanBinding<'_>,
) -> Result<FoundryRenderedProject, RenderFailure> {
    let files = output
        .files
        .iter()
        .map(|file| FoundryRenderedFile {
            path: file.path.clone(),
            classification: file.classification,
            mode: "0644".to_string(),
            bytes: file.bytes.len(),
            sha256: sha256_hex(&file.bytes),
        })
        .collect::<Vec<_>>();
    let x2proj_path = format!("{mod_id}/{mod_id}.x2proj");
    let solution_path = format!("{mod_id}.XCOM_sln");
    let x2proj = output
        .files
        .iter()
        .find(|file| file.path == x2proj_path)
        .ok_or(RenderFailure::RenderedPlanInvalid)?;
    let solution = output
        .files
        .iter()
        .find(|file| file.path == solution_path)
        .ok_or(RenderFailure::RenderedPlanInvalid)?;
    let plan_body = FoundryRenderedPlanBody {
        schema_version: 1,
        canonicalization: "RFC 8785".to_string(),
        digest_algorithm: "SHA-256".to_string(),
        pack_id: PACK_ID.to_string(),
        platform: "Linux desktop only".to_string(),
        publication_status: "Non-publishable".to_string(),
        source: FoundryRenderedSource {
            repository: binding.repository.to_string(),
            grant_identity: binding.source_grant_identity.to_string(),
            commit: expected.commit.to_string(),
            tree: expected.tree.to_string(),
            fingerprint_result: "Verified".to_string(),
            policy: SOURCE_POLICY.to_string(),
        },
        project: FoundryRenderedProjectIdentity {
            mod_id: mod_id.to_string(),
            guid: output.guid,
        },
        destination: FoundryRenderedDestination {
            parent: binding.parent.to_string(),
            parent_grant_identity: binding.parent_grant_identity.to_string(),
            derived_absent_destination: binding.derived_destination.to_string(),
            operation_grant_identity: binding.operation_grant.identity.clone(),
        },
        symlinks: "none".to_string(),
        directories: rendered_directories(mod_id),
        files,
        generated_previews: vec![
            generated_preview(x2proj, true)?,
            generated_preview(solution, false)?,
        ],
        absences: rendered_absences(mod_id),
        warnings: rendered_warnings(),
    };
    Ok(FoundryRenderedProject {
        plan_body,
        output_files: output.files,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RenderedOutput {
    guid: String,
    files: Vec<FoundryRenderedOutputFile>,
}

fn open_pinned_tree<'repo>(
    repository: &'repo Repository,
    expected: &ExpectedRepositoryIdentity,
) -> Result<Tree<'repo>, RenderFailure> {
    let commit = repository.find_commit(expected.commit).map_err(|error| {
        if error.code() == ErrorCode::NotFound {
            RenderFailure::CommitMissing
        } else {
            RenderFailure::CommitUnreadable
        }
    })?;
    if commit.id() != expected.commit {
        return Err(RenderFailure::CommitMismatched);
    }
    if commit.tree_id() != expected.tree {
        return Err(RenderFailure::TreeMismatched);
    }
    read_exact_object(
        repository,
        expected.commit,
        ObjectType::Commit,
        RenderFailure::CommitMissing,
        RenderFailure::CommitUnreadable,
        RenderFailure::CommitMismatched,
        RenderFailure::CommitFingerprintInvalid,
    )?;
    read_exact_object(
        repository,
        expected.tree,
        ObjectType::Tree,
        RenderFailure::TreeMissing,
        RenderFailure::TreeUnreadable,
        RenderFailure::TreeMismatched,
        RenderFailure::TreeFingerprintInvalid,
    )?;
    repository.find_tree(expected.tree).map_err(|error| {
        if error.code() == ErrorCode::NotFound {
            RenderFailure::TreeMissing
        } else {
            RenderFailure::TreeUnreadable
        }
    })
}

#[allow(clippy::too_many_arguments)]
fn read_exact_object(
    repository: &Repository,
    oid: Oid,
    expected_kind: ObjectType,
    missing: RenderFailure,
    unreadable: RenderFailure,
    mismatched: RenderFailure,
    fingerprint_invalid: RenderFailure,
) -> Result<Vec<u8>, RenderFailure> {
    let odb = repository.odb().map_err(|_| unreadable.clone())?;
    let object = odb.read(oid).map_err(|error| {
        if error.code() == ErrorCode::NotFound {
            missing.clone()
        } else {
            unreadable.clone()
        }
    })?;
    if object.id() != oid {
        return Err(fingerprint_invalid);
    }
    if object.kind() != expected_kind {
        return Err(mismatched);
    }
    Ok(object.data().to_vec())
}

fn read_required_blob(
    repository: &Repository,
    tree: &Tree<'_>,
    path: &str,
) -> Result<Vec<u8>, RenderFailure> {
    let entry = tree.get_path(std::path::Path::new(path)).map_err(|error| {
        if error.code() == ErrorCode::NotFound {
            RenderFailure::BlobMissing
        } else {
            RenderFailure::BlobUnreadable
        }
    })?;
    if entry.kind() != Some(ObjectType::Blob) || entry.filemode() != 0o100644 {
        return Err(RenderFailure::BlobMismatched);
    }
    read_exact_object(
        repository,
        entry.id(),
        ObjectType::Blob,
        RenderFailure::BlobMissing,
        RenderFailure::BlobUnreadable,
        RenderFailure::BlobMismatched,
        RenderFailure::BlobFingerprintInvalid,
    )
}

fn derive_project_guid(mod_id: &str) -> String {
    let name = format!(
        "urn:ide:project-foundry:{PACK_ID}:{}:{mod_id}",
        super::EXPECTED_COMMIT
    );
    format!(
        "{{{}}}",
        Uuid::new_v5(&Uuid::NAMESPACE_URL, name.as_bytes())
            .to_string()
            .to_uppercase()
    )
}

fn replace_recognized_tokens(
    bytes: &[u8],
    mod_id: &str,
    guid: &str,
) -> Result<Vec<u8>, RenderFailure> {
    let text = std::str::from_utf8(bytes).map_err(|_| RenderFailure::RenderedPlanInvalid)?;
    let rendered = replace_tokens(text, mod_id, guid);
    if contains_recognized_token(&rendered) {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    Ok(rendered.into_bytes())
}

fn replace_tokens(text: &str, mod_id: &str, guid: &str) -> String {
    text.replace("$guid1$", guid)
        .replace("$Name$", mod_id)
        .replace("$ModSafeName$", mod_id)
        .replace("$Description$", "")
}

fn contains_recognized_token(text: &str) -> bool {
    ["$guid1$", "$Name$", "$ModSafeName$", "$Description$"]
        .iter()
        .any(|token| text.contains(token))
}

fn render_project_file(bytes: &[u8], mod_id: &str, guid: &str) -> Result<Vec<u8>, RenderFailure> {
    let without_bom = bytes
        .strip_prefix(&[0xef, 0xbb, 0xbf])
        .ok_or(RenderFailure::RenderedPlanInvalid)?;
    let text = std::str::from_utf8(without_bom).map_err(|_| RenderFailure::RenderedPlanInvalid)?;
    if text.contains('\r') || !text.ends_with('\n') {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    let filtered = text
        .split('\n')
        .filter(|line| {
            *line != "\t<Folder Include=\".scripts\\\" />"
                && *line != "\t<Folder Include=\".scripts\\X2ModBuildCommon\\\" />"
                && !line.starts_with("\t<Content Include=\".scripts\\")
                && !line.starts_with("\t<Content Include=\".gitignore")
                && !line.starts_with("\t<Content Include=\"replace_text.exe")
                && !line.starts_with("\t<Content Include=\"RUN_THIS.bat")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let old_solution_root = "<SolutionRoot>$(MSBuildProjectDirectory)\\</SolutionRoot>";
    if filtered.matches(old_solution_root).count() != 1 {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    let post_run = filtered.replace(
        old_solution_root,
        "<SolutionRoot>$(MSBuildProjectDirectory)\\..\\</SolutionRoot>",
    );
    let rendered = replace_tokens(&post_run, mod_id, guid);
    if contains_recognized_token(&rendered)
        || rendered.contains("<Folder Include=\".scripts\\")
        || rendered.contains("<Content Include=\".scripts\\")
        || rendered.contains("<Content Include=\".gitignore")
        || rendered.contains("<Content Include=\"RUN_THIS.bat")
        || rendered.contains("<Content Include=\"replace_text.exe")
    {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    let mut output = Vec::with_capacity(rendered.len() + 3);
    output.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    output.extend_from_slice(rendered.as_bytes());
    Ok(output)
}

fn render_solution(mod_id: &str, guid: &str) -> String {
    format!(
        "Microsoft Visual Studio Solution File, Format Version 12.00\n\
# Visual Studio 2013\n\
VisualStudioVersion = 12.0.21005.1\n\
MinimumVisualStudioVersion = 10.0.40219.1\n\
Project(\"{{9519DC3F-12CA-4742-AC8D-A664DE90DF21}}\") = \"{mod_id}\", \"{mod_id}\\{mod_id}.x2proj\", \"{guid}\"\n\
EndProject\n\
Global\n\
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution\n\
\t\tDebug|XCOM 2 = Debug|XCOM 2\n\
\t\tDefault|XCOM 2 = Default|XCOM 2\n\
\tEndGlobalSection\n\
\tGlobalSection(ProjectConfigurationPlatforms) = postSolution\n\
\t\t{guid}.Debug|XCOM 2.ActiveCfg = Debug|XCOM 2\n\
\t\t{guid}.Debug|XCOM 2.Build.0 = Debug|XCOM 2\n\
\t\t{guid}.Default|XCOM 2.ActiveCfg = Default|XCOM 2\n\
\t\t{guid}.Default|XCOM 2.Build.0 = Default|XCOM 2\n\
\tEndGlobalSection\n\
\tGlobalSection(SolutionProperties) = preSolution\n\
\t\tHideSolutionNode = FALSE\n\
\tEndGlobalSection\n\
EndGlobal\n"
    )
}

fn validate_internal_output(
    mod_id: &str,
    guid: &str,
    files: &[FoundryRenderedOutputFile],
) -> Result<(), RenderFailure> {
    if files.len() != 27 {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    let mut previous = None;
    for file in files {
        if file.mode != 0o644
            || file.path.is_empty()
            || file.path.starts_with('/')
            || file.path.contains("//")
            || file.path.split('/').any(|part| part == "." || part == "..")
            || previous.is_some_and(|path| path >= file.path.as_str())
        {
            return Err(RenderFailure::RenderedPlanInvalid);
        }
        previous = Some(file.path.as_str());
    }
    let x2proj = files
        .iter()
        .find(|file| file.path == format!("{mod_id}/{mod_id}.x2proj"))
        .ok_or(RenderFailure::RenderedPlanInvalid)?;
    let project_text = std::str::from_utf8(
        x2proj
            .bytes
            .strip_prefix(&[0xef, 0xbb, 0xbf])
            .ok_or(RenderFailure::RenderedPlanInvalid)?,
    )
    .map_err(|_| RenderFailure::RenderedPlanInvalid)?;
    let solution = files
        .iter()
        .find(|file| file.path == format!("{mod_id}.XCOM_sln"))
        .ok_or(RenderFailure::RenderedPlanInvalid)?;
    let solution_text =
        std::str::from_utf8(&solution.bytes).map_err(|_| RenderFailure::RenderedPlanInvalid)?;
    if !project_text.contains(&format!("<Guid>{guid}</Guid>"))
        || !project_text.contains(&format!("<Name>{mod_id}</Name>"))
        || !solution_text.contains(&format!(
            "= \"{mod_id}\", \"{mod_id}\\{mod_id}.x2proj\", \"{guid}\""
        ))
    {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    Ok(())
}

fn rendered_directories(mod_id: &str) -> Vec<FoundryRenderedDirectory> {
    [
        (".".to_string(), "contains entries"),
        (".scripts".to_string(), "contains entries"),
        (".scripts/X2ModBuildCommon".to_string(), "contains entries"),
        (mod_id.to_string(), "contains entries"),
        (format!("{mod_id}/Config"), "contains entries"),
        (format!("{mod_id}/Config/Base"), "contains entries"),
        (format!("{mod_id}/Content"), "empty"),
        (format!("{mod_id}/ContentForCook"), "empty"),
        (format!("{mod_id}/Localization"), "contains entries"),
        (format!("{mod_id}/Src"), "contains entries"),
        (format!("{mod_id}/Src/{mod_id}"), "contains entries"),
        (format!("{mod_id}/Src/{mod_id}/Classes"), "contains entries"),
    ]
    .into_iter()
    .map(|(path, state)| FoundryRenderedDirectory {
        path,
        mode: "0755".to_string(),
        state: state.to_string(),
    })
    .collect()
}

fn rendered_absences(mod_id: &str) -> Vec<String> {
    vec![
        format!("every .XComMod file, including {mod_id}/{mod_id}.XComMod"),
        format!("{mod_id}/.ide/xcom2.json"),
        "Git initialization and every .git path".to_string(),
        "every build profile".to_string(),
        format!("{mod_id}/RUN_THIS.bat"),
        format!("{mod_id}/replace_text.exe"),
        "template-root README.md".to_string(),
        "ProjectIcon.ico".to_string(),
        "EnhancedModProjectTemplate.vstemplate".to_string(),
        format!("{mod_id}/Src/.gitignore"),
    ]
}

fn rendered_warnings() -> Vec<String> {
    [
        "Project Foundry is Linux-only; Windows implementation, validation, support, and parity are postponed until the end of the project.",
        "This capability and its template-derived material are non-publishable; this preview grants no package, bundle, release, distribution, licensing, or module claim.",
        "No .XComMod, build profile, build, deployment, or cooking is provided.",
        "Project Foundry has no SDK or game authority and performs no SDK, game, package-collision, or compatibility validation.",
        "Copied PowerShell and C# files are inert output only; Project Foundry never executes them.",
        "Changed, unexpected, or unverified output is preserved rather than removed.",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn generated_preview(
    file: &FoundryRenderedOutputFile,
    has_bom: bool,
) -> Result<FoundryGeneratedPreview, RenderFailure> {
    let body = if has_bom {
        file.bytes
            .strip_prefix(&[0xef, 0xbb, 0xbf])
            .ok_or(RenderFailure::RenderedPlanInvalid)?
    } else {
        &file.bytes
    };
    let text = std::str::from_utf8(body).map_err(|_| RenderFailure::RenderedPlanInvalid)?;
    if text.contains('\r') || !text.ends_with('\n') {
        return Err(RenderFailure::RenderedPlanInvalid);
    }
    Ok(FoundryGeneratedPreview {
        path: file.path.clone(),
        encoding: "UTF-8".to_string(),
        byte_order_mark: if has_bom { "present" } else { "absent" }.to_string(),
        line_endings: "LF".to_string(),
        escaped_byte_preview: escape_preview(&text[..text.len() - 1]),
    })
}

fn escape_preview(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            let trailing_spaces = line.len() - line.trim_end_matches(' ').len();
            let visible = &line[..line.len() - trailing_spaces];
            let mut escaped = visible.replace('\t', "\\t");
            escaped.push_str(&"\\u0020".repeat(trailing_spaces));
            escaped
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        write!(&mut output, "{byte:02x}").expect("writing to a String cannot fail");
    }
    output
}
