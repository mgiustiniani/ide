# Current Java Diagnostics and IntelliSense with FUTURE/TARGET Remaining Java Intelligence

> **MIXED DELIVERY BOUNDARY.** Monaco-only editing, locally bundled Java syntax highlighting, JDT LS document synchronization, provider-neutral diagnostic events, active-editor diagnostics, `ProblemItem` projection, a guarded conditional project-scoped Problems contribution, completion, hover, signature help, and cancellation are **CURRENT/AS-BUILT**. Java module activation, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, and the full evidence-activated project tooling suite remain **FUTURE/TARGET**. The current Problems guard does not imply module activation. The managed RefactorKit clipboard-import transaction is current but architecturally separate.

## Delivery Status

| Responsibility                  | Scope                                       | Status and boundary                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monaco editor and Java syntax   | Web and desktop editor                      | **CURRENT:** Monaco is the only editor. A locally bundled Java Monarch/basic language contribution supplies syntax highlighting without network language assets or a native fallback.                                                                                                                             |
| Tool availability and lifecycle | Desktop Settings                            | **CURRENT:** JDK/JDT LS discovery and lifecycle/status plus RefactorKit availability/version/path.                                                                                                                                                                                                                |
| Java document synchronization   | Exact desktop Java model                    | **CURRENT:** versioned full-text `didOpen`/`didChange`/`didSave`/`didClose` through `DocumentSyncPort`, a typed Tauri adapter, and Rust/LSP transport.                                                                                                                                                            |
| Interactive Phase 2 semantics   | Exact synchronized Java model               | **CURRENT:** completion, hover, signature help, and cancellation through provider-neutral contracts and guarded Monaco providers.                                                                                                                                                                                 |
| Java diagnostics and Problems   | Authorized workspace and ready Java context | **CURRENT:** the Java controller owns provider-neutral diagnostic events, active-editor diagnostics, and `ProblemItem` projection; the Desktop Shell Controller contributes project-scoped Problems while a ready Java context or projected items exist, and App only composes it. This is not module activation. |
| Project/module classification   | Opened project/module                       | **TARGET:** bounded explicit/evidence-based Java detection returning state, confidence, reasons, and matched roots.                                                                                                                                                                                               |
| Remaining editor intelligence   | Activated/synchronized Java model           | **TARGET:** definition/references and Monaco gestures, code actions, formatting, rename, and hierarchy.                                                                                                                                                                                                           |
| Full contextual project tooling | Activated Java modules only                 | **TARGET:** evidence-activated Problems lifecycle, Build, Tests, Logs, Java tools, and contribution removal on deactivation; this extends the current guarded Problems projection.                                                                                                                                |

The desktop BottomPanel contains core Terminal and AI Agent plus the conditional project-scoped Problems contribution; web contains only Terminal. Problems is contributed while a ready Java context or projected items remain and disappears when neither guard remains. Java diagnostics and semantics are not a global Java technology tab, a Settings project-action surface, or evidence of module activation.

## Current C3 Flow

```text
Monaco-only Editor
  ├─ local Java Monarch/basic contribution
  └─ exact Java text model
       │ edit
       ▼
Java Language Controller
  ├─ diagnostic events
  │    ├─ filter by authorized workspace and current generation
  │    ├─ derive diagnostics for the ready active editor document
  │    └─ project events to ProblemItem[] for Desktop Shell policy
  └─ guarded semantics
       1. advance model version optimistically
       2. enqueue serialized full-text didChange
       3. flush didChange before a semantic request
       4. attach workspace/session/path/URI/version/request/cancel identity
       │ provider-neutral ports
       ▼
Tauri Language/Document + Java Intelligence Adapters
       │ typed Tauri invoke
       ▼
Rust Java Document and Semantic Bridge
  ├─ document notifications
  ├─ completion / hover / signatureHelp
  ├─ $/cancelRequest correlation
  ├─ bounded normalization and side-effect suppression
  └─ managed java.signatureHelp.enabled=true
       │ LSP over stdio
       ▼
Eclipse JDT LS
```

### Exact-model and stale-result policy

Monaco language-provider registries are global, so registration alone is not authorization. Providers activate only when the registered model is Java and exactly matches the synchronized document. Every callback rechecks model object, workspace ID, session generation, path, URI, and document version. Requests add unique request and cancellation IDs.

Cancellation, provider disposal, workspace/session/document changes, response-ID mismatch, response metadata mismatch, failed synchronization, or a late result returns an empty/null Monaco result. Semantic work never overtakes an in-flight `didChange` because the coordinator serializes and flushes document changes first.

### Safe presentation policy

- Completion applies only the primary text edit (or safe insertion fallback).
- Additional text edits, cross-document/workspace edits, and commands are intentionally suppressed.
- Hover, signature, and completion documentation is treated as untrusted Markdown; HTML is disabled.
- Signature help uses `(` and `,` triggers and managed JDT LS configuration `java.signatureHelp.enabled=true`.
- Provider-specific JDT LS, LSP, Tauri, and Monaco wire types do not leak into provider-neutral contracts.

## Current RefactorKit Separation

Directory-tree **Paste Java Class from Clipboard** remains independent from JDT LS semantics. It uses a directory-only action or tree-scoped `Ctrl/Cmd+V`, probes the RefactorKit API, transaction capabilities, language-kernel metadata, and safety contract before one clipboard read, previews without writing, applies only the exact approved `planId`, discards invalidated work, and supports rollback. Provider version is diagnostic only and does not authorize compatibility. RefactorKit remains the sole writer for that workflow; clipboard source is transient, never logged, and has no Pi path.

## FUTURE/TARGET Activation Decision

```text
JavaActivationDecision
  ├─ state: active | inactive | needs-confirmation
  ├─ confidence: explicit | high | medium | low | none
  ├─ reasons: ordered accepted/rejected evidence
  └─ matchedModules: bounded module roots
```

Evidence policy must be bounded and conservative. Credible combinations may include Java source roots and reviewed Maven/Gradle/module descriptors. A directory name, isolated `.java` file, generated/vendor tree, or installed JDK/JDT LS alone must not silently activate a module. No such evaluator or activation decision exists current.

## FUTURE/TARGET Next Slices

```text
Current guarded diagnostics/Problems + sync + completion/hover/signature/cancel
                         │ preserve all current guards
                         ▼
1. definition / references transport + Monaco gestures
2. code actions with explicit primary/workspace-edit policy
3. formatting with versioned preview/apply policy
4. rename with cross-file preview, authorization, and stale checks
5. type/call hierarchy with bounded result and navigation policy
6. full activated-module Problems lifecycle / Build / Tests / Logs / Java tools
```

The current completion policy must not be generalized into silent workspace mutation. Code actions, formatting, and rename require explicit design for previews, multi-file edits, authorization, version checks, cancellation, and failure recovery. Navigation and hierarchy require bounded results, URI/path authorization, provenance, and stale-safe Monaco gestures.

## Target Capability Boundaries

Each FUTURE/TARGET slice requires:

- provider-neutral contracts and typed adapters for that capability;
- Rust/LSP transport with bounded normalization and cancellation;
- preservation of workspace/session/path/URI/version/request/cancel guards;
- serialized document synchronization before semantic requests;
- safe, capability-specific edit/navigation policy rather than implicit command execution;
- guarded Monaco registration and disposal behavior;
- bounded evidence-based Java module activation before the full activation-scoped project tooling suite; and
- honest browser degradation with no hidden polling or fake native parity.

Current provider-neutral diagnostics, active-editor diagnostic projection, conditional project-scoped Problems, completion, hover, signature help, document sync, and cancellation must not be described as target-only again. Conversely, the Problems visibility guard and current semantic status must not be used to claim module activation, the full contextual tooling suite, or the remaining capabilities.
