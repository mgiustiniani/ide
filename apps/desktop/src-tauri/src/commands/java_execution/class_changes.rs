//! Compare compiled files around an explicit build, without claiming loaded-byte provenance.
use super::{class_reload, structured_debugger, Job};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{atomic::Ordering, Arc};
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Changes {
    pub status: String,
    pub stop_id: Option<String>,
    pub classes: Vec<class_reload::ClassFile>,
    pub message: String,
}
impl Changes {
    pub(super) fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: "unavailable".into(),
            stop_id: None,
            classes: vec![],
            message: message.into(),
        }
    }
}

#[derive(PartialEq)]
struct Scope {
    stop_id: String,
    names: Vec<(String, u32)>,
    roots: Vec<PathBuf>,
    truncated: bool,
}
pub(super) struct Baseline {
    scope: Scope,
    files: BTreeMap<String, (class_reload::ClassFile, String)>,
    excluded: usize,
}

fn scope(job: &Arc<Job>) -> Result<Scope, String> {
    if job.cancelled.load(Ordering::SeqCst)
        || !super::current_workspace_binding_is_current(&job.binding)
    {
        return Err("The debugger workspace is no longer current.".into());
    }
    let snapshot = job.read()?;
    let state = snapshot
        .debugger_state
        .ok_or("The JVM class list is unavailable.")?;
    if snapshot.state != "running"
        || snapshot.operation != "debug"
        || state.status != structured_debugger::Status::Suspended
        || !state.can_reload_classes
    {
        return Err("Pause the launched JDI session before reviewing compiled changes; manual attach requires explicit file choices.".into());
    }
    let stop_id = state
        .stop_id
        .ok_or("The debugger suspension is unavailable.")?;
    if state.loaded_classes.is_empty() {
        return Err("Refresh loaded JVM classes before building and reviewing changes.".into());
    }
    let roots = if job.project_context.is_some() {
        job.debugger_class_output_roots
            .lock()
            .map_err(|_| "Debugger outputs are unavailable.")?
            .clone()
            .filter(|roots| !roots.is_empty())
            .ok_or("The captured runtime outputs are unavailable.")?
    } else if job.request.configuration.build_tool == "jdk" {
        vec![job.binding.canonical_root.join(".ide/java/classes")]
    } else {
        return Err(
            "Synchronize the build-tool project to review its captured runtime outputs.".into(),
        );
    };
    if roots.len() > 256 {
        return Err("Too many runtime output directories to review.".into());
    }
    Ok(Scope {
        stop_id,
        names: state
            .loaded_classes
            .into_iter()
            .map(|item| (item.class_name, item.class_loader_count))
            .collect(),
        roots,
        truncated: state.loaded_classes_truncated,
    })
}

pub(super) fn capture(job: &Arc<Job>) -> Result<Baseline, String> {
    let scope = scope(job)?;
    let started = Instant::now();
    let mut files = BTreeMap::new();
    let mut bytes_read = 0;
    let mut probes = 0;
    let mut excluded = 0;
    for (name, loaders) in &scope.names {
        if *loaders != 1 {
            excluded += 1;
            continue;
        }
        let mut candidates = Vec::new();
        for root in &scope.roots {
            probes += 1;
            if probes > 65_536
                || started.elapsed() > Duration::from_secs(2)
                || job.cancelled.load(Ordering::SeqCst)
            {
                return Err(
                    "Compiled-class comparison exceeded its limits or was cancelled.".into(),
                );
            }
            let absolute = root.join(format!("{}.class", name.replace('.', "/")));
            match std::fs::symlink_metadata(&absolute) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err("Cannot inspect a runtime class output.".into()),
                Ok(_) => {}
            }
            let relative = absolute
                .strip_prefix(&job.binding.canonical_root)
                .map_err(|_| "Runtime output is outside the workspace.")?
                .to_str()
                .ok_or("Runtime output path is not UTF-8.")?
                .replace('\\', "/");
            if !candidates.contains(&relative) {
                candidates.push(relative);
            }
        }
        if candidates.is_empty() {
            continue;
        }
        if candidates.len() != 1 {
            excluded += 1;
            continue;
        }
        let file = class_reload::ClassFile {
            class_name: name.clone(),
            class_file: candidates.remove(0),
            expected_sha256: None,
        };
        let bytes = class_reload::compiled(job, &file)?;
        bytes_read += bytes.len();
        if bytes_read > 8 * 1024 * 1024 {
            return Err("Compiled-class comparison exceeded 8 MiB.".into());
        }
        let hash = format!("{:x}", Sha256::digest(&bytes));
        files.insert(name.clone(), (file, hash));
    }
    if started.elapsed() > Duration::from_secs(2) {
        return Err("Compiled-class comparison exceeded its time limit.".into());
    }
    if files.is_empty() {
        return Err("No listed JVM classes have one unambiguous pre-build file in the captured outputs; choose compiled files manually.".into());
    }
    if scope != self::scope(job)? {
        return Err("The debugger class list or suspension changed during comparison.".into());
    }
    Ok(Baseline {
        scope,
        files,
        excluded,
    })
}

pub(super) fn compare(job: &Arc<Job>, before: Result<Baseline, String>) -> Changes {
    let result: Result<Changes, String> = (|| {
        let before = before?;
        let after = capture(job)?;
        if before.scope != after.scope {
            return Err(
                "The debugger class list, outputs or suspension changed during the build.".into(),
            );
        }
        let mut changed = Vec::new();
        for (name, (previous, hash)) in &before.files {
            let (current, current_hash) = after.files.get(name).ok_or(
                "A previously compared compiled class is missing or ambiguous after the build.",
            )?;
            if previous.class_file != current.class_file {
                return Err("A compiled class changed output location during the build.".into());
            }
            if current_hash != hash {
                let mut selected = current.clone();
                selected.expected_sha256 = Some(current_hash.clone());
                changed.push(selected);
            }
        }
        if changed.len() > 32 {
            return Err("More than 32 compiled classes changed; choose a smaller explicit reload selection.".into());
        }
        let message = format!("Compared {} existing compiled files for the listed JVM names; excluded {} ambiguous names. {}These are observed file changes around this build, not proof of the bytes loaded by the JVM. Review the selection before Reload.", before.files.len(), before.excluded.max(after.excluded), if before.scope.truncated { "The JVM list was truncated. " } else { "" });
        Ok(Changes {
            status: "ready".into(),
            stop_id: Some(before.scope.stop_id),
            classes: changed,
            message,
        })
    })();
    result.unwrap_or_else(Changes::unavailable)
}
