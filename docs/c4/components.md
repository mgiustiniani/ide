# Component Diagrams (C3) — Current and Target Boundaries

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only with locally bundled Java syntax highlighting. Guarded JDT LS diagnostics, a conditional project-scoped Problems contribution, completion, hover, signature help, document synchronization, and cancellation are operational through provider-neutral components. This does not imply Java module activation. **Paste Java Class from Clipboard** remains a separate managed RefactorKit flow.

## Desktop Composition and Controller Boundaries

`App.tsx` is now a composition-only root. It creates stores, view models, and typed adapters; wires seven application controllers and six extracted shell/document/editor controllers; derives presentation props; and renders the shell. Feature orchestration remains inside the controllers below rather than in `App.tsx`.

The **Workspace Controller** owns the authorized active-root transition and coordinates workspace-scoped collaborators; it does not absorb their bounded-context responsibilities.

```text
Workspace Port ──ensure authorized current root──> Workspace Controller
                                                     │
                                                     ├─> Desktop Editor Controller
                                                     ├─> Java Language Controller
                                                     ├─> RefactorKit Import Controller
                                                     ├─> RefactorKit Status Controller
                                                     ├─> AI Agent Controller
                                                     └─> XCOM Setup Controller

WorkspaceGeneration: positive and monotonically increasing for runtime
workspace-switch attempts; shared by collaborators to reject stale work.
Exhaustion fails closed rather than reusing an old generation.
```

Cold start first establishes the native-authorized root, then promotes that authorization evidence into registry state. Only after that gate does the Workspace Controller publish the current generation to collaborators, restore editor state, load the file tree, attach/load Java, activate workspace-keyed AI state and commands, discover RefactorKit status/capabilities, and load XCOM monitor/transaction state. Global AI configuration and workspace-independent terminal setup are not represented as workspace-authorized reads.

| Current C3 component              | Stable structural responsibility                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace Controller**          | Owns registry metadata, authorized active-root state, loading/switching state, and the shared generation boundary. It invalidates or resets collaborators before a switch and suppresses stale cold-start or switch completion.                             |
| **Desktop Editor Controller**     | Coordinates guarded open/create, tab lifecycle, deferred session restore, workspace reset, and safe presentation state. Only a tab with its matching loaded buffer becomes a ready active document.                                                         |
| **Java Language Controller**      | Owns workspace-scoped language lifecycle, versioned Java document sync, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, guarded semantics, cancellation, and stale identity checks through provider-neutral ports. |
| **RefactorKit Import Controller** | Owns the separate capability-gated clipboard import transaction: selection/workspace freshness, preview, exact displayed-plan approval, invalidation/discard, result refresh, and backend-authoritative result opening.                                     |
| **RefactorKit Status Controller** | Performs provider-neutral, diagnostic-only status and capability discovery. Independent outcomes are normalized and stale generations are dropped; this component has no preview, apply, rollback, or mutation authority.                                   |
| **AI Agent Controller**           | Owns configuration/status plus workspace-keyed commands, session messages, activities, prompt state, and stale-request suppression. Only an explicit trimmed panel prompt crosses its port.                                                                 |
| **XCOM Setup Controller**         | Owns workspace-scoped read-only monitoring, pure dry-run planning, transaction state/actions, authoritative re-read after events, and workspace activation failure settlement/restoration.                                                                  |

The six additional extracted controllers keep shell, document, and editor coordination out of the composition root:

| Current extracted C3 component     | Stable structural responsibility                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings Controller**            | Owns Settings visibility and coordinates refresh requests to independently owned AI, workspace, Java, RefactorKit, and XCOM controllers without absorbing their state. |
| **Terminal Controller**            | Owns workspace-independent terminal connection/session lifecycle, command and input coordination, output clearing, and workspace-reset presentation cleanup.           |
| **File Explorer Controller**       | Coordinates folder expansion and empty-editor file creation through the file-tree and Desktop Editor boundaries.                                                       |
| **Document Navigation Controller** | Owns document-preview visibility and diagnostic navigation; it opens the target through the Desktop Editor Controller before issuing a reveal request.                 |
| **Editor Command Controller**      | Coordinates buffer changes, save, activation, and close ordering across editor persistence and Java document synchronization.                                          |
| **Desktop Shell Controller**       | Owns panel layout commands, active bottom-tab state, AI command loading on activation, and guarded Problems visibility/severity policy.                                |

The Workspace Controller coordinates lifecycle ordering; normal feature interactions remain direct at the most specific C3 boundary. In particular, editor readiness feeds the Java Language Controller, the RefactorKit Import Controller opens only a backend-reported result through the Desktop Editor Controller, and the extracted command/navigation controllers reuse those boundaries rather than bypassing them.

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
  2. require the complete RefactorKit java.importExternalClass
     targetDirectory preview/apply/discard/rollback capability set
     └─ incompatible provider contract → unavailable before clipboard read; no force
  3. explicitly read clipboard once
  4. request rich targetDirectory preview and display normalized plan evidence
  5. guard workspace + selection generation and exact approved planId
  6. apply that exact planId through RefactorKit; display returned transaction
  7. refresh tree/open primary file only from backend result paths
  8. invoke refactor.discard on cancel or selection/workspace invalidation
  9. rollback by opaque transaction ID when requested
```

The UI does not copy raw Java, infer a target package, construct a patch, or write files. Clipboard source is transient, routed only to RefactorKit preview, never logged, and has no Pi/AI Agent relationship.

The Rust bridge launches one `bin/refactorkit-daemon` NDJSON process for the canonical workspace and current workspace generation. Its thin Tauri facade delegates to separate application, capability-policy, contract, path-policy, and transport modules. Compatibility is provider-version-neutral: the provider version is diagnostic metadata, while the advertised API, required method capabilities, normalized language-kernel schema, and safety metadata govern compatibility. Malformed output, timeout, workspace switch, or app exit kills the process.

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

The facades only expose inbound commands and re-export bounded types. Process ownership, use-case orchestration, policy, normalization, path authorization, and transport stay in the modules behind them. These are CURRENT/AS-BUILT boundaries; they do not promote any remaining Java navigation, mutation, hierarchy, or module-activation work from FUTURE/TARGET.

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

Provider-neutral lifecycle, document-sync, diagnostic, semantic, and cancellation contracts; the Tauri adapters; guarded Monaco providers; the current conditional Problems projection; and the managed Rust JDT LS bridge are current. Fixed RefactorKit handlers remain separate. There is no Java project/module evidence evaluator, activation state, or full activation-scoped Java tooling suite.

## Global XCOM Machine Settings

```text
Desktop Settings / XCOM 2
  ├─ conservative machine health/download state
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

This surface is machine scoped. Apply requires an external SDK write grant matching the reviewed digest exactly and scoped to one transaction. Restore returns to the captured exact vanilla baseline; conflicts never overwrite, and rollback/recovery precedes Prepare Again. Transaction rollback storage is IDE-owned local state: backups are limited to 16 MiB each, with 64 removable transactions and 256 events retained. Export payloads omit paths and content.

Protontricks, Steam shortcut, compatibility-prefix, package-manager, and interactive work remain FUTURE/TARGET and non-executable.

The browser setup adapter explicitly reports unavailable unless deliberate simulation is enabled; normal web composition starts no hidden monitor or transaction activity. The fixed contracts are not a plugin runtime and grant no arbitrary execution.

## FUTURE/TARGET Remaining Java Intelligence and Contributions

Current guarded diagnostic projection and conditional Problems visibility, completion, hover, signature help, sync, and cancellation are the foundation. The next slices are definition/references and Monaco gestures, followed by code actions, formatting, rename, and hierarchy. They must preserve the existing exact-model guard, serialized synchronization, cancellation, stale-result, safe-edit, and untrusted-Markdown policies.

```text
CURRENT (no module activation)
provider-neutral Java diagnostics
  └─ ready Java context OR retained ProblemItems
       └─ conditional project-scoped Problems tab

FUTURE/TARGET
Explicit Java configuration ─┐
Credible Java module evidence ├─> Java Module Activation Evaluator
                             │      └─ state + confidence + reasons + module roots
                             │
activated module only ───────┴─> Contextual Java Contribution Coordinator
                                    ├─ activation-scoped Problems lifecycle
                                    ├─ Build / Tests / Logs
                                    └─ Java tools
                                         ├─ definition/references + Monaco gestures
                                         ├─ code actions + formatting + rename
                                         └─ hierarchy and later contextual workflows
```

Detection must be bounded and evidence based (for example, credible source roots and reviewed Maven/Gradle/module descriptors), reject false positives, and remove contributions on deactivation. This architecture is future only. Global Java Settings remains lifecycle/status/availability and must not become the project-action surface.

## FUTURE/TARGET XCOM Activation and Contributions

```text
Explicit XCOM configuration ─┐
Credible XCOM module evidence ├─> XCOM Module Activation Evaluator
Workspace name contains xcom ┘      (explicitly ignored as evidence)

activated module only ──> contextual Problems / Build / Tests / Logs / XCOM tools
```

Candidate evidence may include `*.x2proj`, `*.XComMod`, `.scripts/build.ps1` with `X2ModBuildCommon`, `Config/XComEngine.ini`, and credible `Src/<package>/Classes/*.uc` layouts. Activation returns confidence, reasons, and matched roots; ambiguous evidence does not silently activate. Machine setup remains independent in Settings.

## Stable Delivery Boundary

Concrete WOTC SDK setup is CURRENT/AS-BUILT with a fixed 15-operation plan, exact external approval, durable baseline capture, and conflict-safe restore. Optional Steam/prefix/package/interactive provisioning remains FUTURE/TARGET and must not enter current Prepare or Apply without a separate design and authorization.

Project activation and the full activation-scoped tooling suite remain FUTURE/TARGET. Their architecture requires bounded evidence-based detection, activation/deactivation, module-scoped contribution lifetime, generic-workspace behavior, and honest web degradation. The current guarded Java Problems tab is not such activation. Definition/references and Monaco gestures, code actions, formatting, rename, and hierarchy also remain FUTURE/TARGET. No current plugin runtime, Java/XCOM project detection, or project activation is claimed.
