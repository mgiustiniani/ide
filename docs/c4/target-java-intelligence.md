# Current Java Diagnostics and IntelliSense with Frozen Unscheduled Inventory

> **CURRENT/AS-BUILT + FROZEN INVENTORY.** Monaco-only editing, locally bundled Java syntax highlighting, JDT LS document synchronization, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, the guarded conditional project-scoped Problems contribution, completion, hover, signature help, cancellation, and stale-result guards are **CURRENT/AS-BUILT**. Everything under **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY** is neither target architecture nor an implied commitment. The filename is retained for stable incoming links.

The managed RefactorKit Java clipboard-import transaction is current but architecturally separate. No Java module activation is implied by the current Problems visibility guard.

## Current Delivery Boundary

| Responsibility                  | Scope                                       | CURRENT/AS-BUILT boundary                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco editor and Java syntax   | Web and desktop editor                      | Monaco is the only editor. A locally bundled Java Monarch/basic contribution supplies syntax highlighting without network language assets or a native fallback.                                                                                                            |
| Tool availability and lifecycle | Desktop Settings                            | JDK/JDT LS discovery and lifecycle/status plus RefactorKit availability, version, path, and capability discovery. Settings exposes no project search, navigation, refactoring, or activation action.                                                                       |
| Java document synchronization   | Exact desktop Java model                    | Versioned full-text `didOpen`/`didChange`/`didSave`/`didClose` through `DocumentSyncPort`, a typed Tauri adapter, and Rust/LSP transport.                                                                                                                                  |
| Java diagnostics and Problems   | Authorized workspace and ready Java context | The Java controller owns provider-neutral diagnostic events, active-editor diagnostics, and `ProblemItem` projection. The Desktop Shell Controller contributes project-scoped Problems while a ready Java context or projected items exist. This is not module activation. |
| Interactive semantics           | Exact synchronized Java model               | Completion, hover, signature help, and cancellation through provider-neutral contracts and guarded Monaco providers.                                                                                                                                                       |
| RefactorKit IDE capability      | Desktop Settings and directory-tree import  | Current only for status/capability discovery and the separately validated Java external-class import transaction. Provider foundations, support code, and advertised operations are not automatically IDE capabilities.                                                    |

The desktop BottomPanel contains core Terminal and AI Agent plus the conditional project-scoped Problems contribution; web contains only Terminal. Java diagnostics and semantics are not a global Java technology tab or a Settings project-action surface.

## Current C3 Flow

```text
Monaco-only Editor
  ├─ local Java Monarch/basic contribution
  └─ exact synchronized Java model
       │ edit: optimistic version increment
       │       → serialized full-text didChange flush
       │       → completion / hover / signature-help request
       ▼
Java Language Controller
  ├─ diagnostic events
  │    ├─ authorized active-editor diagnostics
  │    └─ ProblemItem[] projection → conditional Problems contribution
  ├─ workspace + session generation + path + URI + version guards
  ├─ request ID + cancellation ID correlation
  └─ stale/late response suppression
       │ provider-neutral contracts
       ▼
Tauri Language/Document + Java Intelligence Adapters
       │ typed invoke; malformed or mismatched payloads fail closed
       ▼
Rust Java Language Tauri Facade
       ▼
Java Language Application Service
  ├─ contract + path policy
  ├─ didOpen / didChange / didSave / didClose
  ├─ completion / hover / signatureHelp / $/cancelRequest
  ├─ fixed-argv JDK/JDT LS discovery and launch
  └─ fail-closed synchronization support
       │ LSP over stdio
       ▼
Eclipse JDT LS
```

Monaco provider registries are global, so every callback rechecks the exact model and current workspace, session, path, URI, and version. Disposal and context changes cancel pending work. Semantic requests cannot overtake an in-flight `didChange` flush.

Completion maps only the primary edit. Additional edits, cross-document/workspace edits, and commands are suppressed. Hover, signature, and completion documentation is untrusted Markdown with HTML disabled.

## Current RefactorKit Boundary

Directory-tree **Paste Java Class from Clipboard** remains independent from JDT LS semantics:

1. validate the selected directory and workspace/selection generation;
2. discover capabilities and require the advertised API plus the exact import/apply/discard/rollback method features before clipboard access;
3. read the clipboard once for the explicit tree action;
4. preview without writing and display normalized evidence;
5. apply only the exact approved `planId`;
6. discard cancelled or invalidated work and support rollback by transaction ID; and
7. refresh/open only backend-reported authorized paths.

Provider version is diagnostic only. Normalized language-kernel, runtime-limit, and safety metadata are retained evidence, not blanket authorization; the top-level safety booleans do not all gate the current import transaction. Missing or incomplete required import methods fail closed before clipboard read. RefactorKit remains the sole writer for this workflow. Clipboard source is transient, never logged, and has no Pi path.

The current IDE RefactorKit capability bucket is deliberately limited to:

- provider status and capability discovery; and
- the validated Java external-class import transaction above.

Fixed, legacy, support, or provider-side scan/query/navigation code does not make search, diagnostics, symbols, navigation, references, rename, or general refactoring a current IDE capability.

## 2026-07-14 Roadmap Freeze

There is no active Java target or milestone beyond maintenance of the current delivery boundary. The freeze preserves:

- lifecycle and versioned document synchronization;
- diagnostics, active-editor projection, conditional Problems, and navigation from current diagnostic items;
- completion, hover, signature help, and cancellation;
- optimistic versions and serialized flush-before-request ordering; and
- workspace/session/path/URI/version/request/cancellation correlation and stale-result rejection.

The following are **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY**, not target architecture or an implied commitment:

- definition and references, including Monaco gestures;
- document/workspace symbols, structural outline, identifier search, and type/call hierarchy;
- code actions, imports, formatting, rename, and general Java refactoring;
- Java project/module detection and activation;
- activation-scoped Problems lifecycle, Build, Tests, Logs, Java tools, and contribution lifetime;
- contextual build-tool, framework, remote-provider, or other Java adapters; and
- broader JDT LS IntelliSense expansion.

No order, phase, delivery date, or resumption promise is attached to this inventory.

## Parked RefactorKit Requirements

Two TypeScript/JavaScript RefactorKit slices are explicitly parked and are not active C4 capabilities:

- **Compiler diagnostics:** the provider protocol does not preserve the required exact bounded UTF-16 ranges, structured readiness/refusal/failure outcomes, compiler attestation, saved/unsaved snapshot semantics, authority correlation, or compatible runtime/response bounds. The IDE does not fabricate approximate markers or add a saved-disk fallback.
- **Semantic navigation:** immutable real-provider validation observed an unauthorized `.refactorkit/workspace.lock` write during `project.open` despite advertised `writesWorkspace:false`. Deterministic fixture evidence does not promote the capability while the real no-write contract fails.

Support code, deterministic fixtures, or successful substeps do not override these parked outcomes. Resumption requires a corrected released provider contract, separately applicable immutable real acceptance evidence, and explicit product reconsideration.

## Provider Foundations Are Not IDE Capabilities

In the audited RefactorKit release, structural outline and identifier search are provider foundations. TypeScript references are experimental, and TypeScript rename is experimental proposal-only. General Java refactoring beyond the validated import transaction is not integrated. None of these facts creates a current IDE action, contextual contribution, or roadmap commitment.

Announced search operations with optional JSON output remain provider/IDE TODO. Human-oriented stdout must never be parsed as an IDE protocol.

Any reconsidered search or navigation integration requires a released contract that is strict, typed, bounded, versioned, and machine-readable JSON, or an equivalent daemon DTO. It must include:

- structured success, refusal, readiness, and error outcomes;
- explicit truncation and result bounds;
- authorized workspace-relative locations;
- request/result workspace, generation, snapshot, and operation correlation;
- declared stability and capability metadata; and
- immutable real-provider acceptance evidence for the exact integrated operation.

Provider advertisement, support code, or human-readable output alone is insufficient.

## Frozen Historical Design Inventory

The following design is retained only because it records useful safety constraints. It is not an active C4 target.

```text
UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY

Explicit Java configuration ─┐
Credible bounded evidence ────┴─> possible activation decision
                                  ├─ state / confidence / reasons
                                  └─ authorized module roots

possible contextual coordinator
  ├─ contribution lifetime tied to those roots
  ├─ bounded provider-labeled navigation/results
  └─ explicit preview and approval for any mutation
```

If any inventory item is explicitly reconsidered, it must preserve the current exact-model guard, serialized synchronization, cancellation, stale-result policy, path authorization, untrusted-Markdown handling, and honest browser degradation. Navigation requires bounded authorized results and provenance. Mutation requires explicit previews, multi-file authorization, version/hash checks, confirmation, cancellation, and recovery. These are safety constraints on reconsideration, not delivery criteria or a schedule.
