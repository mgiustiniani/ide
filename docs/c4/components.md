# Component Diagrams (C3) — Current and Target Boundaries

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only with locally bundled Java syntax highlighting. Guarded Java semantics cross provider-neutral components without Java module activation. **Paste Java Class from Clipboard** and saved-snapshot TypeScript/JavaScript diagnostics remain separate managed RefactorKit flows. Desktop XCOM 2 project activation combines read-only project configuration and convention recognition. Workspace Settings owns its atomic diagnostic presentation; machine Settings stays separate, and neither diagnostics nor recognition grants project tools. Focused native evidence covers the exact accessible missing-Steam state through the real App/Tauri/Rust monitor path from isolated empty directories; the broader machine Settings lifecycle evidence remains harness-only.

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

Cold start first establishes the native-authorized root, then promotes that authorization evidence into registry state. Only after that gate does the Workspace Controller publish the current generation to collaborators, restore editor state, load the file tree, attach/load Java, activate workspace-keyed AI state and commands, and discover RefactorKit status/capabilities. For XCOM it keeps old activation revoked until authorization succeeds, then jointly starts the correlated configuration read and convention scan. Explicit full **Workspace Refresh** follows the same synchronous-revoke boundary without changing native workspace authorization: it clears the prior diagnostic and configured authority, exposes neutral checking, and accepts only the exact current joint result. While Settings is closed, its machine-runtime collaborator calls return without monitor snapshots or refreshes, transaction history or detail reads, polling, or subscriptions. Opening Settings creates exactly one monitor-adapter lifecycle and one transaction-adapter lifecycle; closing Settings invalidates their requests, unsubscribes both, and clears their poll timers. Passive Settings open refresh remains distinct from the explicit full Workspace Refresh control. A workspace switch restarts machine lifecycles only when Settings remains open. Workspace transitions also invalidate the composed RefactorKit diagnostic and Symbol Navigation support; lifecycle wiring does not expand either capability's approved scope. Global AI configuration and workspace-independent terminal setup are not represented as workspace-authorized reads.

| Current C3 component                      | Stable structural responsibility                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace Controller**                  | Owns registry metadata, authorized active-root transitions, loading/switching state, and the shared generation boundary. It coordinates recognition revocation/start and setup correlation; XCOM feature controllers own behavior and adapter lifetimes.    |
| **Desktop Editor Controller**             | Coordinates guarded open/create, tab lifecycle, deferred session restore, workspace reset, and safe presentation state. Only a tab with its matching loaded buffer becomes a ready active document.                                                         |
| **Java Language Controller**              | Owns workspace-scoped language lifecycle, versioned Java document sync, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, guarded semantics, cancellation, and stale identity checks through provider-neutral ports. |
| **RefactorKit Import Controller**         | Owns the separate capability-gated clipboard import transaction: selection/workspace freshness, preview, exact displayed-plan approval, invalidation/discard, result refresh, and backend-authoritative result opening.                                     |
| **RefactorKit Status Controller**         | Performs provider-neutral, diagnostic-only status and capability discovery. Independent outcomes are normalized and stale generations are dropped; this component has no preview, apply, rollback, or mutation authority.                                   |
| **RefactorKit Symbol Navigation Support** | Composed TypeScript/JavaScript saved-snapshot search/definition support and workspace cleanup within its separately approved source-built-provider boundary.                                                                                                 |
| **AI Agent Controller**                   | Owns configuration/status plus workspace-keyed commands, session messages, activities, prompt state, and stale-request suppression. Only an explicit trimmed panel prompt crosses its port.                                                                 |
| **XCOM Project Activation Controller**    | Jointly owns one-shot configuration and convention reads, synchronous decision/diagnostic revocation, neutral checking, exact current configuration/scan correlation, explicit full-refresh orchestration, and stale-result suppression.                    |
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

## Workspace-scoped XCOM 2 Project Activation and Diagnostic

```text
Workspace Controller
  ├─ begin switch or explicit full Workspace Refresh
  │       └─ XCOM Project Activation Controller synchronously clears
  │          prior diagnostic, configured authority, and activity decisions
  └─ authorize or retain the current workspace generation
                       │ neutral checking; no watcher or polling
          ┌────────────┴────────────┐
          ▼                         ▼
XCOM Configuration          XCOM Module Scanner
Tauri Adapter               Tauri Adapter
          │ strict invoke           │ strict invoke
          ▼                         ▼
Native Configuration        Native Evidence Scanner
Reader                      └─ bounded exact-name metadata
  ├─ fixed `.ide/xcom2.json`
  ├─ exact `{version: 1, target: "wotc", moduleRoots: [...]}` schema
  ├─ existing exact-case, regular non-symlink roots inside workspace
  └─ no XCOM configuration or Option A input writes
          │                         │
          └────────────┬────────────┘
                       ▼ exact current joint correlation only
Pure Project Activation Evaluator
  ├─ valid configuration → configured / explicit authority
  ├─ invalid configuration → no configured authority
  └─ strong independent Option A recognition can remain active
          │                         │
          │ safe code               │ active decisions only
          ▼                         ▼
Pure Configuration          Accessible `XCOM 2 Project` activity
Diagnostic Mapper           └─ recognition only; no project authority
  └─ exactly eight codes              │
     → fixed complete copy             └─ mirrors the same complete warning
          │                                only when recognition survives
          ▼
Shared Atomic Warning
  └─ one role=alert under Settings > Workspace > Current workspace
     title + project file label + summary + remediation + support identifier
     no edit, open, write, process, tool, action, external-root, or mutation authority
```

The configuration path and workspace authority are native-owned; callers cannot select either. The project owner owns the file. V1 accepts only the three exact fields, a non-empty bounded list of unique normalized workspace-relative roots, target `wotc`, and version `1`. `.` is allowed; absolute, drive, URI, backslash, empty, dot-segment, parent-segment, control-bearing, missing, non-directory, case-mismatched, symlinked, and escaping roots fail atomically.

The strict adapter exposes exactly these typed codes: `configuration-unreadable`, `configuration-too-large`, `configuration-invalid-utf8`, `configuration-invalid-json`, `configuration-invalid-schema`, `configuration-unsupported-version`, `configuration-unsupported-target`, and `configuration-invalid-module-roots`. The pure mapper exhaustively selects fixed, non-interpolated title, `.ide/xcom2.json` label, summary, remediation, and matching support identifier copy. No configuration bytes, submitted module roots, absolute paths, parser/provider/native-command details, secrets, or raw causes enter the warning.

The shared React warning is one `aria-atomic` accessible alert. It appears under **Settings > Workspace > Current workspace** after checking settles. The diagnostic itself creates no **XCOM 2 Project** activity. When invalid configuration removes configured authority but strong independent Option A recognition preserves an activity, the recognition panel reuses the shared component and mirrors the complete warning rather than a raw code.

The dedicated convention scanner remains separate from the FileTree path. It accepts exact regular, non-symlink convention entries and never treats names containing `xcom` as evidence. The pure recognition evaluator counts distinct evidence kinds per inferred module root. The project evaluator combines that immutable recognition snapshot with configuration without converting diagnostic presentation into activation or tool authority.

The controller accepts a candidate only while workspace identity, workspace generation, activation generation, configuration-read identity, scan identity, and scan generation all match current authority. Workspace switches and explicit full **Workspace Refresh** clear prior diagnostics and decisions synchronously before native work, then expose neutral checking. External edits remain invisible until full refresh; there is no configuration or evidence watcher, polling, or Git synchronization. Late or stale results restore nothing.

The native XCOM reader and scanner never create, write, reformat, or delete `.ide/xcom2.json` or Option A evidence, and never add those inputs to `.gitignore`. Normal application-owned `.ide/workspace.json` marker and registry metadata updates belong to the separate Workspace Command responsibility and are outside this XCOM project-input no-write scope.

Machine evidence, monitor polling, and transactions remain independently XCOM-machine-Settings-owned and are not recognition, configuration, or diagnostic evidence. The diagnostic grants no activity, Build, Problems, Logs, language support, action, process execution, external-root, write, mutation, tool, or bottom-contribution authority. Manual confirmation, external-root grants, content parsing, and contextual tooling remain outside this slice.

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
CURRENT recognition-only activation
  ├─ project-owned `.ide/xcom2.json` v1, read-only
  ├─ independent Option A convention recognition
  └─ accessible XCOM 2 Project activity

FUTURE/TARGET, separately designed and authorized
  ├─ manual confirmation and its persistence
  ├─ external-root grants
  └─ contextual Problems / Build / Tests / Logs / language / XCOM tools
```

Future confirmation or external-root activation must not weaken current workspace/configuration/scan correlation, project-contained path authority, deterministic evidence, or synchronous revocation. Machine setup remains independent in Settings and cannot satisfy project activation or future tool authorization.

## Stable Delivery Boundary

Concrete WOTC SDK setup is CURRENT/AS-BUILT with a fixed 15-operation plan, exact external approval, durable baseline capture, and conflict-safe restore. Optional Steam/prefix/package/interactive provisioning remains FUTURE/TARGET and must not enter current Prepare or Apply without a separate design and authorization.

XCOM configured and convention activation is CURRENT/AS-BUILT through the fixed read-only configuration reader, dedicated scanner, strict adapters, pure evaluators, jointly correlated controller, and accessible activity. Activation contributes no bottom tool or project action. Manual confirmation, external roots, and the activation-scoped Build/Problems/Logs/language suite remain FUTURE/TARGET under the separate XCOM boundary. No generic plugin runtime is claimed.

Java activation, contextual tooling, definition/references, symbols/hierarchy, code actions, formatting, rename, general refactoring, and broader JDT LS expansion are instead frozen unscheduled inventory. The current guarded Java Problems tab is not activation, and no Java project detection or activation is claimed.
