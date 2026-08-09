# C4 workspace validation

[`workspace.dsl`](workspace.dsl) is the architecture source of truth. Validate it with Structurizr CLI **2026.06.28**:

```bash
structurizr validate -workspace docs/c4/workspace.dsl
```

## Workspace-native Pi Agent boundary

The desktop **Agent** activity follows the existing Workspace Registry. **Files** continues to use the existing File Explorer and editor; the Agent surface introduces no parallel workspace, file, document, chat, or history authority.

Every native Pi command derives its renderer identity from the actual Tauri WebView label: `main` maps only to `docked:main`, and `pi-agent` maps only to `detached:pi-agent`. A supplied view ID must match that fixed derivation. The main renderer is authorized against the current Workspace Registry ID and canonical root; the detached renderer is authorized against its immutable workspace pin. After attachment, commands that read or mutate session or process state require the derived attachment to remain present, with a final binding or pin recheck. Stale main detach is cleanup-only: it can remove its own derived attachment after a switch but gains no read, write, resize, start, stop, snapshot, or accessory authority.

The Rust Backend owns one portable pseudoterminal process per workspace. It launches the fixed `pi` executable in the canonical registered root with deterministic session identity `ide-{workspaceId}` and exchanges raw terminal bytes with xterm. The backend retains a one-MiB tail only to restore terminal transport after renderer reattachment; that tail is not Pi conversation or session history. Docked and detached renderers remain non-owning attachments, and only the separately confirmed **Stop Pi** operation terminates the selected workspace process during normal application operation.

Only the caller-authorized current `session` is returned as a full snapshot. The aggregate `sessions` collection is a closed rootless summary containing workspace identity and name, deterministic session identity, process state and generation, last-activity time, and attachment count. It excludes roots, process IDs, exit/start details, errors, activities, and terminal bytes. The strict adapter rejects extra summary fields, and status reconciliation projects current detail back into the same rootless shape.

Raw output and status use targeted `emit_to` delivery only after the backend confirms that `main` or the pinned `pi-agent` view is both authorized and attached. The adapter validates each payload, and the renderer controller accepts only the current workspace, process generation, and increasing terminal sequence. Resize authority is armed only by the current attachment request and accepted generation; geometry revisions are replayed after attach or restart only while that authority is still current. Stale workspace, attachment, generation, sequence, or resize completions cannot advance renderer state or resize another workspace PTY.

Pi exclusively owns chat, history, tools, models, commands, extensions, trust, compaction, and retry. **Changes**, IDE **Activity**, **Resources**, and process **Sessions** are bounded read-only accessories. The desktop shell does not compose the legacy RPC chat projection; bounded package and command discovery remains accessory metadata rather than an interaction authority.

Controlled integration tests may substitute a deterministic executable named `pi` at the same resolved fixed-argv process-launch seam. That executable is test infrastructure, not the external **Pi Interactive Runtime**, a second provider relationship, or a substitute owner for Pi conversation semantics.

## XCOM 2 activation authority and recipe-review boundary

The desktop architecture keeps the established project-owned, IDE-read-only `.ide/xcom2.json` v1 contract and Option A recognition semantics. Native begin performs both bounded reads, binds the authorized workspace and module identities, and returns safe facts with one opaque activation-attempt receipt and opaque per-root evidence handles. Each attempt that reaches generation reservation receives one positive JavaScript-safe `inspectionGeneration`; acceptance carries that value into the exact inspection authority. A failure after reservation consumes its value, a later accepted authority receives a later generation, and exhaustion fails closed without wrapping or accepting authority. Trusted TypeScript applies the unchanged evaluators and acknowledges only the receipt and exact handles selected for the complete active-root set. Rust materializes exactly those accepted roots with the reserved inspection generation in volatile native state.

The exact configuration schema remains `{ "version": 1, "target": "wotc", "moduleRoots": [...] }`; recipe inspection neither extends it nor creates a build manifest. Workspace refresh, switch or activation start, activation failure, a newer activation generation, application exit, and cached React restoration synchronously revoke native authority. Cached presentation cannot restore accepted roots.

The diagnostic mapper accepts exactly eight presentation-safe codes: `configuration-unreadable`, `configuration-too-large`, `configuration-invalid-utf8`, `configuration-invalid-json`, `configuration-invalid-schema`, `configuration-unsupported-version`, `configuration-unsupported-target`, and `configuration-invalid-module-roots`. Each selects fixed, non-interpolated title, project-file label, summary, remediation, and support identifier copy. The shared UI renders one complete atomic alert in **Settings > Workspace > Current workspace**. When strong Option A recognition independently preserves the **XCOM 2 Project** activity, its panel mirrors the same complete alert; the diagnostic itself creates no activity or authority.

Workspace transitions and explicit full **Workspace Refresh** clear prior decisions and diagnostics synchronously, show a neutral checking state, and accept only the exact current jointly correlated configuration and scan result. Late or stale results restore nothing; there is no configuration watcher or polling. The diagnostic grants no edit, open, write, process, tool, project-action, external-root, or mutation authority and discloses no configuration content, submitted roots, absolute paths, parser/provider/native details, secrets, or raw causes. XCOM configuration and Option A inputs are never written; normal application-owned `.ide/workspace.json` marker and registry metadata are outside that XCOM input no-write scope.

The accessible **XCOM 2 Project** activity hosts recipe review only for a native-authorized active module. Inspection keeps the exact token-free request `{ workspaceId, generation, moduleRoot }`; receipts and evidence handles do not become renderer-managed inspection credentials. Rust matches the request to an exact accepted root and returns bounded no-follow metadata for the untrusted `.scripts/build.ps1`, the complete bounded MIT X2ModBuildCommon attribution notice, project-local Highlander source, matching unresolved Workshop runtime, and other unresolved prerequisites. Every candidate carries the accepted authority's stable `inspectionGeneration`. Repeated unchanged native inspections under that exact authority return identical candidate facts. Script, notice, or conventional metadata changes retain the authority generation while changing the freshly bound facts and resulting TypeScript digest. Workspace-registry checks before and after the filesystem read and an exact-authority check after the read reject stale work.

The review renders the complete notice as escaped text in an accessible **attribution notice** field, preserving its bounded text separately from **notice identity**. Empty, hostile command/script-like, machine-path-bearing, control-bearing, non-normalized, or oversized notice text refuses the review rather than being rendered.

TypeScript validates the closed metadata and takes RFC 8785/SHA-256 digest custody over the stable inspection-authority generation and every fresh bound fact. It can retain one volatile one-shot metadata approval. Provider-neutral `consumeApproval(request)` is an asynchronous decision seam, not a production caller, executor, or consumer. It synchronously makes approval authority unavailable before awaiting a fresh exact `{ workspaceId, generation, moduleRoot }` inspection. It fully reviews the fresh candidate and reconciles the exact digest and current metadata before authorizing identical bound facts once. Any changed bound fact, later inspection authority, invalid metadata, inspection error, concurrent request, or replay refuses or retains revoked/consumed authority.

No production component calls this seam, and the UI exposes only review, **Approve exact recipe**, and **Discard**. It exposes no Consume, Execute, Build, Deploy, Cook, or Launch action. There is no recipe watcher or polling: an unseen filesystem mutation is detected only when a requested consumption decision performs fresh inspection, with authority unavailable throughout that reinspection. Explicit refresh and context changes continue to revoke synchronously.

No build consumer exists. There is no process, shell, network, workspace-write, SDK, game, Steam-prefix, `pfx_copy`, Deploy, Cook, Launch, or execution authority. Browser activation and recipe inspection reject honestly without simulated metadata or success.

XCOM machine Settings lifecycle remains independent. Manual confirmation, external roots, operational Build, Problems, Logs, language support, tools, actions, and bottom contributions remain separate boundaries.

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

Views use deterministic `autoLayout lr`; there is no curated `workspace.json` layout in this repository. The view-set property `structurizr.metadata=false` keeps titles and descriptions but suppresses renderer-generated timestamps, making repeated transient PNG/SVG renders byte-stable. Exports are derived review artifacts and should be generated outside the working tree unless a separate change explicitly adopts them.

For a direct offline export audit, write each derived format to a temporary directory and remove it after inspection:

```bash
review_dir="$(mktemp -d)"
structurizr export -workspace docs/c4/workspace.dsl -format static -output "$review_dir/static"
structurizr export -workspace docs/c4/workspace.dsl -format mermaid -output "$review_dir/mermaid"
structurizr export -workspace docs/c4/workspace.dsl -format json -output "$review_dir/json"
rm -rf "$review_dir"
```

Image rendering is not part of this routine audit.
