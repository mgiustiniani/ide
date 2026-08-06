# Java Intelligence — Current Boundary and Frozen TODO Inventory

**Evidence status:** **IMPLEMENTATION-INFORMED / FROZEN.** This document preserves the as-built Java boundary and useful safety design. It is not an active roadmap. [ARC42](../ARC42.md) remains the mutable architecture-status authority.

**Roadmap policy (2026-07-14):** maintain the already-as-built Java lifecycle, synchronized documents, diagnostics/Problems, completion, hover, signature help, cancellation, and stale-result guards. Do not schedule further IntelliSense or JDT LS expansion until a relevant released RefactorKit capability passes immutable real acceptance validation. Unsupported, unintegrated, experimental, or provider-bug-affected behavior remains TODO or parked; the IDE never simulates it.

“IntelliJ Ultimate-class” appears in older research as a workflow comparison only. It is not a parity claim, product goal, milestone, or delivery commitment.

## 1. Current As-Built Java Boundary

### Editor and presentation

- Monaco Editor 0.52.2 is the only editor. It is bundled locally with same-origin workers, one model per file, and a bundled Java Monarch/basic language contribution.
- Monaco mounts only for a visible, renderable, positive-area active-file host. Loading is source-free, failure offers **Retry Monaco**, and there is no native fallback.
- Conventional Java source roots receive package-chain compaction without changing their deepest real path. Production/test presentation and the Maven icon are tree behavior, not a semantic project model.
- **Settings > Java** owns global JDK/JDT LS lifecycle/status and RefactorKit availability, version, path, and capability discovery. It is not a project-action surface.
- Browser mode reports local JDT LS and RefactorKit unavailable without simulation, exposes no Java technology tab, and starts no hidden Java polling.

### Managed JDT LS lifecycle and synchronized semantics

The desktop implementation currently provides:

- full-JDK and checksum-verified external JDT LS discovery;
- one fixed-argv, no-shell JDT LS process with isolated per-workspace data;
- provider-neutral lifecycle, capability, event, document-sync, diagnostic, completion, hover, signature-help, and cancellation contracts;
- typed Tauri adapters and bounded Rust LSP framing;
- versioned `didOpen`, serialized full-text `didChange`, `didSave`, and `didClose`;
- optimistic versions and flush-before-semantic-request ordering;
- diagnostics for the authorized active editor plus `ProblemItem` projection into the conditional project-scoped Problems contribution;
- completion, hover, and signature help only for the exact synchronized Monaco Java model;
- cancellation mapped to LSP `$/cancelRequest`, disposal cancellation, and stale/late-result suppression; and
- workspace, session, path, URI, document-version, request, and cancellation identity guards.

Completion applies only its primary edit. Additional edits, workspace edits, and commands are suppressed. Provider documentation is treated as untrusted Markdown with HTML disabled. Managed configuration enables `java.signatureHelp.enabled=true`.

The conditional Problems contribution is current diagnostic presentation. It does **not** imply Java module detection, module activation, or a complete contextual project-tool lifecycle.

### Current validation boundary

Real integration passed with JDT LS `1.61.0-202607102111` and JDK `25.0.3`. The semantic smoke covered repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop. These observations validate that bounded environment and do not activate any TODO item below.

## 2. Current RefactorKit IDE Capabilities

The current IDE capability bucket is deliberately limited to:

1. provider status and strict capability discovery; and
2. the capability-gated **Paste Java Class from Clipboard** transaction.

For Java import, the directory-tree coordinator validates the selected directory, probes the exact API and import/apply/discard/rollback method features before one explicit clipboard read, presents the provider preview, requires acknowledgement for unknown/high-risk provenance, applies only the exact approved `planId`, and discards invalidated work. RefactorKit is the sole imported-project-content writer. The IDE does not infer a package, reconstruct a patch, write directly, force compatibility, log source, or send source/plan/transaction data to Pi. Rollback exists in contracts, adapters, Rust, and provider authority, but the current import UI has no rollback action.

Real temporary-workspace evidence proved no imported-target or other project-content write before Apply, discard invalidation, exact apply, and byte-for-byte backend rollback for the validated provider fixtures. That preview result is not complete hidden workspace-tree identity: provider `project.open` may create `.refactorkit/workspace.lock`. Provider version remains diagnostic metadata; exact advertised capability plus real acceptance evidence authorizes only the operation tested.

Fixed native scan/query/navigation handlers, support code, parsed fixtures, and provider advertisements do not by themselves create an IDE capability or UI contribution.

### Promoted executable requirement boundaries

[`REQ-REFACTORKIT-JAVA-IMPORT-001`](arc42/appendix-requirements.adoc#REQ-REFACTORKIT-JAVA-IMPORT-001) is declared `@implemented-not-e2e-validated`. At IDE commit `54c28f3`, its deterministic `desktop/tauri-harness` Story passed 1 scenario and 22/22 steps. Under jsdom the harness renders the production desktop `App`, actual FileTree context action, review dialog, import controller, and typed Tauri adapters. A fake in-process Tauri backend supplies capability/preview/apply/discard responses and the imported file effect; Monaco is a mocked textarea.

The Story establishes capability acceptance before exactly one clipboard read; the exact source-bearing preview DTO; complete rendered and structured review; acknowledgement before the exact authority-only Apply DTO; backend-reported parent refresh and primary-file open; a bounded trace without direct IDE mutation, Pi/AI request, source-bearing log, or clipboard source; and cancellation plus stale workspace, selection, request, and plan handling with correlated discard and fail-closed cleanup.

This evidence does not exercise the OS clipboard, native Tauri GUI, real Monaco, a live or immutable RefactorKit provider/daemon, native filesystem authority, complete hidden-metadata identity, or a packaged application. It does not supersede the separate immutable-provider evidence and makes no claim that `project.open` leaves `.refactorkit/` unchanged.

[`REQ-REFACTORKIT-JAVA-IMPORT-002`](arc42/appendix-requirements.adoc#REQ-REFACTORKIT-JAVA-IMPORT-002) is separately declared `@implemented-and-validated`. On 2026-07-16 at IDE commit `5146221`, a focused Linux X11 native Story passed 1 scenario/36 Cucumber markers against a freshly built production release/no-bundle executable. The real Tauri WebKit flow used the actual File Explorer directory context menu, production review dialog, real Monaco, and production native clipboard command with a GTK-owned OS clipboard. A sandbox-owned deterministic API-0.2 daemon observed two previews with the exact 147-byte fixture SHA-256 `cd88da64bbe8a43098c0453ade76d6e1114ba9753165e4d794a6a6cb0addb088` and distinct plan IDs. The first plan was discarded with no target. The fresh second plan reached Apply with params exactly `{ "planId": "native-java-import-plan-002" }`, produced one recorded primary-file creation, and changed the canonical workspace tree from exactly 8 to 9 entries. The retained transcript was source-free; the scenario workspace contained no `.refactorkit`; configured roots and sandbox-marked processes remained confined; and application, daemon, clipboard owner, and driver cleanup passed.

That native evidence validates only the deterministic sandbox fixture daemon and the observed Linux X11 release/no-bundle boundary. It makes no claim about a real, globally installed, immutable, or packaged RefactorKit provider; provider metadata or provider no-write behavior; raw IPC capture or underlying clipboard-read cardinality; syscall-level or global process/filesystem confinement; an application/provider package or installer; Wayland or another operating system; user-facing rollback; or the cancellation/stale-generation matrix owned by `REQ-REFACTORKIT-JAVA-IMPORT-001`.

## 3. RefactorKit Audit Buckets

| Bucket                                                   | Capabilities                                                                                                                                                                 | Architecture status                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current IDE capability**                               | Provider status/capability discovery; managed Java external-class import transaction                                                                                         | Maintain as built. Keep the non-native `-001` harness and deterministic-fixture Linux X11 `-002` native evidence separate; revalidate real provider compatibility separately. |
| **Parked — confirmed provider/protocol bug**             | TypeScript/JavaScript diagnostics (`REQ-REFACTORKIT-TS-001`)                                                  | Not implemented. Report defects and wait for corrected released contracts plus applicable immutable real evidence. No approximation, fallback, or simulation.                 |
| **Working provider foundation, not IDE capability**      | Structural outline and identifier search in the audited release                                                                                                              | Unscheduled TODO for any IDE integration. Provider stability alone does not establish typed IDE contracts, UI, or acceptance evidence.                                        |
| **Experimental provider foundation, not IDE capability** | TypeScript references; TypeScript rename proposal; semantic definition/workspace symbols where advertised experimental                                                       | Unscheduled TODO. Do not expose or imply support.                                                                                                                             |
| **Unsupported or unintegrated**                          | General Java refactor operations beyond validated import; TypeScript/JavaScript format, move, organize imports, change signature, extract, and inline in the audited release | Unscheduled TODO. No simulation or stdout-derived integration.                                                                                                                |

### Parked diagnostics

`REQ-REFACTORKIT-TS-001` remains declared `@not-implemented`. The provider protocol loses required source-range precision and lacks complete authority correlation, exact compiler attestation, saved/unsaved snapshot semantics, structured readiness/refusal/failure outcomes, and compatible runtime/response bounds. The IDE will not fabricate approximate Monaco markers or implement a Problems-only saved-disk fallback.

### Symbol-navigation status

`REQ-REFACTORKIT-TS-002` is declared `@implemented-not-e2e-validated` under the option-B source-built `0.7.0-SNAPSHOT` waiver (ADR 0011); the prior option-A wait-for-upstream parking for this requirement is superseded. Its deterministic desktop Story is useful implementation evidence (1 scenario/18 steps), and a fresh immutable byte-tree audit on the source-built `0.7.0-SNAPSHOT` daemon asserts `project.open` never creates `.refactorkit/workspace.lock`. The accepted daemon is a source-built snapshot, not an immutable released provider, so packaged GUI/E2E and a real immutable released-provider audit remain future work before any stronger status claim. `REQ-REFACTORKIT-TS-001` diagnostics remains under option A, where no metadata exception is authorized.

## 4. Machine-Readable Search Integration Gate

The user has directed that RefactorKit will add multiple search operations with optional JSON output. Those announced operations remain provider and IDE TODO until a released capability exposes a strict machine contract.

The IDE must never parse human-oriented stdout as an integration protocol. A reconsidered operation requires strict, typed, bounded, versioned machine-readable JSON or an equivalent daemon DTO that includes:

- explicit operation and schema versions;
- structured success, readiness, refusal, and error outcomes;
- result and payload bounds with explicit truncation/paging state;
- canonical authorized workspace-relative locations and precise positions/ranges where applicable;
- workspace, generation, session/snapshot, operation, and request/result correlation;
- declared capability stability and provider provenance; and
- immutable real-provider acceptance evidence for the exact released operation and integrated IDE path.

Provider output that is optional, undocumented, unbounded, human-oriented, or missing correlation is not an IDE contract.

## 5. Unscheduled TODO / Frozen Historical Inventory

There is no order, phase, milestone, target date, or resumption promise for this inventory:

- definition and references, including Monaco gestures;
- document/workspace symbols, structural outline, identifier search, and type/call hierarchy;
- code actions, quick fixes, import actions, formatting, and rename;
- general Java preview/apply refactor operations;
- Java project/module detection and activation;
- activation-scoped Problems lifetime, Build, Tests, Logs, Java tools, and contribution removal;
- contextual Maven/Gradle, framework, remote-provider, or other Java tooling;
- navigation history and large-result search UI; and
- any broader JDT LS IntelliSense expansion.

These items are retained because earlier architecture work identified useful boundaries and hazards. They are not target architecture or an implied commitment.

## 6. Safety Constraints on Any Future Reconsideration

If the user explicitly reconsiders an inventory item after RefactorKit exposes a suitable released capability, the design must still preserve:

- exact workspace and authorized-path scope;
- exact Monaco model and document/snapshot version identity;
- serialized synchronization before semantic work;
- cancellation and stale-result rejection across UI, web core, Tauri, Rust, and provider boundaries;
- bounded results, explicit truncation, and provider provenance;
- no silent merge of conflicting provider results;
- untrusted-output sanitization;
- explicit preview and confirmation for mutation;
- multi-file path, version, and hash reauthorization before apply;
- precise partial-failure and recovery reporting; and
- honest browser unavailability rather than simulation.

These are safety constraints, not acceptance criteria for an active milestone.

## 7. Provider Responsibility Boundary

- JDT LS remains the provider for the already-as-built synchronized diagnostics, completion, hover, and signature-help loop.
- RefactorKit remains the provider for the managed Java import transaction, with deterministic harness and provider evidence kept separate, and for any exact future operation that later satisfies the policy above.
- The IDE-native layers own presentation, authority, cancellation, stale guards, previews, and recovery policy.
- Build tools, debuggers, test runners, terminals, VCS, databases, containers, profilers, and AI transport are separate external-adapter concerns. This frozen Java inventory does not schedule them.

## 8. Historical Note

Earlier revisions organized definition/references, code actions, formatting, rename, hierarchy, module activation, contextual tooling, and general refactoring into numbered milestones. That sequencing is superseded by the 2026-07-14 freeze recorded in [ADR 0005](../ADR.md#adr-0005--hybrid-java-intelligence-with-jdt-ls-and-refactorkit). Historical Git revisions preserve the old sequence; this document intentionally keeps only the current boundary, audit buckets, machine-contract gate, and unscheduled TODO taxonomy.
