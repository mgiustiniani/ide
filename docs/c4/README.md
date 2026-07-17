# C4 workspace validation

[`workspace.dsl`](workspace.dsl) is the architecture source of truth. Validate it with Structurizr CLI **2026.06.28**:

```bash
structurizr validate -workspace docs/c4/workspace.dsl
```

## XCOM 2 project activation boundary

The desktop architecture combines two independent recognition-only activation inputs: the project-owned, IDE-read-only `.ide/xcom2.json` v1 contract and Option A convention recognition. The exact configuration schema is `{ "version": 1, "target": "wotc", "moduleRoots": [...] }`; configured roots must be unique normalized workspace-relative existing non-symlink directories contained in the authorized workspace. Valid configuration grants source `configured` with activation confidence `explicit`, while recognition confidence remains separate. Invalid configuration yields only safe diagnostics and cannot suppress an independent convention result.

Workspace transitions and explicit full **Workspace Refresh** revoke the activity synchronously. Joint configuration/scan correlation suppresses late results; there is no configuration watcher, polling, IDE write, `.gitignore` mutation, or external-root authority. The accessible **XCOM 2 Project** activity remains recognition-only. Machine Settings and browser behavior remain independent and unchanged. Manual confirmation, external roots, Build, Problems, Logs, language support, tools, actions, and bottom contributions remain future boundaries.

The repository does not own a Structurizr container or image invocation. It therefore does not pin an image tag or digest. The version above is the validated CLI compatibility boundary; installation and acquisition of that CLI remain external to this repository.

## Self-contained rendering

The workspace intentionally has no `theme` declaration. Its explicit styles cover the generic rounded element shape, software-system and container boundaries, and every modeled person, software system, container, component, external system, target element, and frozen element. This keeps the established C4 colors, shapes, boundaries, and target/frozen borders under repository control without fetching the former Structurizr Cloud default theme.

For migration comparison, the former default theme was retrieved on 2026-07-15 from `https://static.structurizr.com/themes/default/theme.json`; its SHA-256 was `e37ec2c05c1b8544beb0c0f132381c708806d65359ca2181d48240c3488e9b7e`. No theme file is vendored: the small generic shape and boundary settings that affected these views are expressed directly in the DSL.

A future remote theme must not be added. If a theme becomes necessary, vendor the authoritative file locally together with its license, source URL, retrieval date, and SHA-256 checksum, then reference only that local file from the DSL.

## Offline boundary

First-time acquisition of Structurizr CLI or a chosen execution image can require network access. Once Structurizr CLI 2026.06.28 is available locally, validation and export of this workspace require no network access: the DSL has no remote include or theme dependency. Image selection and supply-chain verification remain the responsibility of the execution environment because this repository invokes no image.

Views use deterministic `autoLayout lr`; there is no curated `workspace.json` layout in this repository. Exports are derived review artifacts and should be generated outside the working tree unless a separate change explicitly adopts them.

For a direct offline export audit, write each derived format to a temporary directory and remove it after inspection:

```bash
review_dir="$(mktemp -d)"
structurizr export -workspace docs/c4/workspace.dsl -format static -output "$review_dir/static"
structurizr export -workspace docs/c4/workspace.dsl -format mermaid -output "$review_dir/mermaid"
structurizr export -workspace docs/c4/workspace.dsl -format json -output "$review_dir/json"
rm -rf "$review_dir"
```

Image rendering is not part of this routine audit.
