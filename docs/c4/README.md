# C4 workspace validation

[`workspace.dsl`](workspace.dsl) is the architecture source of truth. Validate it with Structurizr CLI **2026.06.28**:

```bash
structurizr validate -workspace docs/c4/workspace.dsl
```

## XCOM 2 project activation boundary

The desktop architecture combines two independent recognition-only activation inputs: the project-owned, IDE-read-only `.ide/xcom2.json` v1 contract and Option A convention recognition. The exact configuration schema is `{ "version": 1, "target": "wotc", "moduleRoots": [...] }`; configured roots must be unique normalized workspace-relative existing non-symlink directories contained in the authorized workspace. Valid configuration grants source `configured` with activation confidence `explicit`, while recognition confidence remains separate. Invalid configuration removes configured authority and cannot suppress an independently strong Option A result.

The diagnostic mapper accepts exactly eight presentation-safe codes: `configuration-unreadable`, `configuration-too-large`, `configuration-invalid-utf8`, `configuration-invalid-json`, `configuration-invalid-schema`, `configuration-unsupported-version`, `configuration-unsupported-target`, and `configuration-invalid-module-roots`. Each selects fixed, non-interpolated title, project-file label, summary, remediation, and support identifier copy. The shared UI renders one complete atomic alert in **Settings > Workspace > Current workspace**. When strong Option A recognition independently preserves the **XCOM 2 Project** activity, its panel mirrors the same complete alert; the diagnostic itself creates no activity or authority.

Workspace transitions and explicit full **Workspace Refresh** clear prior decisions and diagnostics synchronously, show a neutral checking state, and accept only the exact current jointly correlated configuration and scan result. Late or stale results restore nothing; there is no configuration watcher or polling. The diagnostic grants no edit, open, write, process, tool, project-action, external-root, or mutation authority and discloses no configuration content, submitted roots, absolute paths, parser/provider/native details, secrets, or raw causes. XCOM configuration and Option A inputs are never written; normal application-owned `.ide/workspace.json` marker and registry metadata are outside that XCOM input no-write scope.

The accessible **XCOM 2 Project** activity remains recognition-only. XCOM machine Settings lifecycle and browser behavior remain independent and unchanged. Manual confirmation, external roots, Build, Problems, Logs, language support, tools, actions, and bottom contributions remain future boundaries.

Separately, the native desktop path presents the exact accessible missing-Steam monitor state through the normal App/Tauri/Rust integration from isolated empty directories. This focused presentation does not broaden the harness-only machine Settings lifecycle requirement.

The repository does not own a Structurizr container or image invocation. It therefore does not pin an image tag or digest. The version above is the validated CLI compatibility boundary; installation and acquisition of that CLI remain external to this repository.

## Project Foundry preview boundary

The global desktop **New XCOM 2 Project** flow is independent from Workspace Settings, XCOM machine Settings, and workspace-scoped project activation. Production startup injects the strict Tauri Foundry composition into the App; fake selectors remain confined to harness and adapter-test seams.

The adapter integrates the Tauri allow-open directory API, validates canonical Linux paths and complete renderer DTOs, and delegates ephemeral grants and rendering to Rust. One shared in-process Rust `git2` renderer is the sole output authority: it revalidates directory identities and destination absence, reads the pinned commit, tree, and reachable blobs, produces the complete plan body, and retains the corresponding internal output bytes. Working-tree content is ignored and neither selected location is written.

TypeScript validates the complete native DTO and its internal consistency, computes the RFC 8785/SHA-256 digest, and deep-freezes the result. The controller and UI retain presentation and approval custody without becoming output authorities. `@ide/web-core` contains no embedded EMPT source/output metadata, generated preview implementation, pure renderer, planner, or parallel output authority.

Native chooser acceptance and GUI/end-to-end execution are absent. Fake selectors are confined to harness and adapter-test seams and do not imply real native chooser execution. Production has no Project Foundry Apply filesystem transaction; a future Apply boundary must reuse the same Rust renderer authority rather than accept frontend bytes or metadata. Project creation, output writes, build, deploy, cooking, package, distribution, license-clearance, and publication are absent. RefactorKit import mutation and its package policies remain separate and unchanged.

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
