# Current Java Diagnostics and IntelliSense with Frozen Unscheduled Inventory

> **CURRENT/AS-BUILT + FROZEN INVENTORY.** Monaco-only editing, locally bundled Java syntax highlighting, JDT LS document synchronization, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, the guarded conditional project-scoped Problems contribution, completion, hover, signature help, cancellation, and stale-result guards are **CURRENT/AS-BUILT**. Everything under **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY** is neither target architecture nor an implied commitment. This structural view does not establish native-GUI, live-provider, or packaged-application execution evidence. The filename is retained for stable incoming links.

The managed RefactorKit Java clipboard-import transaction and saved-snapshot TypeScript/JavaScript diagnostics are current but architecturally separate from JDT LS semantics. No Java module activation is implied by either RefactorKit capability or the current Problems visibility guard.

## Current Delivery Boundary

| Responsibility                  | Scope                                                           | CURRENT/AS-BUILT boundary                                                                                                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco editor and Java syntax   | Web and desktop editor                                          | Monaco is the only editor. A locally bundled Java Monarch/basic contribution supplies syntax highlighting without network language assets or a native fallback.                                                                                                            |
| Tool availability and lifecycle | Desktop Settings                                                | JDK/JDT LS discovery and lifecycle/status plus RefactorKit availability, version, path, and capability discovery. Settings exposes no project search, navigation, refactoring, or activation action.                                                                       |
| Java document synchronization   | Exact desktop Java model                                        | Versioned full-text `didOpen`/`didChange`/`didSave`/`didClose` through `DocumentSyncPort`, a typed Tauri adapter, and Rust/LSP transport.                                                                                                                                  |
| Java diagnostics and Problems   | Authorized workspace and ready Java context                     | The Java controller owns provider-neutral diagnostic events, active-editor diagnostics, and `ProblemItem` projection. The Desktop Shell Controller contributes project-scoped Problems while a ready Java context or projected items exist. This is not module activation. |
| Interactive semantics           | Exact synchronized Java model                                   | Completion, hover, signature help, and cancellation through provider-neutral contracts and guarded Monaco providers.                                                                                                                                                       |
| RefactorKit IDE capabilities    | Desktop Settings, editor diagnostics, and directory-tree import | Status/capability discovery, the managed Java external-class import transaction, and provider-backed saved-snapshot TypeScript/JavaScript diagnostics. Source-built provider authority is capability-specific.                                                             |

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
4. preview without imported-target or other project-content writes and display normalized evidence;
5. require per-plan acknowledgement for unknown/high-risk license or provenance;
6. apply only the exact approved `planId`;
7. discard cancelled or invalidated work; and
8. refresh/open only backend-reported authorized paths.

Provider version is diagnostic only. Normalized language-kernel, runtime-limit, and safety metadata are retained evidence, not blanket authorization; the top-level safety booleans do not all gate the current import transaction. Missing or incomplete required import methods fail closed before clipboard read. RefactorKit remains the sole imported-project-content writer. Provider `project.open` may create `.refactorkit/workspace.lock`, so preview/no-write is not a complete hidden-metadata byte-tree guarantee. Rollback is implemented behind contracts, adapters, Rust, and provider authority, but the import UI exposes no rollback action. Clipboard source is transient, never logged, and has no Pi path.

Saved-snapshot TypeScript/JavaScript diagnostics use the separately bounded `diagnostics.v2` flow. The IDE sends an immutable authorized editor snapshot and accepts only correlated structured ready, refused, or error outcomes. Ready diagnostics retain exact bounded UTF-16 ranges, compiler and process attestation, snapshot identity, workspace authority, and completeness metadata before projection to editor markers and Problems.

The IDE RefactorKit capability boundary is limited to:

- provider status and capability discovery;
- the managed Java external-class import transaction above;
- saved-snapshot TypeScript/JavaScript diagnostics; and
- separately approved saved-snapshot semantic navigation.

Fixed, legacy, support, or provider-side code does not by itself authorize references, rename, general refactoring, or any other provider operation.

## Roadmap Freeze

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

## Approved RefactorKit Exception and Capability Boundaries

The approved capability-specific Option-B exception permits an audited source-built RefactorKit daemon for:

- **Compiler diagnostics:** the bounded `diagnostics.v2` flow preserves exact UTF-16 ranges, structured ready/refused/error outcomes, compiler and process attestation, immutable editor-snapshot identity, authority correlation, and response bounds without approximate markers or a saved-disk fallback.
- **Semantic navigation:** the separately approved saved-snapshot search and definition capability remains independently gated by its contract, authority, lifecycle, and workspace-write evidence.

REQ-REFACTORKIT-TS-001 declares `@implemented-not-e2e-validated`: implementation evidence exists, while packaged or live-provider end-to-end execution is not asserted here. Source-built eligibility and support code do not bypass per-capability contracts or acceptance evidence, and the exception does not authorize unrelated RefactorKit operations.

## Provider Foundations Are Not IDE Capabilities

In the provider contract, structural outline remains a foundation. Identifier search and definition participate only through the separately approved saved-snapshot semantic-navigation boundary. TypeScript references are experimental, TypeScript rename is experimental proposal-only, and general Java refactoring beyond the managed import transaction is not integrated. Foundations and experimental operations do not expand the approved IDE capability set.

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
