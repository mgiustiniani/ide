# Architecture Decision Records

This file contains the Architecture Decision Records (ADRs) for the IDE project. Each ADR follows the Michael Nygard format: **Context**, **Decision**, **Consequences**.

---

## ADR 0001 — Web-First Reusable Frontend Architecture

### Context

The IDE must run as both a Tauri desktop application and a standalone webapp. Building separate frontends for each platform would double the UI maintenance burden. We needed an approach that maximises code reuse while allowing platform-specific behaviour (e.g., desktop command execution via Tauri Rust commands vs. a simulated terminal in the browser).

### Decision

Adopt a **web-first, reusable frontend architecture**:

- All UI components live in `packages/ui/` with **zero Tauri imports**.
- All shared state and view-model logic lives in `packages/web-core/`.
- Platform-specific code is isolated to adapter packages (`packages/browser-adapters/` and `packages/tauri-adapters/`); app shells compose the chosen adapters.
- The web app (`apps/web/`) has no Tauri dependency and builds/runs standalone.
- The desktop app (`apps/desktop/`) imports the same UI and core packages but plugs in Tauri-specific adapters.

### Consequences

**Positive:**

- Single UI codebase for both targets — reduced maintenance.
- Webapp can be developed and tested independently of Tauri.
- Future runtimes can be isolated behind new app shells and adapter packages.

**Negative:**

- Adapter interfaces must be designed carefully to abstract platform divergence.
- Terminal behavior differs by runtime: the web adapter simulates output, while the desktop adapter executes bounded one-shot commands; a persistent interactive PTY is not implemented.

---

## ADR 0002 — Ports & Adapters Pattern (Hexagonal Architecture)

### Context

With a shared UI codebase and two platform targets, components must not depend directly on platform APIs (Tauri `@tauri-apps/api` or browser storage/process APIs). Tight coupling would make the webapp impossible to run without Tauri and would prevent swapping implementations.

### Decision

Apply the **ports & adapters (hexagonal) pattern**:

- Define **port interfaces** in `packages/web-core/ports/` — e.g., `EditorPort`, `FileTreePort`, `TerminalPort`.
- View models depend on these ports; app shells pass UI components plain props and callbacks.
- **Adapters** implement the ports for each platform:
  - `packages/browser-adapters/` — browser implementations using `localStorage` with fallback state and a simulated terminal.
  - `packages/tauri-adapters/` — Tauri implementations that invoke Rust commands for workspace file I/O and bounded command execution.
- View models in `packages/web-core/` orchestrate the interaction between ports and state stores.

### Consequences

**Positive:**

- UI is completely platform-agnostic — no Tauri imports in shared packages.
- Adapters can be swapped at runtime or build time.
- Testing: ports can be mocked; adapters can be unit-tested in isolation.

**Negative:**

- Extra abstraction layer adds boilerplate.
- Adapter interfaces must be stable; changes ripple across both adapter packages.

---

## ADR 0003 — Three-Panel Layout with Dynamic Accessible Bottom Tool-window Host

### Context

The IDE requires a three-region layout: left sidebar, editor area, and a bottom tool-window area. Core and future project modules need to contribute tools without hard-coding technology tabs, and keyboard/screen-reader users need predictable tab semantics.

### Decision

Implement a **fixed three-panel layout** with an extensible bottom panel system:

- Layout defined in `packages/ui/components/PanelLayout/` as a CSS-Grid/Tailwind container.
- `BottomPanel` is a dynamic contribution host whose descriptors carry id/label plus optional icon, title, core/project scope, badge/count, disabled, and active metadata.
- It exposes tablist/tab/tabpanel semantics and ArrowLeft/ArrowRight/Home/End navigation across enabled tabs.
- Generic desktop currently contributes core Terminal and AI Agent; generic web contributes core Terminal only. Java and XCOM are not global tabs.
- Panel state (sizes, visibility, active tab) is managed in Zustand (`packages/web-core/state/`), and resizing remains shared.
- The right sidebar area is reserved for future use (e.g., file outline, Git status).

### Consequences

**Positive:**

- Single layout component reused by both web and desktop.
- Core and future activated modules can contribute tools through one accessible host contract.
- Resize state is persisted and platform-agnostic.

**Negative:**

- The three-panel layout is fixed — no custom panel arrangement (e.g., moving terminal to the right). A future ADR may introduce a flexible docking system.
- Right sidebar is empty until future features are implemented.

---

## ADR 0004 — Package Isolation Boundaries (pnpm Workspace)

### Context

With multiple packages in a pnpm workspace, we must prevent accidental dependency leaks — especially Tauri imports into the shared `packages/ui/` and `packages/web-core/` packages. Uncontrolled imports would break the webapp build.

### Decision

Enforce **package isolation boundaries** through tooling and conventions:

- `packages/ui/`, `packages/web-core/`, and `packages/contracts/` do not depend on or import `@tauri-apps/api`.
- `scripts/check-boundaries.sh` validates internal package dependencies.
- `packages/contracts/` contains only TypeScript types with zero runtime dependencies.
- `packages/browser-adapters/` and `packages/tauri-adapters/` may depend on `@ide/web-core` because they implement its port interfaces.
- `packages/tauri-adapters/` is the only package allowed to depend on `@tauri-apps/api`.

### Consequences

**Positive:**

- Webapp build never fails due to missing Tauri dependencies.
- Clear ownership — developers know which package may depend on what.

**Negative:**

- Requires boundary checks to run regularly.
- Occasional refactoring if a shared component needs platform info (pushed to adapter layer).

---

## ADR 0005 — Hybrid Java Intelligence with JDT LS and RefactorKit

**Status:** Accepted as-built decision; active-roadmap scope amended by the user on 2026-07-14.

### Context

The desktop has managed JDT LS and fixed RefactorKit foundations with different scopes. JDK/JDT LS lifecycle/status and RefactorKit availability/version/path are global tooling concerns; scan/query/navigation and contextual project workflows require future Java module activation. The interactive edit loop now includes versioned document synchronization, completion, hover, signature help, and cancellation. RefactorKit remains the deterministic Java and controlled-transformation provider rather than being forced to own low-latency editor semantics. The browser target remains independent of Tauri and does not simulate local semantic support.

The desktop also has **Paste Java Class from Clipboard** for a selected directory. This introduces a sensitive clipboard boundary and a potentially multi-file write. Installed RefactorKit `0.5.0-SNAPSHOT` (API `0.2`) now supplies `bin/refactorkit-daemon` and the required directory-authoritative transaction, but old or incomplete installations still exist. Treating version alone or target-package support as sufficient, deriving a package in the IDE, applying provider output through direct IDE writes, or keeping source-bearing plans after invalidation would violate provider authority, privacy, and exact-preview approval.

On 2026-07-14, the user narrowed the active roadmap without withdrawing this as-built architecture. The policy preserves the implemented Java lifecycle, synchronized-document flow, existing diagnostics/Problems behavior, completion, hover, signature help, cancellation, and stale-result guards. It removes further IntelliSense and JDT LS expansion from active milestones until relevant RefactorKit capability is released and validated. This amendment changes scheduling and capability-claim rules; it does not erase the rationale for the existing hybrid boundary or deprecate its validated behavior.

### Decision

Adopt a **hybrid Java intelligence architecture**:

- Eclipse JDT LS, managed as a workspace-scoped child process by the Tauri Rust backend, is the selected primary provider for interactive semantic IntelliSense over LSP.
- RefactorKit remains a separate provider for deterministic code-intelligence operations and supported preview/apply refactorings.
- Shared UI and web core use typed, provider-neutral ports and contracts; they do not manage processes or depend directly on LSP, JDT LS, RefactorKit, or Tauri APIs.
- Rust owns workspace authorization, process lifecycle, NDJSON protocol framing, cancellation, resource/output limits, restart policy, and fixed allowlisted tool operations. It manages one RefactorKit daemon per workspace generation, opens the canonical workspace, and terminates the process on malformed output, timeout, workspace switch, or application exit.
- Multi-file edits require structured previews, stale-version/hash validation, and explicit user confirmation. Provider results retain provenance and are never merged silently.
- **Paste Java Class from Clipboard** is directory-tree scoped: a directory context action and `Ctrl/Cmd+V` only while the tree owns focus. Normal editor paste is not intercepted and no global paste listener is installed.
- The coordinator validates the target and probes authoritative RefactorKit capabilities before one explicit clipboard read. Version alone is not capability evidence. Missing, failed, target-package-only, or incomplete support stops with no clipboard read and no write; there is no force override.
- Operational support requires managed `java.importExternalClass` with `targetDirectory`, complete preview, exact-plan apply, discard, and rollback by opaque transaction ID. Preview retains placement, rendered and structured diffs, evidence, risk, diagnostics, provenance/license, unresolved dependencies, conflicts, eligibility, and staleness. Apply binds the displayed `planId` plus workspace/selection generations; backend results own transaction, changed-file, and primary-file identity used for refresh/open.
- Cancel, selection invalidation, and workspace invalidation invoke `refactor.discard`. RefactorKit is the sole external-import writer and rollback authority. The IDE does not derive target packages, reconstruct patches, perform fallback/direct writes, or disclose clipboard source, plans, or transactions to Pi or logs.
- The browser adapter reports unavailable capabilities honestly. Any future remote language service requires explicit opt-in and a separate decision.

The native RefactorKit foundation includes fixed status, scan, diagnostics, symbols, definition, and references handlers. **Settings exposes only availability/version/path.** Scan/query/navigation UI is deferred until evidence-based Java module activation can scope it contextually; backend capability is not a global product contribution.

The implemented JDT LS portion now includes provider-neutral lifecycle, document-sync, completion, hover, signature-help, and cancellation contracts; full-JDK and valid external JDT LS discovery; fixed no-shell per-workspace launch with isolated data; LSP initialization and bounded transport; typed Tauri adapters; versioned open/change/save/close; and guarded Monaco providers. Providers activate only for the exact synchronized Java model. Workspace/session/path/URI/version/request/cancel guards, optimistic versions, serialized full-text `didChange` flush-before-request, cancellation, and stale/late suppression protect the flow. Completion maps only the primary edit and suppresses additional/workspace edits and commands. Markdown is untrusted with HTML disabled; managed configuration sets `java.signatureHelp.enabled=true`. The selected JDT LS release remains external, checksum-pinned, non-bundled EPL-2.0 software; the full JDK is separately installed/licensed.

A real JDT LS smoke passed repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop. Diagnostics composition, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, Java activation, and contextual project tools were originally recorded as future work in [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md). The external-class clipboard workflow is separately operational with the installed full-capability daemon; its real temporary-workspace smoke proved preview/no-write, discard, exact apply, and byte-for-byte rollback. RefactorKit remains the only custom Java intelligence tool; its project model remains internal until extraction criteria emerge.

#### 2026-07-14 roadmap lifecycle amendment

The preceding future-work statement is retained as historical rationale, but those items are no longer active milestones. Apply the following policy:

- Preserve and maintain the already-as-built Java lifecycle, synchronized documents, diagnostics/Problems behavior, completion, hover, signature help, cancellation, and workspace/session/path/URI/version/request/cancel stale guards.
- Do not schedule further IntelliSense or JDT LS expansion until RefactorKit exposes the relevant released capability and immutable real acceptance evidence validates both the provider contract and the integrated behavior. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, and contextual Java tooling are unscheduled TODO inventory, not active roadmap milestones.
- Claim a RefactorKit integration only for the exact capability that works now and passes immutable real validation. Unsupported or unintegrated operations remain TODO and are never simulated. A confirmed provider or protocol bug parks the affected requirement and is reported rather than hidden behind a fallback, approximation, or status promotion.
- The current audited IDE-capability bucket contains RefactorKit capability discovery and the validated Java external-class import workflow described above. The parked bucket contains [REQ-REFACTORKIT-TS-001 diagnostics](features/refactorkit/typescript-compiler-diagnostics.feature), because the confirmed protocol loses required range, failure, snapshot, attestation, and authority-correlation semantics, and [REQ-REFACTORKIT-TS-002 semantic navigation](features/refactorkit/typescript-javascript-symbol-definition.feature), because immutable `v0.6.2` validation confirmed an unauthorized `.refactorkit/workspace.lock` write. Both requirements remain not implemented until corrected released capability and applicable real acceptance evidence exist.
- Structural outline and identifier search are stable provider foundations in the audited RefactorKit release, while TypeScript references are experimental and TypeScript rename is experimental proposal-only. None is thereby an IDE capability. Their IDE integrations, and general Java refactor operations beyond the separately validated import workflow, remain unscheduled TODO unless each exact provider operation is discovered, integrated, and immutably validated.
- Planned upstream RefactorKit search operations with optional JSON output remain TODO until a released capability exposes strict, typed, bounded, and versioned machine-readable JSON, or an equivalent daemon DTO, that represents errors, truncation, locations, and request/result correlation. Human-oriented stdout must never be parsed as an IDE protocol.

### Consequences

**Positive:**

- Each engine is used for its strongest role: interactive LSP semantics versus deterministic, safe change planning.
- Existing web-first boundaries and independent browser builds are preserved.
- Workspace isolation, cancellation, stale-result rejection, and security policy have a single native orchestration point.
- Capability-first clipboard access avoids reading sensitive source when the provider cannot perform the requested workflow.
- Exact-plan approval and backend-authoritative transactions preserve preview/apply/rollback integrity without IDE-owned Java writes.
- Providers can degrade or evolve independently behind stable capability contracts.
- The roadmap amendment preserves validated editor behavior while preventing provider foundations, experimental operations, or support code from being presented as completed IDE capability.
- Typed machine-readable protocol evidence remains a hard boundary; human output cannot become an accidental integration contract.

**Negative:**

- Two engines introduce installation, versioning, lifecycle, caching, and result-arbitration complexity; the JDK and JDT LS remain external prerequisites.
- JDT LS indexing has startup and memory costs, especially with multiple workspaces.
- Diagnostics, references, or actions can disagree; the UI must preserve provider identity and avoid unsafe deduplication.
- Browser Java support will remain materially below desktop support unless a separately secured remote provider is introduced.
- RefactorKit installation and daemon lifecycle add a local runtime dependency; older or incomplete providers remain unavailable rather than being forced or adapted.
- Refused, stale, blocked, mismatched, or failed plans require a new preview or provider correction rather than fallback mutation.
- Previously listed IntelliSense, activation, navigation, and refactoring work now has no schedule; confirmed upstream defects can keep requirements parked indefinitely.
- This direction improves selected workflows but does not establish IntelliJ IDEA Ultimate parity.

---

## ADR 0006 — Lazy Local Monaco-Only Editor

### Context

The editor needs advanced code-editing behavior and language-service integration while desktop and web remain offline-capable under the existing Content Security Policy. Maintaining a second native editor created duplicate content, selection, navigation, failure, and accessibility behavior. Monaco must still avoid mounting before layout provides a visible positive-size host and must not expose source in a substitute loading surface.

### Decision

Use **Monaco Editor 0.52.2 as the only editor**:

- Bundle Monaco, same-origin workers, and the Java Monarch/basic language contribution locally; use no CDN and do not broaden CSP.
- Import and mount Monaco lazily only for a visible, renderable, positive-area active-file host; start the bounded timeout only then and request layout after visibility returns.
- Show a Kate-style create-file state when no file is open and an inert source-free placeholder while Monaco loads.
- On import/runtime failure, offer Retry Monaco. Do not render or expose a native editor fallback.
- Maintain one Monaco model per file and support RefactorKit line/column reveal.
- Register semantic providers defensively because Monaco provider registries are global: serve only the exact synchronized Java model and suppress stale or mismatched results.

### Consequences

**Positive:**

- One editor owns content, selection, navigation, accessibility, and language-provider behavior.
- Local assets preserve offline operation and the existing CSP boundary.
- Source-free loading avoids presenting file content outside Monaco.
- Per-file models and exact-model guards provide a stable semantic integration boundary.

**Negative:**

- Monaco import/runtime failure temporarily prevents editing until retry succeeds; there is intentionally no fallback editor.
- Monaco and worker/language assets add bundle size when loaded.
- Timeout, layout observation, model disposal, retries, and guarded provider registration add lifecycle complexity.
- Monaco syntax highlighting alone does not imply project activation or the Java capabilities still listed as future.

---

## ADR 0007 — Machine Settings and Evidence-Activated XCOM Project Contributions

### Context

XCOM game/SDK/Steam download state, environment health, and operational setup describe a machine, not every opened workspace. Presenting them as a global XCOM activity entry or bottom tab creates false project context; starting polling in a generic web workspace creates hidden work for a native capability the browser cannot provide. Conversely, XCOM build, diagnostics, logs, and language support are meaningful only for an XCOM project/module. The first-party feature is built-in, experimental, and plugin-shaped, but the IDE has no extension install/remove lifecycle or generic third-party runtime. Java, IntelliJ-direction work, JDT LS, and RefactorKit are independent core capabilities.

### Decision

Treat the current `ide.xcom2-wotc` monitor, pure dry-run planner, and transaction controls as a **machine-level Settings contribution**. Desktop Settings may refresh and subscribe to bounded, read-only Steam evidence for AppIDs `268500`, `602410`, and optional `299990`, exporting conservative state with redacted provenance. The dry-run remains separate and non-executable. The AS-BUILT concrete SDK transaction supplies 15-operation Prepare review, exact-digest one-transaction approval, Restore Vanilla SDK, cancellation, rollback, recovery, and Prepare Again, as detailed by ADR 0009. Generic workspaces expose no XCOM activity entry or bottom tab. Web exposes no XCOM surface or hidden polling; its setup adapter reports unavailable without simulation.

The concrete fingerprinted SDK operation set is available for exact-digest approval, but no live Apply has been performed. Protontricks, Steam shortcut, prefix, package-manager, and interactive work remain FUTURE/TARGET and non-executable. This narrow transaction approval is not a general external-root grant.

Separately, future XCOM project/module contributions activate only after explicit configuration or conservative evidence evaluation. Candidate evidence includes `*.x2proj`, `*.XComMod`, `.scripts/build.ps1` together with X2ModBuildCommon, `Config/XComEngine.ini`, and `Src/<package>/Classes/*.uc`. The evaluator must scope matches to modules, combine weak evidence conservatively, and expose confidence and reasons. A directory, repository, or workspace name containing `xcom` is never sufficient. Only activated modules receive contextual XCOM project UI, Build, Problems, Logs, and language contributions.

Plugin-shaped metadata remains a first-party composition boundary, not executable authority. A generic plugin runtime, third-party loading, and extension install/remove lifecycle require a separate decision; their absence is not the primary architectural property of this feature.

### Consequences

**Positive:**

- Machine setup remains discoverable without falsely classifying ordinary projects.
- Generic workspaces and web avoid irrelevant XCOM UI and hidden polling.
- Contextual tooling has an explicit, testable activation boundary with no name-based false positives.
- The current monitor remains narrow, auditable, and non-mutating.
- Java/JDT LS/RefactorKit/IntelliJ capabilities remain independent.

**Negative:**

- Activation detection, confidence/reason reporting, module lifecycle, and false-positive fixtures must be implemented before contextual XCOM tooling appears.
- External interactive setup, XCOM-specific language/build/log flows, and a general external-root grant model remain target work.
- A future generic extension runtime may require descriptor/API migration.

---

## ADR 0008 — Global Tooling Settings and Evidence-Activated Project Contributions

### Context

Java and XCOM each combine machine/global concerns with project-specific workflows. Showing technology actions in every workspace falsely implies project relevance, while hidden browser polling performs unsupported native work. Backend handlers or plugin-shaped descriptors do not prove project detection, activation, or a plugin runtime. The BottomPanel now supports dynamic accessible contributions, so scope must be explicit rather than encoded as permanent tabs.

### Decision

Apply one scope rule consistently:

- **Global Settings** owns machine/tool availability, configuration, lifecycle, and status. Current Java Settings owns JDK/JDT LS lifecycle/status and RefactorKit availability/version/path. Current XCOM Settings owns its bounded read-only machine monitor and non-executable dry-run planner.
- **Project contributions** require explicit configuration or bounded, evidence-based module activation. Only activated modules may contribute contextual Problems, Build, Tests, Logs, Java/XCOM tools, or semantic language workflows.
- Generic desktop BottomPanel contributions are Terminal and AI Agent; generic web contributes Terminal only. No Java/XCOM global technology tabs or hidden Java/XCOM web polling are permitted.
- The dynamic BottomPanel descriptor records icon/title, core/project scope, badge/count, disabled state, and keyboard/accessibility metadata.
- In this decision's original wording, Java and XCOM detection, activation/deactivation, confidence/reasons, and contextual contribution lifetime were recorded as FUTURE/TARGET until implemented and fixture-tested. Backend capability and tool availability never count as activation evidence.
- Plugin-shaped metadata is composition data only; no generic plugin runtime is claimed.

#### 2026-07-14 Java roadmap lifecycle amendment

The preceding FUTURE/TARGET classification is retained as historical rationale for the common scoping rule. Under the [ADR 0005 roadmap lifecycle amendment](#adr-0005--hybrid-java-intelligence-with-jdt-ls-and-refactorkit), its Java activation and contextual-tooling portion is now **UNSCHEDULED TODO / frozen historical inventory**. It has no active milestone, ordering, target date, or implied commitment. Reconsideration remains subject to ADR 0005's requirement for released capability and immutable real acceptance evidence. This amendment does not change XCOM scheduling or the XCOM activation policy recorded here and in ADR 0007.

Current provider-neutral Java diagnostics and `ProblemItem` projection remain maintained as-built. Active-editor diagnostics may make the project-scoped Problems contribution visible when a ready Java context or projected items exist. That conditional Problems presentation is not Java project/module detection or activation, and it does not establish or schedule the complete activation-scoped Problems, Build, Tests, Logs, Java-tools, or contribution-removal lifecycle.

### Consequences

**Positive:**

- Generic workspaces remain relevant and quiet.
- Java and XCOM follow the same testable scope and activation rule.
- Settings communicates global tooling health without becoming a project-action console.
- The BottomPanel can host future contextual tools accessibly without unconditional technology tabs.

**Negative:**

- Existing native Java project-action handlers remain undiscoverable until activation exists.
- Detection policy, false-positive fixtures, deactivation, multi-module lifetime, and browser degradation require new implementation and tests.
- Future modules must carry explicit scope metadata and cannot register global tabs as a shortcut.

---

## ADR 0009 — Durable Digest-Approved XCOM Setup Transactions

### Context

Operational machine setup can modify external installations and generated artifacts. A process or IDE interruption between mutation and bookkeeping could otherwise leave an unknown state, while a stale preview or concurrent edit could cause approval or rollback to affect content the user did not review. The dry-run planner is intentionally descriptive and non-executable, so it cannot serve as a mutation journal or approval artifact. Rollback state may need original bytes, but proprietary paths or content must not enter exported support payloads. The concrete vanilla WOTC SDK remediation is now known and repeatable, so this decision also defines its narrow external-write authorization boundary without creating a general filesystem grant.

### Decision

Implement the XCOM setup mutation foundation as a native, durable transaction engine:

- Prepare audits vanilla SDK AppID `602410` against the stable Steam installation fingerprint and constructs exactly 15 reversible operations for the validated baseline: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game;
- persist a machine-level write-ahead journal before each mutation checkpoint and store backups by content hash, capturing the Steam build/manifest/root fingerprint and exact original bytes, hashes, modes, inventory, and symlink absence;
- bind approval to the exact transaction ID, workspace identity, monitor generation, ordered operations, and preconditions through the complete 64-character SHA-256 operation digest; this approval grants only the reviewed one-transaction external SDK write;
- reject stale hashes, unauthorized or escaping paths, workspace mismatches, generation changes, duplicate targets, altered journal digests, or a changed Steam/root fingerprint before mutation;
- expose only allowlisted atomic primitives: text/config patch, quarantine, generated file, generated directory, and symlink;
- Restore Vanilla SDK rolls back in reverse order to the exact captured baseline, verifies resulting/current states, refuses conflicting overwrites, and supports recovery followed by Prepare Again;
- retain at most 16 MiB per backup, 64 removable transactions, and 256 events; exported transaction payloads omit paths and content;
- keep the pure dry-run path separate and non-executable;
- exclude Protontricks, Steam shortcut creation, prefix work, package-manager operations, and interactive steps from the executable transaction. These remain FUTURE/TARGET, as does a general reusable external-root grant model.

### Consequences

**Positive:**

- Approval identifies the exact reviewed operation set rather than a mutable or abbreviated plan.
- Restart recovery and reverse rollback can reason from durable checkpoints and verified hashes.
- Content-addressed backups avoid duplicate storage while preserving exact fixture restoration.
- Conflict refusal protects post-apply edits, and redacted exports avoid disclosing proprietary paths/content.
- Synthetic tests demonstrate exact repeat setup cycles, reverse ordering, restart recovery, and conflict-safe retry across all primitive kinds.
- A live Prepare audit can establish executability without granting or performing Apply; the validated audit produced exactly 15 operations with no blockers.

**Negative:**

- Journals and backups consume local IDE state and require bounded retention and cleanup.
- Transactions larger than the backup policy or outside the primitive allowlist cannot proceed.
- Conflict resolution can require user review rather than automatic rollback.
- Exact-digest approval authorizes only one reviewed concrete SDK transaction; it does not create a reusable general external-root grant.
- External interactive setup remains incomplete and non-executable. No live Apply has been performed.

---
