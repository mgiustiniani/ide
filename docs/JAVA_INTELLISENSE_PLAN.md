# Java IntelliSense Roadmap

**Evidence status:** **NEEDS-REVIEW.** Repository-status passages that describe diagnostics and the conditional Problems contribution as absent are stale; [ARC42](../ARC42.md) records the current guarded diagnostic projection. The target roadmap remains planning input, not the current-status authority.

**Status:** The managed JDT LS lifecycle, versioned Java document synchronization, and the interactive Phase 2 completion/hover/signature-help/cancellation slice are implemented through provider-neutral contracts, typed Tauri adapters, Rust transport, and guarded Monaco providers. Monaco is the only editor and bundles local Java Monarch/basic syntax support. Settings > Java exposes global lifecycle/status and RefactorKit availability/version/path only; native RefactorKit project actions are not globally exposed. The bounded managed RefactorKit external-import transaction is operational with installed RefactorKit `0.5.0-SNAPSHOT` (API `0.2`). Java module activation, contextual tools, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, diagnostics composition, and general refactoring integration remain FUTURE/TARGET.

**Target experience:** IntelliJ Ultimate-class Java workflows, used as a direction rather than a parity claim

## 1. Purpose and Scope

This roadmap evolves the editor toward a productive, project-aware Java development experience while preserving the web-first ports-and-adapters architecture. The intended desktop architecture is hybrid:

- a Java language server, initially Eclipse JDT LS, supplies low-latency interactive semantic features through LSP; and
- RefactorKit supplies deterministic code intelligence and previewable, controlled refactoring operations.

“IntelliJ Ultimate-class” describes workflow quality and breadth to pursue. It does **not** mean feature, performance, framework, debugger, profiler, build-tool, or plugin-ecosystem parity with IntelliJ IDEA Ultimate. JetBrains has years of proprietary analysis and framework integrations that this project does not reproduce.

## 2. Current Baseline

The implemented baseline is intentionally bounded:

- The file tree recognizes conventional Java source roots and compacts package-only namespace chains only beneath them. It preserves the deepest real path, distinguishes production `src` and test folders, gives `pom.xml` a Maven icon, and does not compact unrelated directory trees.
- Monaco Editor 0.52.2 is the only editor, bundled locally for offline use with local same-origin workers, one model per file, and a bundled Java Monarch/basic language contribution for syntax highlighting.
- Monaco lazy activation and its timeout wait for a visible, renderable positive-area active-file host; layout reruns after visibility returns. A no-file Kate-style create state and source-free loading placeholder avoid displaying source outside Monaco. Import/runtime failures offer Retry Monaco; there is no native editor fallback.
- **Settings > Java** exposes global JDK/JDT LS lifecycle/status and RefactorKit availability/version/path.
- Fixed native RefactorKit **Scan**, **Diagnostics**, **Symbols**, **Definition**, and **References** handlers exist, but no global UI exposes those project actions. Their return is gated on future evidence-based Java module activation.
- Shared contracts and a `RefactorKitPort` keep the UI and web core independent of Tauri.
- The Tauri adapter invokes fixed Rust commands.
- Rust validates lookup selectors, discovers the `refactorkit` executable, constrains execution to the selected workspace, applies timeout/output bounds, captures process metadata and output, and parses successful definition/reference output into authorized workspace-relative locations.
- Parsing, authorized-location, and navigation foundations exist behind the native boundary, but no current Java tab presents their results.
- Contextual result rendering and navigation must return only for an activated Java module and must retain workspace/module-generation guards.
- Provider-neutral lifecycle, document-sync, completion, hover, signature-help, and cancellation contracts exist without leaking JDT LS/LSP/Monaco wire types.
- Desktop Rust discovers a full JDK and checksum-installed external JDT LS, starts a fixed no-shell process with isolated per-workspace data, completes initialization, transports versioned document notifications and bounded semantic requests, sends `$/cancelRequest`, and gracefully stops/restarts the session.
- Typed Tauri adapters expose lifecycle, document synchronization, semantic requests, and cancellation. Guarded Monaco providers activate only for the exact synchronized Java model.
- Browser mode has no Java technology tab and starts no hidden Java polling; native capabilities remain unavailable without simulation.
- Real integration passed with JDT LS `1.61.0-202607102111` and JDK `25.0.3`. The semantic smoke passed repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and stop.
- A selected directory has a **Paste Java Class from Clipboard** context action and tree-focused `Ctrl/Cmd+V`; editor paste is never intercepted.
- The coordinator probes RefactorKit support before one explicit clipboard read, displays a complete provider plan, binds approval to its exact ID and workspace/selection generations, displays the returned transaction, and refreshes/opens only backend-reported paths. It has no Java parsing/direct-write fallback and no Pi data route.
- Contracts and adapters model `targetDirectory` preview, exact-`planId` apply, discard, and transaction rollback. Installed RefactorKit `0.5.0-SNAPSHOT`/API `0.2` provides `bin/refactorkit-daemon`.
- Rust owns one NDJSON daemon for the current canonical workspace generation, validates full capabilities, normalizes rich preview, discards on cancel/selection/workspace invalidation, and kills the process on malformed output, timeout, workspace switch, or application exit. Source is never logged.
- A real temporary fixture proves preview/no-write, discard, exact apply, and byte-for-byte rollback. Older or incomplete installations remain unavailable before clipboard read without force or fallback.

RefactorKit remains the only custom Java intelligence tool; its project model remains internal until concrete extraction criteria demonstrate a shared model is necessary. General previewable refactorings are not exposed. The specific external-class paste transaction is operational under its strict capability gate.

The delivered semantic slice is deliberately narrow. Providers run only for the exact synchronized Java model and recheck workspace, session generation, path, URI, model identity, document version, request ID, and cancellation ID. The coordinator advances versions optimistically, serializes full-text `didChange`, and flushes changes before semantic requests; cancellation and stale/late responses resolve to empty results. Completion maps only its primary edit and suppresses additional/workspace edits and commands. Documentation is untrusted Markdown with HTML disabled. Signature help uses managed `java.signatureHelp.enabled=true`.

There is still no Java project/module detector, activation coordinator, contextual Java contribution, diagnostics composition into Monaco/Problems, editor-position definition/references flow and Monaco gestures, code actions, formatting, rename, hierarchy, or general refactoring preview/apply flow. The bounded external-class paste path remains separate.

### Explicit non-goals

- No claim of IntelliJ IDEA Ultimate compatibility or parity.
- No reimplementation of a Java compiler, language server, build system, or framework model in TypeScript or Rust.
- No arbitrary process or arbitrary RefactorKit command execution from the frontend.
- No silent application of workspace-wide edits.
- No interception of editor paste, package derivation from a selected directory, direct IDE write fallback, or clipboard/source/plan/transaction disclosure to Pi.
- No promise that the browser runtime can provide local desktop-grade Java semantics.
- No framework-specific feature is considered delivered until its own adapter, fixtures, and acceptance tests exist.

## 3. Target User Experience

| Capability                               | Target behavior                                                                                                                              | Primary provider                                                                        | Status                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project model, activation, and indexing  | Detect modules from explicit/credible evidence; model roots, JDK, Maven/Gradle, dependencies, generated sources, and indexing state          | JDT LS/build tooling; RefactorKit scan as deterministic companion                       | **Partial foundation:** global JDK/JDT LS lifecycle exists; Java detection, activation, shared project model, contextual contributions, and editor integration are planned |
| Diagnostics                              | Live editor markers and an activated-module Problems tool; distinguish source, build-model, JDT LS, and RefactorKit findings                 | JDT LS live diagnostics; RefactorKit explicit/deeper checks                             | Native RefactorKit handler foundation only; no global action or contextual Problems contribution                                                                           |
| Completion                               | Contextual types, members, variables, methods, snippets, ranking, documentation, and import-aware completion                                 | JDT LS via LSP                                                                          | **Implemented narrow slice:** exact synchronized model, cancellable/stale-safe; primary edit only, with additional/workspace edits and commands suppressed                 |
| Go to definition                         | Navigate from a symbol to workspace or dependency source, with decompiled/read-only fallback where available                                 | JDT LS; RefactorKit definition as validation/fallback where useful                      | Native explicit-selector parsing/navigation foundation exists but has no current UI; activated-module contextual flow is planned                                           |
| Find references                          | Stream or page workspace references with file/line previews and cancellation                                                                 | JDT LS interactive search; RefactorKit deterministic query                              | Native explicit-selector parsing/navigation foundation exists but has no current UI; activated-module contextual flow is planned                                           |
| Hover and signature help                 | Type/documentation hover, parameter information, overload selection, and active parameter highlighting                                       | JDT LS via LSP                                                                          | **Implemented narrow slice:** exact synchronized model, cancellable/stale-safe, untrusted Markdown/HTML disabled; signature help enabled by managed configuration          |
| Code actions                             | Quick fixes and source actions near diagnostics, with edit previews for multi-file changes                                                   | JDT LS; selected RefactorKit operations                                                 | Planned                                                                                                                                                                    |
| Rename and refactoring previews          | Show affected files and diffs, detect stale documents, require confirmation, apply atomically where possible, and report partial failure     | RefactorKit preferred for supported safe refactorings; JDT LS actions where appropriate | Planned                                                                                                                                                                    |
| Imports                                  | Add missing imports, disambiguate candidates, remove unused imports, and organize imports with preview/settings                              | JDT LS interactive actions; RefactorKit deterministic organize-imports operation        | Planned                                                                                                                                                                    |
| Paste external Java class into directory | Explicit tree action; capability-before-clipboard; backend placement/diff/provenance review; exact-plan apply; discard; transaction rollback | Managed RefactorKit only                                                                | **Operational when fully capable:** installed `0.5.0-SNAPSHOT`/API `0.2` daemon; old/incomplete providers remain unavailable before clipboard read.                        |
| Hierarchy and navigation                 | Workspace symbols, document outline, type hierarchy, call hierarchy, implementation navigation, recent locations, and back/forward stack     | JDT LS; RefactorKit symbols/references for supported deterministic views                | Native symbols handler foundation only; no current global or contextual Java UI                                                                                            |
| Framework-aware extensions               | Opt-in adapters for framework navigation, configuration metadata, inspections, and generators                                                | Separate extension providers layered over the language-service contracts                | Future                                                                                                                                                                     |

Framework-aware work should begin with measured user demand and explicit dependencies. Likely candidates include Spring/Spring Boot, Jakarta EE, persistence/JPA, and common test frameworks, but none are committed or implemented by this roadmap alone.

## 4. Complementary Engines

### 4.1 JDT LS: interactive semantic IntelliSense

JDT LS supplies the current synchronized completion, hover, and signature-help slice. Provider-neutral contracts, typed Tauri adapters, Rust/LSP transport, versioned document notifications, cancellation, and guarded Monaco providers are implemented. Definition/references, symbols, hierarchy, diagnostics composition, and code actions remain future capabilities and must preserve the same exact-model, version, cancellation, stale-result, and bounded-transport policies.

### 4.2 RefactorKit: deterministic intelligence and safe change planning

RefactorKit remains a separate capability behind explicit contracts and is the only custom Java intelligence tool. It is suited to reproducible workspace scans, code-intelligence queries, and supported refactorings that produce a preview before apply. Its project model remains internal until measured duplication, cross-provider consistency needs, or a stable consumer contract justifies extraction. Refactoring results must use structured edits/diffs rather than raw console text before editor integration is considered complete.

### 4.3 Arbitration rules

- JDT LS owns latency-sensitive, document-version-aware editor requests.
- RefactorKit is preferred for supported deterministic preview/apply refactorings.
- The web core identifies each result by provider and does not merge conflicting edits silently.
- Diagnostics are deduplicated only when stable location, code, severity, and message rules permit it; provider identity remains visible.
- A stale document version or changed workspace snapshot invalidates a preview and forces recomputation.
- Provider failure degrades the affected capability without blocking basic editing or file access.

## 5. Architecture Boundaries

### UI (`packages/ui`)

The implemented dynamic `BottomPanel` is an accessible tool-window host. Desktop currently contributes core Terminal and AI Agent; web contributes core Terminal. Descriptors carry icon/title, core/project scope, badge/count, disabled/active state, and keyboard metadata. No Java tool is currently contributed. The Monaco-only surface provides local/offline editing, per-file models, line/column reveal, and guarded completion/hover/signature providers for the exact synchronized Java model. Future activated-module tools may add diagnostics, navigation results, indexing health, and refactoring diffs. UI components receive state/callbacks and must not import Tauri APIs, spawn processes, or speak JSON-RPC directly.

### Contracts (`packages/contracts`)

Current source-only contracts define provider-neutral lifecycle/session, document synchronization, completion, hover, signature-help, cancellation, identities and versions, positions/ranges, request IDs, and bounded errors. Symbols, definition/references, hierarchy, code actions, workspace-edit previews, pagination, and related contracts remain future additions. JDT LS/LSP/Tauri/Monaco wire types do not leak through these contracts.

### Web core (`packages/web-core`)

Web core coordinates Monaco document events and semantic requests while keeping process management native. It owns optimistic document versions, serialized full-text change delivery, flush-before-request ordering, cancellation, exact-model guards, and stale-result rejection.

Port split:

- `LanguageSessionPort` (**implemented by desktop and unavailable-browser adapters**): start/stop/restart, health, progress, events, and capabilities.
- `DocumentSyncPort` (**implemented for the desktop Java path**): versioned open/change/save/close.
- Java semantic contracts/port (**implemented narrow slice**): completion, hover, signature help, and cancellation.
- Remaining Java intelligence (**future**): definition/references, symbols, hierarchy, code actions, formatting, and rename.
- `JavaRefactoringPort` (**future beyond the bounded clipboard-import transaction**): discover, preview, validate, apply, and cancel controlled refactorings.

### Browser adapter

The browser uses the same Monaco-only editor and bundled Java syntax coloring. Its implemented Java surface explicitly reports local JDT LS and RefactorKit unavailable, with no simulation. Any future lexical/local-only feature must be accurately labeled. A future remote language-service connection requires explicit user opt-in, authentication, workspace-upload policy, and a separate ADR. Local JDT LS and local RefactorKit execution are desktop capabilities.

### Tauri TypeScript adapter

The Tauri adapters implement allowlisted lifecycle, versioned document-sync, completion, hover, signature-help, and cancellation operations. They map typed requests to Rust orchestration, validate normalized response metadata, and fail closed on malformed or mismatched payloads. They never accept arbitrary executable paths, shell fragments, or unrestricted command arrays from UI input.

### Rust orchestration (`apps/desktop/src-tauri`)

Rust owns workspace authorization and child-process lifecycle. For JDT LS it validates the authorized workspace, discovers a full JDK and valid external distribution, starts one fixed no-shell process with isolated workspace data, frames LSP over stdio, completes initialization, transports versioned document notifications plus completion/hover/signature requests, correlates cancellation through `$/cancelRequest`, suppresses unsupported side effects, and performs bounded graceful stop/restart cleanup. For external import it starts one fixed `bin/refactorkit-daemon` NDJSON process per canonical workspace generation, validates the full method/safety capability set, correlates bounded requests, normalizes rich preview, applies the exact `planId`, discards pending plans, rolls back transactions, and kills uncertain processes on malformed output, timeout, switch, or app exit without logging source. Definition/references, code actions, formatting, rename, hierarchy, richer telemetry, diagnostics composition, and project-model orchestration remain future work.

JDT LS, the full JDK, and RefactorKit are external local tools, not libraries linked into shared frontend packages. JDT LS is installed on demand as a pinned checksum-verified EPL-2.0 artifact and is not bundled or redistributed; the JDK is also non-bundled and separately licensed. Install/verify JDT LS with `pnpm tools:install-jdtls` and `pnpm tools:verify-jdtls`.

## 6. Data Flows

### 6.1 Implemented global tooling lifecycle (Phase 1A)

1. Desktop **Settings > Java** starts a language session through `LanguageSessionPort` and the Tauri adapter.
2. Rust validates the workspace, selects isolated workspace-data storage, and discovers a full JDK and external JDT LS installation.
3. Rust launches JDT LS directly without a shell and completes LSP `initialize`/`initialized`.
4. Rust normalizes lifecycle/status/capabilities and queues bounded, sequenced, generation-tagged events; polling rejects superseded generations.
5. Supported server requests receive bounded replies rather than being left unanswered.
6. Stop/restart attempts graceful `shutdown`/`exit`, then applies bounded cleanup if necessary.
7. RefactorKit availability/version/path remains independent in Settings; native scans/queries are not exposed globally.

### 6.2 Implemented synchronized interactive editor request

1. Monaco opens the exact Java model through `DocumentSyncPort`; edits advance its version optimistically and enqueue serialized full-text `didChange` notifications.
2. Before completion, hover, or signature help, the coordinator flushes pending changes so semantic work cannot overtake synchronization.
3. Each request carries workspace, session generation, path, URI, version, position, request ID, and cancellation identity through provider-neutral contracts, the typed Tauri adapter, and Rust/LSP transport.
4. Provider disposal, cursor/document/workspace/session changes, or explicit cancellation propagates to Rust and JDT LS. Mismatched or late results are suppressed.
5. Monaco renders bounded primary completion edits and untrusted Markdown with HTML disabled. Additional/workspace edits and commands are not applied.
6. Save and close produce versioned `didSave`/`didClose`; managed stop closes the session.

Diagnostics composition and contextual Problems remain future work.

### 6.3 Future activated-module navigation and references

Rust already contains bounded explicit-selector RefactorKit handlers and authorized-location parsing, but no current global Java surface exposes them. After evidence-based Java module activation exists, a contextual Java tool may request these operations for active module roots, render bounded provider-labeled results, open authorized locations through editor ports, and reject stale workspace/module generations. The planned interactive flow will also discover symbols from editor positions through `JavaIntelligencePort`, use JDT LS, record navigation history, and support bounded or paged dependency/workspace results. None of this contextual flow is currently delivered.

### 6.4 Implemented managed external-class paste

1. The user selects a directory and invokes its context action or presses `Ctrl/Cmd+V` while the tree owns focus. This never intercepts editor paste.
2. Web core validates the target and probes authoritative `java.importExternalClass` capability. Missing/failed support, target-package-only support, or an incomplete `targetDirectory`/preview/apply/discard/rollback/safety contract stops before clipboard access.
3. Only after support is proven, the clipboard adapter reads text once. Empty/oversized text is refused and transient source is cleared after the request; it is never sent to Pi or logs.
4. RefactorKit returns a correlated complete plan. The dialog exposes placement, affected/package changes, rendered and structured diffs, evidence/risk, warnings, diagnostics, provenance/license, unresolved dependencies, conflicts, refusal/stale evidence, and apply blockers. Refused/error/stale/ineligible plans and unacknowledged unknown/high-risk provenance cannot apply.
5. Approval binds the exact displayed `planId` and current workspace/selection generations. Cancel, changed selection/workspace, or mismatched approval invokes `refactor.discard` and forces a new preview. The IDE performs no package inference, reconstructed edit, or direct write.
6. Managed RefactorKit applies only that plan and returns opaque transaction, changed files, primary file, and diagnostics. Those results alone drive transaction display, tree refresh, and open-file behavior. Rollback uses the opaque transaction ID.

All steps are operational with the installed full-capability daemon. A real temporary fixture proved preview/no-write, discard, apply, and byte-for-byte rollback; old or incomplete providers remain refused before step 3.

### 6.5 General refactoring preview and apply

1. UI requests available actions for a document version/range.
2. Web core routes supported safe refactorings to RefactorKit and other quick fixes/source actions to JDT LS.
3. Rust invokes only an allowlisted operation within the authorized workspace.
4. The provider returns a structured preview: operation ID, base workspace/document versions, affected files, edits, warnings, and a short-lived preview token.
5. UI displays a selectable multi-file diff. No edit is applied before confirmation.
6. Apply revalidates paths, versions, token, and file hashes; creates a recovery/undo boundary where feasible; applies atomically where supported; and reports every changed or failed file.
7. Successful apply updates open buffers and invalidates JDT LS and RefactorKit caches. Partial application is treated as an error with recovery guidance, not success.

## 7. Lifecycle and Operational Requirements

### Workspace scope and persistence

- Sessions, caches, indexes, diagnostics, and recent requests are keyed by a stable workspace identity, never by a global “current directory.”
- Closing a workspace cancels requests, closes documents, stops processes after a grace period, and drops ephemeral state.
- Persistent state may include trusted tool paths/versions, JDK selection, project-model fingerprint, indexing metadata, and UI preferences. Source text, hover content, and completion payloads are not persisted by default.
- JDT LS workspace data and RefactorKit caches live in separate versioned directories. Tool/JDK/version or project-model changes trigger migration or clean rebuild rather than unsafe reuse.

### Cancellation and debouncing

- Completion cancels on cursor/document change and uses a short configurable debounce.
- Hover/signature requests are delayed enough to avoid floods and cancel on cursor movement.
- File-change batches and diagnostics refreshes use trailing-edge debouncing.
- References, hierarchy, indexing, scans, and refactor previews expose explicit cancel controls.
- Cancellation propagates UI → web core → Tauri → Rust → LSP `$/cancelRequest` or process operation when supported.

### Caching and invalidation

Cache only normalized, bounded results keyed by workspace generation, provider/tool version, project-model fingerprint, document URI/version, request kind, and parameters. Invalidate on document edits, save/rename/delete, classpath/build-file/JDK changes, generated-source changes, refactoring apply, provider restart, or tool upgrade. File watching must coalesce events and handle overflow by scheduling a full reconciliation.

### Security and resource limits

- Canonicalize and authorize all workspace and edit paths; reject traversal, symlink escape, and writes outside approved roots.
- Spawn known executables directly without a shell, sanitize environment variables, and use minimal permissions.
- Treat LSP/tool output and documentation as untrusted data; escape rendered Markdown/HTML and disallow command links by default.
- Cap message size, item count, file count, diff size, stdout/stderr, runtime, concurrent requests, memory where the platform permits, and restart frequency.
- Large references/diagnostics are paged or summarized with a clear truncation indicator.
- Never send workspace source or telemetry to a remote service without explicit, informed opt-in.

### Observability

Expose a Java status surface with workspace, provider versions, JDK, project-model state, indexing progress, queue depth, restart count, last failure, and degraded capabilities. Structured logs correlate workspace/session/request IDs and record operation type, duration, result counts, cancellation, truncation, cache hit/miss, and error category. Logs and metrics exclude source text, symbol names, paths beyond redacted workspace-relative forms, and environment secrets by default; the managed RefactorKit protocol never logs clipboard source. A user-triggered diagnostic bundle must preview what will be exported.

## 8. Delivery Milestones

### Milestone 0 — Preserve and harden the native RefactorKit foundation

**Scope:** Keep versioned detection, structured parsing, workspace identity, cancellation hooks, bounded errors, and honest availability while project actions remain unexposed globally. Authorized location parsing is foundation evidence, not a current Java tool-window claim.

**Acceptance criteria:**

- Settings advertises only RefactorKit availability/version/path; it does not advertise scan/query/navigation as global actions.
- Native handlers preserve bounded output and authorized workspace-relative location parsing.
- No Java project action appears in a generic workspace or web shell, and no hidden Java polling starts.
- Every operation is tied to an authorized workspace and reports timeout/truncation/cancellation distinctly.
- Malformed or oversized output cannot crash the UI.
- Browser mode clearly reports local Java intelligence as unavailable rather than simulating results.

### Milestone 1 — Language-service foundation and project model

#### Phase 1A — Managed lifecycle (**implemented**)

Typed session/document-sync contracts, full-JDK and external JDT LS discovery, workspace-data isolation, fixed no-shell process launch, LSP framing and initialization, normalized status/capabilities, bounded generation-tagged event polling, server-request replies, and graceful stop/restart are implemented through Rust, the Tauri adapter, and desktop Java Settings. Browser capability is explicitly unavailable without simulation.

Real integration passed with JDT LS `1.61.0-202607102111` and JDK `25.0.3`. The test `managed_jdtls_real_initialize_poll_and_graceful_stop` is intentionally ignored in default Rust runs because it requires those external tools; after installation run `cargo test --locked managed_jdtls_real_initialize_poll_and_graceful_stop -- --ignored --nocapture` from `apps/desktop/src-tauri`.

#### Phase 1B — Versioned document synchronization (**implemented for the exact Java model**)

`DocumentSyncPort`, typed Tauri adaptation, and Rust LSP notifications provide ordered versioned open/change/save/close. The semantic coordinator advances versions optimistically and serializes/flushes full-text changes before requests.

#### Phase 1C — Evidence-based Java module activation (**future**)

Define explicit configuration and bounded Java module evidence; return activation state, confidence, reasons, and roots; test false positives, multi-module workspaces, deactivation, contribution lifetime, generic-workspace absence, and web degradation. Only active modules may contribute Problems, Build, Tests, Logs, or Java tools.

### Milestone 2 — Core interactive IntelliSense (**completion/hover/signature slice implemented**)

**Implemented scope:** completion, hover, signature help, cancellation, exact-model guards, stale/late suppression, safe primary-edit mapping, and untrusted-Markdown handling.

**Remaining scope:** diagnostics markers/Problems, document/workspace symbols, definition/references with Monaco gestures, and navigation history.

**Acceptance criteria:**

- **Met for the current slice:** results correspond to the current document version; stale/late responses do not render; completion/hover/signature are cancellable; provider failure leaves Monaco editing and file operations usable.
- **Evidence:** the real JDT LS smoke passed repeated completion containing `repeat`, helper hover, `substring(int beginIndex)` signature help, cancellation, `didClose`, and stop.
- **Still required:** cross-file/dependency navigation fixtures and named latency budgets for future definition/references and symbol flows.

### Milestone 3 — Next Java slices: navigation, actions, formatting, rename, and hierarchy

**Ordered scope:** (1) definition/references transport and Monaco gestures; (2) code actions with an explicit edit/command policy; (3) formatting with versioned preview/apply policy; (4) rename with cross-file authorization, preview, and stale checks; (5) bounded type/call hierarchy. Imports and quick fixes are part of the code-action policy, not silently enabled by the current completion slice.

**Acceptance criteria:**

- Large reference sets are cancellable and bounded without losing truncation/paging status.
- Multi-file actions show a diff and reject stale files.
- Import ambiguity requires user selection; organize imports honors project/settings fixtures.
- Navigation targets outside authorized locations cannot be modified.

### Milestone 4 — RefactorKit preview/apply integration

**Implemented bounded slice:** the external-class clipboard-paste UI/coordinator/contracts/adapters and real managed protocol are operational with installed RefactorKit `0.5.0-SNAPSHOT`/API `0.2` and `bin/refactorkit-daemon`. Rust owns one NDJSON daemon per workspace generation, validates the complete capabilities contract, opens the canonical workspace, normalizes rich `targetDirectory` preview, applies the exact `planId`, invokes discard for cancellation/invalidation, and rolls back by transaction ID. Malformed output, timeout, workspace switch, and app exit terminate the process; source is never logged. Older or incomplete providers remain unsupported before clipboard read.

**Remaining scope:** expose selected general previewable refactorings, beginning with rename and organize imports only if capability probing confirms support. Build on implemented native parsing, authorized-location boundaries, and the no-force/no-fallback policy.

**Acceptance criteria:**

- External-class import capability probing precedes clipboard access; unsupported and failed probes read nothing.
- Directory context action/tree-focused shortcut never intercepts editor paste.
- Preview and apply are separate; confirmation is mandatory and binds the exact displayed plan.
- Real external-class apply returns backend-authoritative transaction/changed/primary paths used for refresh/open; preview/no-write, discard, exact apply, and byte-for-byte rollback by transaction ID are proven on a temporary fixture.
- Source, plans, and transactions never reach Pi, and the IDE performs no direct-write or target-package fallback.
- Rename fixtures update code and relevant imports/references while preserving unrelated files.
- Changed files/hashes invalidate a preview before apply.
- Failure injection demonstrates rollback/recovery behavior and precise partial-failure reporting.
- JDT LS observes applied changes and refreshes diagnostics/navigation without reopening the workspace.

### Milestone 5 — Reliability, performance, and framework extension points

**Scope:** Incremental invalidation, persistent cache policy, telemetry/status UX, soak testing, extension-provider API, and one separately approved framework pilot.

**Acceptance criteria:**

- Tool upgrades, JDK/classpath changes, watcher overflow, generated sources, and workspace reopen have deterministic rebuild behavior.
- Long-running edit/index/refactor soak tests remain within agreed CPU/memory/restart budgets.
- Diagnostic bundles are redacted and user-reviewable.
- Any framework pilot documents supported workflows and known gaps without generalizing to “Ultimate support.”

## 9. Test Strategy

- **Contract tests:** serialization, capability negotiation, request IDs, document versions, cancellation, paging, limits, errors, and workspace edits.
- **Web-core unit tests:** debounce behavior with fake timers, provider routing, cache keys/invalidation, stale-result rejection, diagnostics deduplication, and preview policy.
- **UI tests:** Monaco provider mapping, keyboard access, Problems/results panels, indexing/degraded states, diff confirmation, truncation, and error recovery.
- **Adapter tests:** browser unavailable behavior and Tauri command/event normalization with mocked transport.
- **Rust unit tests:** path authorization, executable discovery, environment policy, NDJSON framing, full-capability validation, canonical workspace open, limits, timeout/cancel/kill, workspace-generation lifecycle, discard, exact-plan apply, rollback, and redaction.
- **Protocol integration tests:** a controllable fake LSP server for ordering, progress, malformed frames, late responses, crashes, and cancellation.
- **Java fixture tests:** Maven and Gradle, multiple modules, dependency source, generated sources, syntax/type errors, overloaded methods, ambiguous imports, inheritance, records/generics, and refactoring golden diffs.
- **End-to-end desktop tests:** workspace open → index → edit → complete → diagnose → navigate → preview → apply → undo/recover.
- **Performance tests:** cold/warm startup, indexing, p50/p95 interactive latency, memory, output bounds, and large-result cancellation on versioned representative repositories.
- **Security tests:** traversal/symlink escape, unauthorized edit URIs, malicious Markdown/LSP payloads, oversized frames, environment leakage, executable substitution, remote-access defaults, capability-before-clipboard ordering, no Pi disclosure, exact-plan binding, and refusal of target-package/direct-write fallback.

Current validation passed 532 frontend tests and 143 Rust tests with 7 ignored, plus one explicitly run real JDT LS semantic smoke. Builds, lint, Rust formatting, Clippy, package-boundary checks, Markdown formatting/link checks, and Structurizr validation passed. Acceptance thresholds must still be recorded against named fixture sizes and test hardware before performance milestones are called complete; this roadmap does not invent performance numbers.

## 10. Risks and Dependencies

| Risk/dependency                                                               | Impact                                                         | Mitigation                                                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| JDK, JDT LS, Maven/Gradle, and RefactorKit installation/version compatibility | Setup failure and inconsistent behavior                        | Capability/version probing, supported-version matrix, actionable status UI, pinned test fixtures                                               |
| JDT LS startup and indexing cost                                              | Slow cold starts and high memory                               | Per-workspace lifecycle, progress UX, cache reuse with strict fingerprints, resource budgets                                                   |
| Overlap or disagreement between providers                                     | Confusing diagnostics/actions or unsafe edits                  | Explicit ownership/arbitration, provider labels, no silent merge, golden cross-provider tests                                                  |
| LSP process and stdio complexity                                              | Deadlocks, leaks, stale responses                              | Rust-owned framing, bounded queues, cancellation, process-tree cleanup, fake-server fault tests                                                |
| Build-tool and generated-source diversity                                     | Incorrect project model                                        | Start with supported Maven/Gradle matrices; expose degraded state; add fixtures before claims                                                  |
| Refactoring consistency across unsaved buffers and disk                       | Data loss or stale edits                                       | Version/hash preconditions, buffer-aware previews, confirmation, recovery boundary                                                             |
| Missing, old, or incomplete RefactorKit daemon capability                     | Clipboard workflow is unavailable on that installation         | Require the full `targetDirectory` preview/apply/discard/rollback contract; keep capability-first zero-read refusal, no force, and no fallback |
| Large repositories and result sets                                            | UI stalls/resource exhaustion                                  | Streaming/paging, virtualization, caps, cancellation, incremental invalidation                                                                 |
| Browser limitations                                                           | Feature divergence                                             | Honest capability reporting; keep local desktop execution primary; design remote mode separately                                               |
| Framework expectations                                                        | Perceived Ultimate parity despite missing proprietary analysis | Publish a feature matrix and known gaps per extension; avoid umbrella parity labels                                                            |
| Third-party licenses and distribution                                         | Packaging restrictions                                         | Review JDT LS, JDK, RefactorKit, build-tool, and framework-extension licenses before bundling                                                  |

## 11. Realistic Gap Versus IntelliJ IDEA Ultimate

Even after these milestones, a substantial gap will remain. Expected differences include less mature completion ranking and inspections; fewer refactorings and intention actions; weaker Maven/Gradle edge-case handling; limited decompiler/debugger/test-runner/profiler/database tooling; fewer enterprise and framework integrations; no comparable plugin ecosystem; and less optimization for very large or unusual projects. Compatibility testing across JDKs, annotation processors, generated code, mixed-language builds, and remote development will also be narrower.

Success should therefore be measured by reliable completion of documented Java workflows, safety of workspace changes, latency on representative projects, and transparent degradation—not by a blanket claim of IntelliJ Ultimate parity.

## 12. Diagram Decision

The C1–C3 documents show the **CURRENT/AS-BUILT** Monaco-only editor, bundled Java syntax contribution, global Java Settings, managed JDT LS lifecycle, versioned document synchronization, guarded completion/hover/signature/cancellation path, and separate RefactorKit external-import transaction. The mixed current/target Java C4 view retains evidence-based activation, contextual Problems/Build/Tests/Logs/Java tools, diagnostics composition, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, and broader provider flows as explicitly FUTURE/TARGET. Current and target views move only from repository evidence.
