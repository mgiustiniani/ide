use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};

use super::contract::{
    configuration_roots, BeginActivationEvidenceRequest, NativeModuleConfigurationReadResult,
    NativeModuleScanSnapshot,
};
use super::filesystem::{module_directory_identity, WorkspaceBinding};
use super::state::RetainedModule;

pub(super) const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAXIMUM_ID_BYTES: usize = 256;
const MAXIMUM_HANDLES: usize = 64;

pub(super) fn validate_begin_request(
    request: &BeginActivationEvidenceRequest,
) -> Result<(), String> {
    if !valid_id(&request.workspace_id)
        || !valid_id(&request.scan_id)
        || !valid_id(&request.configuration_read_id)
    {
        return Err("candidate-invalid".to_string());
    }
    if !valid_generation(request.workspace_generation) || !valid_generation(request.scan_generation)
    {
        return Err("candidate-invalid".to_string());
    }
    Ok(())
}

pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_ID_BYTES
        && !value
            .chars()
            .any(|character| matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}'..='\u{009f}'))
}

pub(super) fn valid_generation(value: u64) -> bool {
    value > 0 && value <= JS_MAX_SAFE_INTEGER
}

pub(super) fn retained_modules(
    binding: &WorkspaceBinding,
    scan: &NativeModuleScanSnapshot,
    configuration: &NativeModuleConfigurationReadResult,
    handles: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, RetainedModule>, String> {
    if handles.len() > MAXIMUM_HANDLES {
        return Err("candidate-invalid".to_string());
    }
    let configured_roots = configuration_roots(configuration)
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut kinds = BTreeMap::<String, BTreeSet<String>>::new();
    let mut paths = BTreeMap::<String, BTreeSet<String>>::new();
    for observation in &scan.observations {
        kinds
            .entry(observation.module_root.clone())
            .or_default()
            .insert(
                serde_json::to_string(&observation.evidence_kind)
                    .map_err(|_| "candidate-invalid".to_string())?,
            );
        paths
            .entry(observation.module_root.clone())
            .or_default()
            .insert(observation.relative_path.clone());
    }

    let mut retained = BTreeMap::new();
    for (module_root, handle) in handles {
        let configured = configured_roots.contains(module_root);
        let distinct_kinds = kinds.get(module_root).map_or(0, BTreeSet::len);
        let strong = configured || distinct_kinds >= 2;
        let module_identity = module_directory_identity(binding, module_root)?;
        let source_hash = source_hash(
            module_root,
            configured,
            kinds.get(module_root),
            paths.get(module_root),
        );
        retained.insert(
            handle.clone(),
            RetainedModule {
                module_root: module_root.clone(),
                evidence_handle: handle.clone(),
                source_hash,
                strong,
                configured,
                module_identity,
            },
        );
    }
    Ok(retained)
}

fn source_hash(
    module_root: &str,
    configured: bool,
    kinds: Option<&BTreeSet<String>>,
    paths: Option<&BTreeSet<String>>,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"xcom2-native-activation-source-v1\0");
    digest.update(module_root.as_bytes());
    digest.update([u8::from(configured)]);
    for kind in kinds.into_iter().flatten() {
        digest.update(b"\0kind\0");
        digest.update(kind.as_bytes());
    }
    for path in paths.into_iter().flatten() {
        digest.update(b"\0path\0");
        digest.update(path.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

pub(super) fn expected_active_handles(
    modules: &BTreeMap<String, RetainedModule>,
) -> BTreeSet<String> {
    modules
        .iter()
        .filter(|(_, module)| module.strong)
        .map(|(handle, _)| handle.clone())
        .collect()
}

pub(super) fn has_weak_evidence(modules: &BTreeMap<String, RetainedModule>) -> bool {
    modules.values().any(|module| !module.strong)
}
