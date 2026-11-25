//! Explicit Maven reactor verification before offline semantic synchronization.
use super::{
    execution_root, project_execution::append_maven_settings, selected_jdk, tool,
    workspace_wrapper, Invocation, Request,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Settings {
    maven_repository: String,
    active_maven_profiles: Vec<String>,
    inactive_maven_profiles: Vec<String>,
}

pub(super) fn plan(workspace: &Path, request: &Request) -> Result<Invocation, String> {
    let config = &request.configuration;
    let settings = request
        .maven_preparation
        .as_ref()
        .ok_or("Choose Maven settings in Java Project.")?;
    if config.build_tool != "maven" || config.jdk_home.is_empty() || !config.environment.is_empty()
    {
        return Err(
            "Maven verification requires the project JDK and Maven settings from Java Project."
                .into(),
        );
    }
    let repository = &settings.maven_repository;
    if !repository.is_empty()
        && (repository.len() > 4096
            || repository.contains(['\0', '\r', '\n'])
            || !Path::new(repository).is_absolute())
    {
        return Err("Choose an absolute local Maven repository path.".into());
    }
    let active = &settings.active_maven_profiles;
    let inactive = &settings.inactive_maven_profiles;
    if active.len() > 64
        || inactive.len() > 64
        || active
            .iter()
            .chain(inactive)
            .any(|profile| profile.len() > 256)
        || active.iter().any(|profile| inactive.contains(profile))
    {
        return Err("Choose valid, disjoint Maven profiles.".into());
    }
    let directory = execution_root(workspace, &config.project_path)?;
    if !directory.join("pom.xml").is_file() {
        return Err("Choose a Maven project directory with a pom.xml in Java Project.".into());
    }
    let executable = workspace_wrapper(&directory, workspace, "mvn")?
        .or_else(|| tool("mvn"))
        .ok_or("Maven is unavailable.")?;
    let mut arguments = vec!["-B".into(), "-Dstyle.color=never".into()];
    append_maven_settings(
        &mut arguments,
        &serde_json::to_value(settings).map_err(|_| "Invalid Maven settings.")?,
    )?;
    arguments.push("verify".into());
    Ok(Invocation {
        directory,
        executable,
        arguments,
        interactive: false,
        java_home: selected_jdk(&config.jdk_home)?,
        launch_file: None,
        discovery: None,
        coverage: None,
        auxiliary_files: Vec::new(),
        profile_path: None,
        test_report_path: None,
    })
}
