//! JDWP socket attachment owns the helper process, never the external target JVM.
use super::{
    executable_name, selected_jdk, structured_debugger, Configuration, Invocation, LaunchFile,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub host: String,
    pub port: String,
}
impl Default for Target {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: "5005".into(),
        }
    }
}
pub(super) fn validate(target: &Target) -> Result<(), String> {
    if target.host.is_empty()
        || target.host.len() > 255
        || !target
            .host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_:[]".contains(&byte))
        || target.host == "*"
    {
        return Err(
            "Enter a JDWP host name or IP address without spaces, paths or a wildcard.".into(),
        );
    }
    if target.port.is_empty()
        || target.port.len() > 5
        || !target.port.bytes().all(|byte| byte.is_ascii_digit())
        || target
            .port
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .is_none()
    {
        return Err("Enter a decimal JDWP port from 1 to 65535.".into());
    }
    Ok(())
}
pub(super) fn invocation(root: &Path, config: &Configuration) -> Result<Invocation, String> {
    if config.debugger_mode != "jdi" {
        return Err("Attach requires Structured Java debugger (JDI).".into());
    }
    let target = config.debugger_attach.clone().unwrap_or_default();
    validate(&target)?;
    let home = selected_jdk(&config.jdk_home)?;
    if !structured_debugger::available(&home) {
        return Err("Attach requires a full JDK 17 or later with its JDI module and Unix process ownership.".into());
    }
    let bridge = LaunchFile::create("IdeJavaDebugger.java", structured_debugger::SOURCE)?;
    Ok(Invocation {
        directory: root.to_owned(),
        executable: home.join("bin").join(executable_name("java")),
        arguments: vec![
            "--add-modules=jdk.jdi".into(),
            bridge
                .path
                .to_str()
                .ok_or("JDI bridge path must be UTF-8.")?
                .into(),
            "--attach".into(),
            target.host,
            target.port,
        ],
        interactive: true,
        java_home: home,
        launch_file: None,
        discovery: None,
        coverage: None,
        auxiliary_files: vec![bridge],
        profile_path: None,
        test_report_path: None,
    })
}
