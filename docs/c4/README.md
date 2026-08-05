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

## Current Project Foundry rendering and creation boundary

The global desktop **New XCOM 2 Project** flow is independent from Workspace Settings, XCOM machine Settings, and workspace-scoped project activation. Desktop startup injects the strict Tauri Foundry composition into the application root. The directory-selection API remains a seam rather than an assertion about native chooser or WebKit/native E2E behavior.

The adapter validates exact selection grants, render requests, immutable Apply requests, and bounded provider-neutral results. Every pre-commit failure requires `cleanupStatus`, whose closed values are `verified-complete` and `not-verified`; malformed or incomplete results fail closed. TypeScript validates the complete native plan, computes its RFC 8785/SHA-256 digest, and keeps presentation and one-shot approval custody without becoming an output authority. It maps the exact `destination-present` refusal and the exact `failed` / `pre-commit` / `stage-write-failed` / `verified-complete` result to separate fixed accessible presentations. Every other result uses one fixed non-interpolating fallback without raw native disclosure.

One shared in-process Rust `git2` renderer is the sole output authority for both Preview and Apply. Preview reads the pinned commit, tree, and reachable blobs, ignores working-tree content, returns the complete plan body, and retains the corresponding internal output bytes by operation identity.

Apply consumes operation authority before destination validation or filesystem work. If the destination is present, it returns the bounded pre-commit refusal without source, destination, sibling, stage, journal, receipt, or other filesystem writes. The conflict and surrounding state remain unchanged, no transaction residue is created, and reuse of the consumed native request has no authority.

The controller renders that refusal as the fixed atomic **Project location conflict** outcome, clears grant memory, and completes `revokeAll`. The reviewed Preview may remain only as non-authoritative context; selection, ModId, Preview, retry, and Create are disabled. Cancel is the only enabled action, Escape has identical dismissal semantics, and dismissal clears the remaining dialog state before returning focus to **New XCOM 2 Project**.

When destination validation succeeds, Apply revalidates source and destination-parent identities, invokes the shared renderer again, binds the approved digest to the re-rendered plan and retained bytes, and publishes the verified output set through private same-parent staging, a durable journal, synchronization, and non-replacing atomic rename. Every pre-commit failure returns a cleanup status. Production returns `verified-complete` only for a stage-write failure after it revalidates the operation-owned stage identity and exact tracked topology, removes tracked entries, revalidates and removes the operation-owned journal identity, observes the stage, journal, and destination absent without following links, and synchronizes the same revalidated selected parent. Any unmet condition returns `not-verified`; unverified state is preserved, malformed or invalid results fail closed, and no positive cleanup claim is made. The exact verified result receives the fixed **Project creation stopped safely** presentation; all other pre-commit failures use the generic fallback. Post-commit failure preserves the destination and recovery journal.

Current atomic publication is Linux-only. This boundary claims no native chooser or WebKit/native E2E behavior, other fault point or conflict/failure/cleanup/recovery matrix, Windows support, or package, build, deploy, launch, auto-open, or product-publication capability. It does not execute template content. XCOM publication remains separately gated by distributable-module extraction and license/notice approval. Project Foundry remains separate from RefactorKit import mutation and XCOM SDK setup transactions.

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
