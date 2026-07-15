# Component Diagrams (C3) — Current and Target Boundaries

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only with locally bundled Java syntax highlighting. Guarded JDT LS diagnostics, a conditional project-scoped Problems contribution, completion, hover, signature help, document synchronization, and cancellation cross provider-neutral components. This does not imply Java module activation. **Paste Java Class from Clipboard** remains a separate managed RefactorKit flow. This structural view does not establish native-GUI, live-provider, or packaged-application execution evidence.

## Desktop Composition and Controller Boundaries

`App.tsx` is a composition-only root. It creates stores, view models, and typed adapters; wires seven current capability controllers and six extracted shell/document/editor controllers; composes RefactorKit Symbol Navigation support behind its parked, non-capability boundary; derives presentation props; and renders the shell. Feature orchestration remains inside the controllers rather than in `App.tsx`.

The **Workspace Controller** owns the authorized active-root transition and coordinates workspace-scoped collaborators; it does not absorb their bounded-context responsibilities.

```text
Workspace Port ──ensure authorized current root──> Workspace Controller
                                                     │
                                                     ├─> Desktop Editor Controller
                                                     ├─> Java Language Controller
                                                     ├─> RefactorKit Import Controller
                                                     ├─> RefactorKit Status Controller
                                                     ├─> RefactorKit Symbol Navigation Support
                                                     ├─> AI Agent Controller
                                                     └─> XCOM Setup Controller

WorkspaceGeneration: positive and monotonically increasing for runtime
workspace-switch attempts; shared by collaborators to reject stale work.
Exhaustion fails closed rather than reusing an old generation.
```

Cold start first establishes the native-authorized root, then promotes that authorization evidence into registry state. Only after that gate does the Workspace Controller publish the current generation to collaborators, restore editor state, load the file tree, attach/load Java, activate workspace-keyed AI state and commands, discover RefactorKit status/capabilities, and load XCOM monitor/transaction state. Workspace transitions also invalidate the composed RefactorKit Symbol Navigation support; this lifecycle wiring does not promote it to a capability. Global AI configuration and workspace-independent terminal setup are not represented as workspace-authorized reads.

| Current C3 component                      | Stable structural responsibility                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace Controller**                  | Owns registry metadata, authorized active-root state, loading/switching state, and the shared generation boundary. It invalidates or resets collaborators before a switch and suppresses stale cold-start or switch completion.                             |
| **Desktop Editor Controller**             | Coordinates guarded open/create, tab lifecycle, deferred session restore, workspace reset, and safe presentation state. Only a tab with its matching loaded buffer becomes a ready active document.                                                         |
| **Java Language Controller**              | Owns workspace-scoped language lifecycle, versioned Java document sync, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, guarded semantics, cancellation, and stale identity checks through provider-neutral ports. |
| **RefactorKit Import Controller**         | Owns the separate capability-gated clipboard import transaction: selection/workspace freshness, preview, exact displayed-plan approval, invalidation/discard, result refresh, and backend-authoritative result opening.                                     |
| **RefactorKit Status Controller**         | Performs provider-neutral, diagnostic-only status and capability discovery. Independent outcomes are normalized and stale generations are dropped; this component has no preview, apply, rollback, or mutation authority.                                   |
| **RefactorKit Symbol Navigation Support** | Composed TypeScript/JavaScript saved-snapshot search/definition support and workspace cleanup. It remains parked because read-only provider lifecycle can write hidden workspace metadata; it is not a current IDE capability.                              |
| **AI Agent Controller**                   | Owns configuration/status plus workspace-keyed commands, session messages, activities, prompt state, and stale-request suppression. Only an explicit trimmed panel prompt crosses its port.                                                                 |
| **XCOM Setup Controller**                 | Owns workspace-scoped read-only monitoring, pure dry-run planning, transaction state/actions, authoritative re-read after events, and workspace activation failure settlement/restoration.                                                                  |

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

The facades only expose inbound commands and re-export bounded types. Process ownership, use-case orchestration, policy, normalization, path authorization, and transport stay in the modules behind them. Current RefactorKit IDE scope is status/capability discovery plus the managed Java import transaction. Production desktop composition wires Symbol Navigation support and its workspace cleanup, but policy keeps it parked and outside current IDE capability. These boundaries do not promote provider foundations or frozen Java navigation, mutation, hierarchy, and activation ideas into IDE capabilities.

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

Provider-neutral lifecycle, document-sync, diagnostic, semantic, and cancellation contracts; the Tauri adapters; guarded Monaco providers; the current conditional Problems projection; and the managed Rust JDT LS bridge are current. RefactorKit is current only for status/capability discovery and the separate managed Java import transaction. Legacy/support handlers and provider foundations are not current IDE capabilities. There is no Java project/module evidence evaluator, activation state, or full activation-scoped Java tooling suite.

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

Parked TypeScript diagnostics and semantic navigation are not active: diagnostics lose required range, authority, snapshot, attestation, and structured outcome semantics; provider `project.open` may create `.refactorkit/workspace.lock` despite its read-only contract. No metadata-write exception is authorized for that navigation flow. Structural outline and identifier search remain provider foundations, while TypeScript references and rename remain experimental provider operations. None is a current IDE capability, and general Java refactoring beyond the managed import remains TODO.

Any reconsidered search integration requires a released strict typed bounded versioned machine-readable JSON contract, or equivalent daemon DTO, with structured errors, truncation, authorized locations, request/result correlation, and immutable real acceptance evidence. Human stdout is never parsed as an IDE protocol.

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

XCOM project activation and its activation-scoped tooling suite remain FUTURE/TARGET under the separate XCOM boundary. No current plugin runtime, XCOM project detection, or XCOM project activation is claimed.

Java activation, contextual tooling, definition/references, symbols/hierarchy, code actions, formatting, rename, general refactoring, and broader JDT LS expansion are instead frozen unscheduled inventory. The current guarded Java Problems tab is not activation, and no Java project detection or activation is claimed.
