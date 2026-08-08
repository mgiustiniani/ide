# Component Diagrams (C3) — Current and Target Boundaries

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only with locally bundled Java syntax highlighting. Guarded Java semantics cross provider-neutral components without Java module activation. **Paste Java Class from Clipboard** and saved-snapshot TypeScript/JavaScript diagnostics remain separate managed RefactorKit flows. Desktop XCOM 2 activation evaluates native-issued facts, acknowledges only opaque handles, and leaves accepted-root authority in Rust. The active-module surface can review and approve one metadata-only Default Build recipe; it has no execution consumer. Workspace Settings and machine Settings remain separate. Focused native evidence covers the exact accessible missing-Steam state through the real App/Tauri/Rust monitor path from isolated empty directories; the broader machine Settings lifecycle evidence remains harness-only.

## Desktop Composition and Controller Boundaries

`App.tsx` is a composition-only root. It creates stores, view models, and typed adapters; wires capability and shell controllers; composes RefactorKit diagnostics and separately approved Symbol Navigation support behind capability-specific boundaries; accepts the injected Project Foundry composition; derives presentation props; and renders the shell. `main.tsx` supplies the strict Tauri Foundry composition with selection, rendering, one-shot Apply, and revocation ports. Feature orchestration remains inside the controllers rather than in `App.tsx`.

The **Workspace Controller** owns the authorized active-root transition and coordinates workspace-scoped collaborators; it does not absorb their bounded-context responsibilities. It synchronously revokes XCOM project recognition before a root transition and starts recognition only after authorization. Open Settings independently owns the machine monitor and transaction runtime.

```text
Workspace Port ──ensure authorized current root──> Workspace Controller
                                                     │
                                                     ├─> Desktop Editor Controller
                                                     ├─> Java Language Controller
                                                     ├─> RefactorKit Import Controller
                                                     ├─> RefactorKit Status Controller
                                                     ├─> RefactorKit Symbol Navigation Support
                                                     ├─> AI Agent Controller
                                                     ├─> XCOM Project Activation Controller
                                                     │    (synchronous revoke + correlated reads)
                                                     └─> XCOM Setup Controller
                                                          (Settings-owned machine runtime)

WorkspaceGeneration: positive and monotonically increasing for runtime
workspace-switch attempts; shared by collaborators to reject stale work.
Exhaustion fails closed rather than reusing an old generation.
```

Cold start first establishes the native-authorized root, then promotes that authorization evidence into registry state. Only after that gate does the Workspace Controller publish the current generation to collaborators, restore editor state, load the file tree, attach/load Java, activate workspace-keyed AI state and commands, and discover RefactorKit status/capabilities. For XCOM it keeps old authority revoked until authorization succeeds, then begins one native evidence attempt. Rust reads the fixed configuration and convention metadata and returns safe facts bound to an opaque attempt receipt and opaque per-root handles. Trusted TypeScript evaluates those facts and acknowledges only the receipt and handles for the complete active set; it never sends roots, paths, configuration, hashes, or commands back as authority. Explicit full **Workspace Refresh** uses the same synchronous-revoke boundary. While Settings is closed, its machine-runtime collaborator calls return without monitor snapshots or refreshes, transaction history or detail reads, polling, or subscriptions. Opening Settings creates exactly one monitor-adapter lifecycle and one transaction-adapter lifecycle; closing Settings invalidates their requests, unsubscribes both, and clears their poll timers. Passive Settings open refresh remains distinct from the explicit full Workspace Refresh control. A workspace switch restarts machine lifecycles only when Settings remains open. Workspace transitions also invalidate the composed RefactorKit diagnostic and Symbol Navigation support; lifecycle wiring does not expand either capability's approved scope. Global AI configuration and workspace-independent terminal setup are not represented as workspace-authorized reads.

| Current C3 component                      | Stable structural responsibility                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace Controller**                  | Owns registry metadata, authorized active-root transitions, loading/switching state, and the shared generation boundary. It coordinates recognition revocation/start and setup correlation; XCOM feature controllers own behavior and adapter lifetimes.    |
| **Desktop Editor Controller**             | Coordinates guarded open/create, tab lifecycle, deferred session restore, workspace reset, and safe presentation state. Only a tab with its matching loaded buffer becomes a ready active document.                                                         |
| **Java Language Controller**              | Owns workspace-scoped language lifecycle, versioned Java document sync, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, guarded semantics, cancellation, and stale identity checks through provider-neutral ports. |
| **RefactorKit Import Controller**         | Owns the separate capability-gated clipboard import transaction: selection/workspace freshness, preview, exact displayed-plan approval, invalidation/discard, result refresh, and backend-authoritative result opening.                                     |
| **RefactorKit Status Controller**         | Performs provider-neutral, diagnostic-only status and capability discovery. Independent outcomes are normalized and stale generations are dropped; this component has no preview, apply, rollback, or mutation authority.                                   |
| **RefactorKit Symbol Navigation Support** | Composed TypeScript/JavaScript saved-snapshot search/definition support and workspace cleanup within its separately approved source-built-provider boundary.                                                                                                |
| **AI Agent Controller**                   | Owns configuration/status plus workspace-keyed commands, session messages, activities, prompt state, and stale-request suppression. Only an explicit trimmed panel prompt crosses its port.                                                                 |
| **XCOM Project Activation Controller**    | Evaluates one native-issued configuration/scan attempt, acknowledges only selected opaque handles, owns synchronous renderer and native revocation, and exposes token-free inspection authorization only for exact accepted roots.                          |
| **XCOM Build Recipe Review Controller**   | Requests inspection with only `workspaceId`, `generation`, and `moduleRoot`; coordinates accessible review, exact approval, and discard presentation. It does not call the consumption seam and owns no build consumer.                                     |
| **XCOM Build Recipe Review Service**      | Owns volatile state and an async provider-neutral consumption decision seam. It revokes before awaiting fresh exact inspection; no production component calls it.                                                                                           |
| **XCOM Build Recipe Review Policy**       | Fully validates closed metadata and digest custody, reconciles fresh facts, and authorizes an identical current recipe once while refusing changed, invalid, stale, revoked, consumed, or malformed requests.                                               |
| **XCOM Setup Controller**                 | Keeps machine setup transaction authority correlated to workspace/generation identity. Only open Settings owns one monitor and one transaction adapter lifecycle; close invalidates requests, unsubscribes both, and clears their poll timers.              |

The six additional extracted controllers keep shell, document, and editor coordination out of the composition root:

| Current extracted C3 component     | Stable structural responsibility                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Settings Controller**            | Owns Settings visibility. Its open state gates the independently owned XCOM lifecycle; its explicit open coordinator refreshes AI, workspace, Java, and RefactorKit without directly starting or refreshing XCOM.              |
| **Terminal Controller**            | Owns workspace-independent terminal connection/session lifecycle, command and input coordination, output clearing, and workspace-reset presentation cleanup.                                                                   |
| **File Explorer Controller**       | Coordinates folder expansion and empty-editor file creation through the file-tree and Desktop Editor boundaries.                                                                                                               |
| **Document Navigation Controller** | Owns document-preview visibility and diagnostic navigation; it opens the target through the Desktop Editor Controller before issuing a reveal request.                                                                         |
| **Editor Command Controller**      | Coordinates buffer changes, save, activation, and close ordering across editor persistence and Java document synchronization.                                                                                                  |
| **Desktop Shell Controller**       | Routes left-sidebar and bottom-panel resize/visibility requests to layout state without resetting dimensions; owns active bottom-tab state, AI command loading on activation, and guarded Problems visibility/severity policy. |

The Workspace Controller coordinates lifecycle ordering; normal feature interactions remain direct at the most specific C3 boundary. In particular, editor readiness feeds the Java Language Controller, the RefactorKit Import Controller opens only a backend-reported result through the Desktop Editor Controller, and the extracted command/navigation controllers reuse those boundaries rather than bypassing them.

## Project Foundry Rendering, Refusal, and One-shot Apply

```text
Desktop main ──injects strict Foundry composition──> App.tsx
                                                       │
                                                       ├─> Project Foundry Controller
                                                       └─> Project Foundry Dialog

Project Foundry Dialog ──selection / Preview / Create / Cancel / Escape──> Controller
Controller
  ├─ serialized grants, synchronous one-shot Apply consumption, stale guards
  ├─> Project Foundry Plan and Outcome Custody
  │     ├─ native-plan validation + RFC 8785 / SHA-256 digest
  │     ├─ immutable request from live grants + exact approved digest
  │     ├─ exact conflict and verified-cleanup mappings; fixed fallback otherwise
  │     └─ consumed terminal decision with only Cancel enabled
  └─> Strict Project Foundry Tauri Adapter
         ├─ exact request and bounded provider-neutral result validation
         ├─ Preview ──> Native Authority and Grants ──> shared git2 renderer
         └─ Apply ─────> Native Project Foundry Apply Transaction
                           ├─ consume native operation before destination validation
                           ├─ destination present
                           │    └─ bounded refusal; no transaction writes or residue
                           └─ destination absent
                                ├─ re-render through the shared git2 renderer
                                └─ stage + journal + verify + fsync
                                     ├─ non-replacing atomic publication
                                     └─ pre-commit failure
                                          └─ verified-complete or not-verified cleanup status
```

| C3 component                                    | Stable structural responsibility                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desktop Composition Root and IDE UI State**   | Receives one Foundry composition and passes controller state and callbacks to the dialog without becoming an output or transaction authority.                                  |
| **Project Foundry Controller**                  | Owns sessions, serialized selection and one-shot Apply authority, stale guards, revocation, immutable presentation, and terminal dismissal lifecycle.                          |
| **Project Foundry Dialog**                      | Renders reviewed plans and fixed accessible terminal outcomes. A terminal refusal disables selection, Preview, and Create and leaves Cancel and Escape dismissal.              |
| **Project Foundry Plan and Outcome Custody**    | Validates native plans, computes their digest, prepares immutable Apply requests, maps exact conflict and verified-cleanup results separately, and defines terminal decisions. |
| **Strict Project Foundry Tauri Adapter**        | Snapshots and validates exact Preview and Apply DTOs, including mandatory bounded cleanup status on pre-commit failures, without admitting raw causes.                         |
| **Directory Selection API Boundary**            | Supplies the single-directory API seam used by the adapter; it does not assert native chooser or WebKit/native E2E behavior.                                                   |
| **Native Project Foundry Authority and Grants** | Owns in-memory grants, consumes the operation before validation, remembers consumed identities, performs directory checks, and retains renderer bytes.                         |
| **Shared Project Foundry git2 Renderer**        | Is the sole output authority for Preview and Apply. It reads pinned Git objects and produces the plan body and internal bytes without reading the working tree.                |
| **Native Project Foundry Apply Transaction**    | Refuses a present destination; otherwise publishes the complete set or reports bounded cleanup status after operation-owned pre-commit cleanup checks.                         |

The provider-neutral `ProjectFoundryComposition` is the injection seam. The controller synchronously consumes frontend creation authority before making one immutable Apply call. Native Apply consumes the operation grant before destination validation. Reusing that consumed request has no authority.

When destination validation finds an existing item, Apply returns only the bounded pre-commit `destination-present` refusal. It does not create a stage, journal, receipt, or destination output and does not write the conflict, source repository, destination-parent siblings, or other filesystem state. The conflict, source, parent entries, and sibling identities remain under their existing owners.

Plan and Outcome Custody maps that exact refusal to the fixed atomic **Project location conflict** presentation and support code `foundry-apply-destination-present`. It separately maps only the exact `failed` / `pre-commit` / `stage-write-failed` / `verified-complete` result to **Project creation stopped safely** and support code `foundry-apply-stage-write-cleanup-verified`. Every other result maps to the non-interpolating **Project creation needs attention** fallback and support code `foundry-apply-unavailable`. No presentation includes conflict or cleanup metadata, paths, sibling listings, transaction names, commands, provider/backend identity, raw causes, persisted diagnostics, or support bundles.

Both bespoke outcomes are terminal for the approved Preview. Publishing either clears controller grant memory and completes `revokeAll`. Source selection, destination selection, ModId, Preview, retry, and Create are disabled; reviewed Preview facts may remain only as non-authoritative context. Cancel is the only enabled action, Escape has identical dismissal semantics, and the modal focus boundary remains active. Dismissal closes the dialog, clears controlled values, Preview, outcome, digest, approval, and authority, preserves filesystem state, and returns focus to **New XCOM 2 Project**.

When destination validation succeeds, Rust revalidates source and parent identities, re-renders from pinned Git objects, compares the canonical digest and retained bytes, and repeats checks before commit. A non-replacing rename atomically publishes the verified output set. Every pre-commit failure returns mandatory `cleanupStatus` with the closed values `verified-complete` and `not-verified`. The positive value is restricted to a stage-write failure after operation-owned stage identity and tracked-topology checks, tracked-entry removal, journal identity revalidation and removal, no-follow absence observations for stage, journal, and destination, and synchronization of the same revalidated selected parent all succeed. Any unmet condition returns `not-verified`; unverified state is preserved, malformed or invalid results fail closed, and no positive cleanup wording is authorized. Post-commit failure preserves the destination and recovery journal.

Project Foundry remains independent from XCOM activation, machine Settings, SDK setup transactions, and RefactorKit imports. Current atomic publication is Linux-only. This boundary claims no native chooser or WebKit/native E2E behavior, other fault point or conflict/failure/cleanup/recovery matrix, Windows support, or package, build, deploy, launch, auto-open, and product-publication capability. It does not execute template content. XCOM publication remains separately gated by distributable-module extraction and license/notice approval.

## Controlled Desktop Panel Visibility

```text
Collapsed left sidebar ──activity-rail Expand control──> Desktop Shell Controller
Status bar ──persistent bottom-panel toggle────────────> Desktop Shell Controller
                                                            │
                                                            ▼
                                                    Panel layout state
                                            (visibility changes retain sizes)
```

The shared `PanelLayout` renders host-controlled visibility controls. When the left sidebar is collapsed, its recovery control remains in the activity rail; the bottom-panel toggle remains in the status bar whether the panel is expanded or collapsed. `App.tsx` wires both callbacks to the Desktop Shell Controller, which routes them to panel layout state. Visibility changes do not overwrite the retained runtime width or height, so expansion restores the prior dimension. These shell controls remain separate from the left-sidebar accordion and from bottom tool-window content and contribution policy.

## Desktop Left Sidebar Accordion

```text
Left Sidebar
  ├─ File Explorer       [independently collapsible]
  └─ Workspace Explorer  [independently collapsible]
       ├─ registered workspaces
       ├─ exact workspace switch + switching/loading state
       ├─ metadata refresh
       └─ visible errors
```

File Explorer is above Workspace Explorer. The two sections retain independent expanded state. Workspace switching and refresh live in Workspace Explorer; the duplicate header workspace select has been removed.

## Directory-tree Paste Java Class from Clipboard

```text
Developer
  ├─ directory context action: Paste Java Class
  └─ Ctrl/Cmd+V while the directory tree owns focus
          │ (no editor interception, no global listener)
          ▼
RefactorKit Import Controller
  1. validate selected workspace-relative directory
  2. require the advertised API and exact RefactorKit java.importExternalClass
     targetDirectory preview/apply/discard/rollback method features
     └─ missing or incomplete required methods → unavailable before clipboard read; no force
  3. explicitly read clipboard once
  4. request rich targetDirectory preview and display normalized plan evidence
  5. require per-plan acknowledgement for unknown/high-risk license or provenance
  6. guard workspace + selection generation and exact approved planId
  7. apply that exact planId through RefactorKit; display returned transaction
  8. refresh tree/open primary file only from backend result paths
  9. invoke refactor.discard on cancel or selection/workspace invalidation
```

The UI does not copy raw Java, infer a target package, construct a patch, or write project content. Clipboard source is transient, routed only to RefactorKit preview, never logged, and has no Pi/AI Agent relationship. Preview/no-write is scoped to the imported target and other project content before Apply; it is not a byte-identical hidden-metadata guarantee because provider `project.open` may create `.refactorkit/workspace.lock`.

Rollback is implemented only behind provider-neutral contracts, Tauri adapters, Rust commands, and provider transaction authority. The current Java import surface exposes no rollback action.

The Rust bridge launches one `bin/refactorkit-daemon` NDJSON process for the canonical workspace and current workspace generation. Its thin Tauri facade delegates to separate application, capability-policy, contract, path-policy, and transport modules. Compatibility is provider-version-neutral: provider version is diagnostic metadata, while the advertised API and exact required import method features gate the transaction. Normalized language-kernel, runtime-limit, and safety metadata are retained evidence rather than blanket authorization. Malformed output, timeout, workspace switch, or app exit kills the process.

## Rust Facade and Module Boundaries

```text
Tauri Java commands ──> thin Java Language facade
                          └─ application service
                               ├─ contract + path policy
                               └─ protocol + semantic + toolchain + support

Tauri RefactorKit commands ──> thin RefactorKit Daemon facade
                                 └─ application service
                                      ├─ capability + safety policy
                                      ├─ contract + path policy
                                      └─ managed NDJSON transport
```

The facades only expose inbound commands and re-export bounded types. Process ownership, use-case orchestration, policy, normalization, path authorization, and transport stay in the modules behind them. RefactorKit IDE scope includes status/capability discovery, the managed Java import transaction, saved-snapshot TypeScript/JavaScript diagnostics, and separately approved saved-snapshot semantic navigation. The source-built-provider exception remains capability-specific and does not promote other provider foundations or frozen Java navigation, mutation, hierarchy, and activation ideas into IDE capabilities.

## Dynamic Bottom Tool-window Host

```text
Host application ──contributes tab descriptors──> BottomPanel
  desktop: Terminal [core], AI Agent [core]
           Problems [project, while ready Java context or projected items exist]
  web:     Terminal [core]

descriptor: id + label + icon? + title? + core/project scope
            + badge/count? + disabled? + active state
keyboard:  ArrowLeft/ArrowRight/Home/End across enabled tabs
ARIA:      tablist → tabs → tabpanel
```

The BottomPanel is an accessible dynamic contribution host, not a hard-coded Java/XCOM technology panel. The Desktop Shell Controller supplies the project-scoped Problems descriptor when the Java controller reports a ready Java context or retains projected problem items; it removes the descriptor when neither guard remains. `App.tsx` only composes and renders that policy. This guarded diagnostic visibility is not evidence-based module activation. Generic web startup performs no hidden Java/XCOM polling.

## Monaco-only Editor and Current Java IntelliSense

```text
Monaco-only Editor
  ├─ local Java Monarch/basic language contribution (syntax highlighting)
  └─ exact synchronized Java model only
       │ edit: optimistic version increment
       │       → serialized full-text didChange flush
       │       → completion / hover / signature-help request
       ▼
Java Language Controller
  ├─ provider-neutral diagnostic events
  │    ├─ active-editor diagnostics → Monaco presentation
  │    └─ workspace event projection → ProblemItem[] → conditional Problems tab
  ├─ workspace + session generation + path + URI + version guards
  ├─ request ID + cancellation ID correlation
  └─ stale/late response suppression
       │ provider-neutral contracts
       ▼
Tauri Language/Document + Java Intelligence Adapters
       │ typed invoke; malformed/mismatched payloads fail closed
       ▼
Rust Java Language Tauri Facade
       │ delegates inbound commands
       ▼
Java Language Application Service
  ├─ contract + path-policy modules: bounded DTO and identity policy
  ├─ protocol + semantic modules:
  │    didOpen / didChange / didSave / didClose
  │    textDocument/completion / hover / signatureHelp / $/cancelRequest
  ├─ toolchain module: fixed-argv JDK/JDT LS discovery and launch
  └─ support module: shared fail-closed synchronization helpers
       │ LSP over stdio; managed java.signatureHelp.enabled=true
       ▼
Eclipse JDT LS
```

The Rust `java_language` entry module is only the Tauri facade; lifecycle, contract/path validation, protocol, semantic normalization, toolchain discovery, and support concerns live in the named modules behind it. Monaco provider registries are global, so each callback rechecks that the candidate is the exact registered model and that current workspace/session/path/URI/version context still matches. Disposal cancels pending work. Semantic requests cannot overtake an in-flight `didChange` flush.

Completion maps only the primary text edit. Additional edits, cross-document/workspace edits, and commands are intentionally not mapped. Hover, signature, and completion documentation is rendered as untrusted Markdown with HTML disabled.

## Global Java Tooling Settings

```text
Desktop Settings / Java
  ├─ JDK and JDT LS lifecycle/status
  │    └─ start / stop / restart / refresh
  └─ RefactorKit availability / version / path / refresh

(no scan, definition/references results, or navigation in Settings mode)
```

Provider-neutral lifecycle, document-sync, diagnostic, semantic, and cancellation contracts; the Tauri adapters; guarded Monaco providers; the current conditional Problems projection; and the managed Rust JDT LS bridge are current. RefactorKit scope also includes the separate managed Java import transaction, saved-snapshot TypeScript/JavaScript diagnostics, and separately approved semantic navigation. Legacy/support handlers and provider foundations do not expand those capability-specific boundaries. There is no Java project/module evidence evaluator, activation state, or full activation-scoped Java tooling suite.

## Workspace-scoped XCOM 2 Activation Authority and Recipe Review

```text
Workspace Controller ──switch / refresh──> XCOM Project Activation Controller
  └─ synchronously clears presentation and starts native revocation

Activation Controller ──begin──> Strict Native Evidence Tauri Adapter
  └─ Native XCOM Activation Authority
       ├─ binds the authorized workspace and module directory identities
       ├─ reads fixed `.ide/xcom2.json` v1 and bounded convention metadata
       └─ emits safe facts + opaque attempt receipt + opaque per-root handles

Trusted TypeScript evaluators
  ├─ apply the unchanged configured and Option A recognition policies
  └─ acknowledge only the attempt receipt and exact selected handles
       └─ Rust materializes exactly those active roots in volatile native state

Default Build Recipe Review
  ├─ authorization request: `{ workspaceId, generation, moduleRoot }`
  ├─ native inspector: accepted-root match + contained no-follow metadata reads
  ├─ UI: escaped complete bounded MIT notice text, distinct from notice identity
  │    └─ unsafe empty/hostile/path/control/oversize text refuses
  ├─ review service → pure policy: closed review + RFC 8785 / SHA-256 custody
  ├─ controller: review / approve / discard only; no consumption-seam call
  └─ volatile one-shot metadata approval; no execution consumer

Provider-neutral consumption decision seam (no production caller)
  ├─ consumeApproval(exact `{ workspaceId, generation, moduleRoot }`)
  ├─ synchronously revoke authority before awaiting fresh inspection
  ├─ keep authority unavailable throughout reinspection
  ├─ fully review fresh metadata and reconcile the exact digest/current context
  ├─ identical recipe → authorize once
  └─ drift / invalid / error / concurrent / replay → refuse or remain revoked/consumed
```

Rust, not cached renderer state, owns inspection authority. A begin call revokes prior authority, binds the current workspace, performs the configuration read and convention scan, and mints one opaque handle per retained root. Trusted TypeScript evaluates the safe facts with the established recognition and configuration policies. Its acknowledgment contains only the opaque attempt receipt and selected handles. Rust requires a complete scan, known strong or configured roots, the exact complete active set, current workspace binding, and unchanged module identities before accepting authority.

Workspace refresh, workspace switch or activation start, activation failure, a newer activation generation, application exit, and cached React restoration revoke native authority. Cached recognition presentation may be restored after a failed switch, but restoration is explicitly a revocation event and cannot rebuild accepted native roots.

Inspection preserves the request shape `{ workspaceId, generation, moduleRoot }`; neither the activation receipt nor an evidence handle becomes an inspection token. The native inspector matches that request to the current accepted workspace generation and exact active root, revalidates identities, and reads only bounded contained metadata. `.scripts/build.ps1` remains an untrusted regular file: the inspector returns its fixed relative path, byte size, and lowercase SHA-256, not script bytes or a command. It also returns the complete bounded MIT X2ModBuildCommon attribution notice, unresolved prerequisites, and separate project-local Highlander source and Workshop runtime dependencies.

The controlled UI presents the notice text in an accessible **attribution notice** field, separately from **notice identity**. React renders it as escaped text and preserves bounded line breaks; it is not interpreted as markup. Empty, hostile command/script-like, machine-path-bearing, control-bearing, non-normalized, or oversized notice text fails the safe presentation check and renders only the fixed refusal.

The TypeScript review service and pure policy validate a closed candidate, take deterministic digest custody, and may retain one volatile one-shot approval for the exact reviewed metadata. Provider-neutral asynchronous `consumeApproval(request)` is only a decision seam; the production controller and UI do not call it. On a request it synchronously transitions authority to revoked before awaiting fresh exact inspection, so concurrent use has no authority. It fully reviews the fresh candidate, reconciles the original exact digest with all current metadata, and authorizes the identical recipe once. A changed script, notice text/identity, provenance, license, workspace/module context, or generation; invalid metadata; inspection error; concurrent request; or replay refuses or leaves authority revoked/consumed.

Refresh, discard, and context changes retain synchronous revocation. There is no recipe watcher or polling, so unseen filesystem mutation is detected only when the decision seam is requested and performs fresh inspection; authority stays unavailable during that wait. No production caller, executor, or build consumer exists. The UI exposes review, **Approve exact recipe**, and **Discard** only, with no Consume, Execute, Build, Deploy, Cook, or Launch control. There is no process, shell, network, workspace-write, SDK, game, Steam-prefix, `pfx_copy`, deployment, cooking, launch, or execution relationship in this component model.

The fixed activation schema remains `{ "version": 1, "target": "wotc", "moduleRoots": [...] }`. Recipe inspection neither extends `.ide/xcom2.json` nor creates a build manifest. Machine Settings and SDK transactions remain independent. The browser adapters reject native activation and recipe inspection without filesystem, process, network, storage, timer, polling, or simulated-success work.

## Global XCOM Machine Settings

The machine monitor presents the exact accessible missing-Steam state through the normal application composition, typed Tauri monitor adapter, and Rust monitor when the desktop starts from isolated empty directories. This focused native presentation boundary does not reclassify the broader machine Settings lifecycle requirement, whose evidence remains harness-only.

```text
Desktop Settings / XCOM 2
  ├─ exact accessible missing-Steam state
  │    └─ App composition → typed Tauri monitor adapter → Rust monitor
  ├─ Settings closed
  │    └─ no monitor/history/detail reads, polling, or subscriptions
  ├─ Settings open
  │    ├─ exactly one monitor adapter lifecycle
  │    ├─ exactly one transaction adapter lifecycle
  │    └─ conservative machine health/download state
  ├─ Plan Setup ──> pure export-safe dry-run planner
  │                      (separate, descriptive, non-executable)
  └─ Transactions
       ├─ history + state + operations + full 64-character digest
       ├─ exact digest-bound approval / cancel
       └─ rollback / recover
              │ typed Tauri boundary
              ▼
       Concrete Native Setup + Transaction Engine
       ├─ Prepare validates vanilla AppID 602410
       ├─ exactly 15 reversible operations
       │    ├─ 2 Day0 INI removals
       │    ├─ 1 SourceControl/GameAssetDatabase INI patch
       │    ├─ 11 exact DLC_3 TLE quarantines
       │    └─ 1 allowlisted CookedPCConsole game symlink
       ├─ exact-digest, one-transaction external SDK approval
       ├─ journal/backups: Steam build/manifest/root fingerprint,
       │    original bytes/hashes/modes/inventory/symlink absence
       └─ Restore Vanilla SDK + conflict-safe rollback + Prepare Again
```

This surface is machine scoped, while transaction authority remains correlated to the current workspace and generation. Opening Settings creates one fresh monitor snapshot/history load and one subscription/poll lifecycle for each typed adapter. Closing it first revokes request authority, then unsubscribes both adapters and clears their timers; reopening creates one new lifecycle of each. A cold start or workspace switch with Settings closed performs no XCOM monitor, history, detail, poll, or subscription work. Apply requires an external SDK write grant matching the reviewed digest exactly and scoped to one transaction. Restore returns to the captured exact vanilla baseline; conflicts never overwrite, and rollback/recovery precedes Prepare Again. Transaction rollback storage is IDE-owned local state: backups are limited to 16 MiB each, with 64 removable transactions and 256 events retained. Export payloads omit paths and content.

Protontricks, Steam shortcut, compatibility-prefix, package-manager, and interactive work remain FUTURE/TARGET and non-executable.

The browser setup adapter explicitly reports unavailable unless deliberate simulation is enabled; normal web composition starts no hidden monitor or transaction activity. The fixed contracts are not a plugin runtime and grant no arbitrary execution.

## UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY — Java

Current guarded diagnostics and conditional Problems visibility, completion, hover, signature help, synchronization, cancellation, and stale guards remain maintained as-built. There is no active Java target or milestone beyond that boundary.

```text
CURRENT (no module activation)
provider-neutral Java diagnostics
  └─ ready Java context OR retained ProblemItems
       └─ conditional project-scoped Problems tab

UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY
  ├─ definition / references and Monaco gestures
  ├─ document/workspace symbols and type/call hierarchy
  ├─ code actions, imports, formatting, and rename
  ├─ general Java refactoring
  ├─ bounded module detection / activation
  └─ contextual Problems lifecycle / Build / Tests / Logs / Java tools
```

This inventory is not target architecture, an ordered delivery plan, or an implied commitment. Its retained safety constraints require any explicitly reconsidered capability to preserve exact-model identity, serialized synchronization, cancellation, stale-result rejection, authorized paths, bounded results, safe edit previews, and untrusted-Markdown handling.

The approved capability-specific source-built-provider exception covers saved-snapshot TypeScript/JavaScript diagnostics and the separately approved semantic-navigation capability. Diagnostics accept only correlated bounded `diagnostics.v2` outcomes with exact UTF-16 ranges, authority and immutable-snapshot identity, compiler/process attestation, and structured ready/refused/error semantics. Structural outline remains a provider foundation; references and rename remain experimental provider operations. Neither those operations nor general Java refactoring beyond the managed import is authorized by this exception.

Any reconsidered search integration requires a released strict typed bounded versioned machine-readable JSON contract, or equivalent daemon DTO, with structured errors, truncation, authorized locations, request/result correlation, and immutable real acceptance evidence. Human stdout is never parsed as an IDE protocol.

## FUTURE/TARGET XCOM Activation Extensions and Contributions

Current project-owned configuration and convention recognition are foundations, not promises of broader project tooling.

```text
CURRENT activation authority and metadata review
  ├─ project-owned `.ide/xcom2.json` v1, read-only
  ├─ independent Option A convention recognition
  ├─ native opaque evidence + accepted-root authority
  └─ accessible XCOM 2 Project activity
       └─ Default Build recipe metadata review; no execution consumer

FUTURE/TARGET, separately designed and authorized
  ├─ manual confirmation and its persistence
  ├─ external-root grants
  └─ operational Build / Deploy / Cook / Launch / Problems / Logs / language tools
```

Future confirmation or external-root activation must not weaken current workspace/configuration/scan correlation, project-contained path authority, deterministic evidence, or synchronous revocation. Machine setup remains independent in Settings and cannot satisfy project activation or future tool authorization.

## Stable Delivery Boundary

Concrete WOTC SDK setup is CURRENT/AS-BUILT with a fixed 15-operation plan, exact external approval, durable baseline capture, and conflict-safe restore. Optional Steam/prefix/package/interactive provisioning remains FUTURE/TARGET and must not enter current Prepare or Apply without a separate design and authorization.

XCOM configured and convention activation uses native-issued evidence handles, trusted TypeScript evaluation, and Rust-owned accepted-root authority. The matching activity can host metadata-only Default Build recipe review, escaped complete notice presentation, exact approval, and discard, but it exposes neither the async consumption decision seam nor any execution consumer or project action. Manual confirmation, external roots, operational Build/Deploy/Cook/Launch, and the activation-scoped Problems/Logs/language suite remain outside this boundary. No generic plugin runtime is claimed.

Java activation, contextual tooling, definition/references, symbols/hierarchy, code actions, formatting, rename, general refactoring, and broader JDT LS expansion are instead frozen unscheduled inventory. The current guarded Java Problems tab is not activation, and no Java project detection or activation is claimed.
