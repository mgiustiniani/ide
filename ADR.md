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
- Operational support requires managed `java.importExternalClass` with `targetDirectory`, complete preview, exact-plan apply, discard, and rollback by opaque transaction ID. Rollback exists behind the contracts, adapters, Rust, and provider authority, but the current import UI exposes no rollback action. Preview retains placement, rendered and structured diffs, evidence, risk, diagnostics, provenance/license, unresolved dependencies, conflicts, eligibility, and staleness. Apply binds the displayed `planId` plus workspace/selection generations; backend results own transaction, changed-file, and primary-file identity used for refresh/open.
- Cancel, selection invalidation, and workspace invalidation invoke `refactor.discard`. RefactorKit is the sole external-import writer and rollback authority. The IDE does not derive target packages, reconstruct patches, perform fallback/direct writes, or disclose clipboard source, plans, or transactions to Pi or logs.
- The browser adapter reports unavailable capabilities honestly. Any future remote language service requires explicit opt-in and a separate decision.

The native RefactorKit foundation includes fixed status, scan, diagnostics, symbols, definition, and references handlers. **Settings exposes only availability/version/path.** Scan/query/navigation UI is deferred until evidence-based Java module activation can scope it contextually; backend capability is not a global product contribution.

The implemented JDT LS portion now includes provider-neutral lifecycle, document-sync, completion, hover, signature-help, and cancellation contracts; full-JDK and valid external JDT LS discovery; fixed no-shell per-workspace launch with isolated data; LSP initialization and bounded transport; typed Tauri adapters; versioned open/change/save/close; and guarded Monaco providers. Providers activate only for the exact synchronized Java model. Workspace/session/path/URI/version/request/cancel guards, optimistic versions, serialized full-text `didChange` flush-before-request, cancellation, and stale/late suppression protect the flow. Completion maps only the primary edit and suppresses additional/workspace edits and commands. Markdown is untrusted with HTML disabled; managed configuration sets `java.signatureHelp.enabled=true`. The selected JDT LS release remains external, checksum-pinned, non-bundled EPL-2.0 software; the full JDK is separately installed/licensed.

A real JDT LS smoke passed repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop. Diagnostics composition, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, Java activation, and contextual project tools were originally recorded as future work in [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md). The external-class clipboard workflow is separately operational with the installed full-capability daemon; its real temporary-workspace smoke proved no imported target or other project-content write before Apply, discard, exact apply, and byte-for-byte restoration of the tested project content through provider rollback. Provider `project.open` may create `.refactorkit/workspace.lock`, so this preview/no-write evidence does not establish complete hidden workspace-tree identity. At the time, this bounded Java-import evidence did not authorize that or any other metadata write for the then-parked `REQ-REFACTORKIT-TS-002` flow. That parking is historical and is superseded by the capability-specific option-B exception in [ADR 0011](#adr-0011--option-b-refactorkit-070-snapshot-exceptions-for-saved-snapshot-typescript-capabilities). RefactorKit remains the only custom Java intelligence tool; its project model remains internal until extraction criteria emerge.

#### 2026-07-14 roadmap lifecycle amendment

The preceding future-work statement is retained as historical rationale, but those items are no longer active milestones. Apply the following policy:

- Preserve and maintain the already-as-built Java lifecycle, synchronized documents, diagnostics/Problems behavior, completion, hover, signature help, cancellation, and workspace/session/path/URI/version/request/cancel stale guards.
- Do not schedule further IntelliSense or JDT LS expansion until RefactorKit exposes the relevant released capability and immutable real acceptance evidence validates both the provider contract and the integrated behavior. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, and contextual Java tooling are unscheduled TODO inventory, not active roadmap milestones.
- Claim a RefactorKit integration only for the exact capability that works now and passes immutable real validation. Unsupported or unintegrated operations remain TODO and are never simulated. A confirmed provider or protocol bug parks the affected requirement and is reported rather than hidden behind a fallback, approximation, or status promotion.
- **Historical option-A state, now superseded for these two requirements:** At this amendment, the audited IDE-capability bucket contained RefactorKit capability discovery and the validated Java external-class import workflow described above. The parked bucket contained [REQ-REFACTORKIT-TS-001 diagnostics](features/refactorkit/typescript-compiler-diagnostics.feature), because the confirmed protocol lost required range, failure, snapshot, attestation, and authority-correlation semantics, and [REQ-REFACTORKIT-TS-002 semantic navigation](features/refactorkit/typescript-javascript-symbol-definition.feature), because immutable `v0.6.2` validation confirmed an unauthorized `.refactorkit/workspace.lock` write. Both requirements were then not implemented pending corrected released capability and applicable real acceptance evidence. [ADR 0011](#adr-0011--option-b-refactorkit-070-snapshot-exceptions-for-saved-snapshot-typescript-capabilities) is the current authority: it supersedes option A / `WAIT_FOR_UPSTREAM_PROTOCOL_FIX` for exactly TS-001 and TS-002 through capability-specific option-B exceptions, while preserving these original blocker findings as historical rationale.
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

**Status:** Accepted; convention recognition, activation-only `.ide/xcom2.json` v1, the safe invalid-configuration diagnostic UX, and the bounded native missing-Steam Machine Settings presentation are CURRENT/AS-BUILT, with their respective requirements declared `@implemented-and-validated`. `REQ-XCOM2-MACHINE-SETTINGS-001` remains exclusively harness-only; manual confirmation, external roots, and contextual XCOM tooling remain FUTURE/TARGET.

### Context

XCOM game/SDK/Steam download state, environment health, and operational setup describe a machine, not every opened workspace. Presenting them as a global XCOM activity entry or bottom tab creates false project context; starting polling in a generic web workspace creates hidden work for a native capability the browser cannot provide. Conversely, XCOM build, diagnostics, logs, and language support are meaningful only for an XCOM project/module. The first-party feature is built-in, experimental, and plugin-shaped, but the IDE has no extension install/remove lifecycle or generic third-party runtime. Java, IntelliJ-direction work, JDT LS, and RefactorKit are independent core capabilities.

The generic target permits project/module activation after explicit configuration or conservative evidence evaluation. The first implemented slice deliberately narrowed that target to bounded convention evidence and deferred explicit configuration and manual confirmation. The exact activation-only v1 configuration contract was then approved before implementation and is now implemented without merging configuration intent into recognition confidence. Manual confirmation remains a separate concern.

### Decision

Treat the current `ide.xcom2-wotc` monitor, pure dry-run planner, and transaction controls as a **machine-level Settings contribution**. Desktop Settings may refresh and subscribe to bounded, read-only Steam evidence for AppIDs `268500`, `602410`, and optional `299990`, exporting conservative state with redacted provenance. The dry-run remains separate and non-executable. The AS-BUILT concrete SDK transaction supplies 15-operation Prepare review, exact-digest one-transaction approval, Restore Vanilla SDK, cancellation, rollback, recovery, and Prepare Again, as detailed by ADR 0009. Generic workspaces expose no XCOM activity entry or bottom tab. Web exposes no XCOM surface or hidden polling; its setup adapter reports unavailable without simulation.

The concrete fingerprinted SDK operation set is available for exact-digest approval, but no live Apply has been performed. Protontricks, Steam shortcut, prefix, package-manager, and interactive work remain FUTURE/TARGET and non-executable. This narrow transaction approval is not a general external-root grant.

Plugin-shaped metadata remains a first-party composition boundary, not executable authority. A generic plugin runtime, third-party loading, and extension install/remove lifecycle require a separate decision; their absence is not the primary architectural property of this feature.

#### Accepted and implemented first-slice module-activation policy

This Option A policy was accepted before implementation. At HEAD `5cdc9c0`, the scanner, activation state, and recognition contribution are CURRENT/AS-BUILT for the bounded first `REQ-XCOM2-MODULE-ACTIVATION-001` slice, and that requirement is declared `@implemented-and-validated`. The earlier policy approval alone was not implementation or validation evidence.

- **Platform and authority:** Detection is Linux-only and scans exactly one workspace-authorized root. It must not inspect or accept evidence from an external root or follow a path outside that authority. Matching uses exact, case-sensitive Linux names and extensions. The separate launcher policy that matches ASCII case-insensitively is intentionally not reused.
- **Dedicated read-only scanner:** A separate metadata/name scanner enumerates directory entries and reads only the metadata needed to classify names and file types. It does not consume, extend, or route through the FileTree DTO/path, and it does not parse file contents. Only regular, non-symlink files and directories are eligible. The scanner checks entry type without following symlinks; a symlink is neither traversed nor accepted as evidence, including when it points back inside the authorized root.
- **Bounds and exclusions:** The workspace root is depth 0. Entries through maximum depth 8 may be examined, and the scanner encounters at most 20,000 entries below the root. Every encountered directory entry consumes the budget whether or not it becomes accepted evidence, including excluded directories, symlinks, wrong-case names, unsupported file types, and otherwise rejected entries. A regular directory whose basename exactly matches `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`, or `.vite` is counted when encountered but is not traversed or treated as evidence.
- **Completeness:** An unreadable entry or subtree, a required descent beyond depth 8, or exhaustion of the encountered-entry budget makes the scan `partial` and emits a corresponding issue; otherwise it is `complete`. Partial regions and unreadable or unvisited entries never become evidence of absence. Every result discloses completeness and all observed limitations/issues.
- **Exact evidence and roots:** Accepted evidence has exactly five kinds. `x2proj` is a regular file `<module-root>/<name>.x2proj`, with the lowercase `.x2proj` extension. `xcommod` is a regular file `<module-root>/<name>.XComMod`, with exactly that extension case. `x2mbc-script-pair` requires both the regular file `<module-root>/.scripts/build.ps1` and regular directory `<module-root>/.scripts/X2ModBuildCommon`. `engine-config` is the regular file `<module-root>/Config/XComEngine.ini`. `unrealscript-layout` is a regular file `<module-root>/Src/<package>/Classes/<name>.uc`, with one non-empty package directory segment and the lowercase `.uc` extension. All literal path segments are exact and case-sensitive. Each match infers the canonical workspace-relative `<module-root>` shown by its pattern; evidence is grouped only under that root. No directory, repository, project, or workspace name containing `xcom` is evidence by itself.
- **Independent modules and deterministic reasons:** Multiple module roots, including nested roots, are evaluated independently. Evidence inferred for one root does not bubble to any parent or child root. Reasons are ordered by evidence kind in this exact sequence: `x2proj`, `xcommod`, `x2mbc-script-pair`, `engine-config`, `unrealscript-layout`; reasons within a kind are then ordered lexically by workspace-relative path. For the paired kind, both exact paths are reported in lexical order.
- **Decision rule:** The count is of distinct accepted evidence kinds per inferred module root, not the number of matching files. Exactly one kind produces `needs-confirmation`, medium confidence, and no contribution. At least two kinds produce `active` with high confidence. If no kind and therefore no module root is inferred, workspace recognition is `inactive` with `none` confidence. An inactive result from a partial scan means only that no kind was observed in the completed portion; it is not evidence that qualifying paths are absent. Strong observed corroboration of at least two kinds may therefore produce `active` despite partial completeness, but the result must still disclose `partial` completeness and every observed issue.
- **Lifecycle and stale results:** Run one scan when a workspace is activated and one scan when it is switched; do not poll. A consumer accepts a result only when its workspace identity, workspace generation, scan identity, and scan generation all match the current activation. Any mismatch is stale and rejected.
- **First-slice boundary and contribution:** The first slice excludes `.ide/xcom2.json`, explicit configuration, manual confirmation and confirmation persistence, external grants or roots, content parsing, Build, Problems, Logs, language support, actions, and machine Settings evidence. Machine health or setup state cannot activate a module. Only an `active` decision may dynamically enable the accessible **XCOM 2 Project** activity entry and its recognition-only panel. The panel displays the workspace-relative module root, state, confidence, ordered reasons, completeness, and limitations/issues; it implies no other contribution. `needs-confirmation` and `inactive` decisions contribute nothing.

#### Approved FUTURE/TARGET activation-only `.ide/xcom2.json` v1

This subsection records an approved target architecture decision before implementation. It is not evidence that configuration reading, activation, refresh, diagnostics, or validation exists. It supplements the implemented Option A convention path above without changing that path's evidence or current status.

- **Exact file contract:** The data model is exactly `{version: 1, target: 'wotc', moduleRoots: [...]}`. The file is strict JSON encoded as UTF-8, with a maximum size of 64 KiB and exactly the fields `version`, `target`, and `moduleRoots`. `version` must be the number `1`, `target` must be the string `wotc`, and no coercion is permitted. Duplicate keys, comments, trailing data, missing fields, extra fields, and unsupported values are rejected.
- **Configured-root constraints:** `moduleRoots` contains 1–64 unique roots. `.` is allowed. Every other root is a normalized, relative, exact-case path of at most 4096 UTF-8 bytes. It must name an existing directory, every path component must be regular and non-symlink, and its canonical result must remain contained in the authorized workspace. Multiple and nested configured roots are additive and independent.
- **Native authority and ownership:** The native side authorizes the one fixed path `.ide/xcom2.json`; callers supply neither a workspace root nor a configuration path. Configuration handling does not parse module content. The file is project-owned, read-only to the IDE, Git-shareable, and contains no secrets or machine- or tool-specific values. The IDE neither writes the file nor automatically mutates `.gitignore`.
- **Activation and evidence:** A valid configuration alone grants recognition-only `active` state with activation source `configured` and activation confidence `explicit`. Recognition confidence remains a separate `none` / `medium` / `high` value derived from Option A observations. When convention observations also exist for a configured root, the activation source is `configured-and-recognized`. The configuration reason precedes all Option A reasons; Option A's established evidence-kind and lexical ordering remains unchanged after it.
- **Invalid configuration:** Invalid or unsupported configuration grants no configured authority and does not suppress an independent Option A recognition result. Failures are exposed only through presentation-safe typed diagnostics.
- **Authority boundary:** Configuration activation creates no manual prompt or persistence record because it grants no tool, process, external, or mutation authority. External roots, weak-evidence manual confirmation, Build, Problems, Logs, language support, and actions remain separate concerns.
- **Refresh and revocation:** Configuration refresh occurs only through explicit **Workspace Refresh**, with no watch or poll. Refresh synchronously revokes prior configured state, increments the feature activation generation, jointly correlates configuration and scan results, and rejects stale or late results. Removing the file revokes the configuration basis; Option A recognition may independently remain.
- **Platform boundary:** Browser behavior is unchanged.
- **Requirements lifecycle:** The specialist FR-X2CFG-001 catalogue entry in `docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md` was reconciled to this exact activation-only v1 schema with only `version`, `target`, and `moduleRoots`; at that reconciliation point, `REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001` remained `@not-implemented`, and the documentation change was not implementation or validation evidence. It did not accept that proposal's machine/tool configuration fields or expand this decision beyond recognition-only activation.

#### 2026-07-17 configured-activation lifecycle amendment

The preceding FUTURE/TARGET and `@not-implemented` language is retained as the historical approval record. At HEAD `34d5a5e`, `REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001` is declared `@implemented-and-validated`, and the approved activation-only contract is CURRENT/AS-BUILT. This amendment changes lifecycle status, not the accepted schema or authority boundary:

- The only configuration is the project-owned, IDE-read-only `.ide/xcom2.json`. Its v1 data is exactly `{ "version": 1, "target": "wotc", "moduleRoots": [...] }`, with exactly those three fields and at most 64 KiB (65,536 bytes) of valid UTF-8. The reader rejects duplicate JSON keys, malformed JSON or trailing data, missing or extra fields, non-integral/coerced or unsupported values, duplicate roots, and invalid UTF-8.
- `moduleRoots` contains 1–64 unique entries. `.` is allowed; every other entry is a slash-separated normalized relative path of at most 4096 UTF-8 bytes with no empty, `.` or `..` component, control character, backslash, absolute/drive path, or `file:/` URI form. Each component must match an existing directory with exact case, must not be a symlink, and must remain contained under the one native-authorized workspace root. Multiple and nested roots remain independent and additive.
- A configuration-only root is `active` with source `configured` and activation confidence `explicit`; its recognition confidence remains independently `none`, `medium`, or `high` from Option A. A configured root with convention observations uses source `configured-and-recognized`, with the configuration reason ordered before the unchanged Option A reasons.
- Invalid, unsupported, unreadable, oversized, or unsafe configuration grants no configured authority and yields only a presentation-safe typed diagnostic. It neither disables nor downgrades an independent Option A result.
- Initial activation and a committed workspace switch perform their one correlated activation read. Thereafter only the explicit full **Workspace Refresh** re-reads configuration and recognition state; passive metadata/Settings refresh does not. There is no configuration watcher or poll. Full refresh synchronously revokes the previous contribution before I/O, increments activation correlation, jointly evaluates the configuration read and scan, and suppresses stale or late restoration. Removing the file therefore has no effect until full Workspace Refresh; after refresh, Option A may independently keep a root active.
- The IDE never creates, writes, reformats, or deletes this file and never mutates `.gitignore`. Configuration adds no prompt or persistence record and no tool, process, external-root, or mutation authority. The separately recorded weak-evidence manual-confirmation flow and its persistence remain FUTURE/TARGET, as do external roots, Build, Problems, Logs, language support, actions, and other contextual XCOM tools.
- Machine Settings remains independent and cannot activate a project. Browser behavior is unchanged.

#### Approved invalid-configuration diagnostic UX (historical target; now CURRENT/AS-BUILT)

This diagnostic presentation and lifecycle was approved as a FUTURE/TARGET decision before implementation. That approval alone was not implementation, progress, or validation evidence. The accepted policy remains unchanged, but its lifecycle status is superseded by the explicit 2026-07-17 amendment below.

- **Canonical presentation:** Place the warning in **Settings > Workspace > Current workspace**, immediately below that section's heading/Workspace Refresh control. Present one amber, non-color-only, atomic accessible `role="alert"` whose title is exactly **XCOM 2 project configuration needs attention**. The primary content is the human summary and remediation, always using the fixed project-file label `.ide/xcom2.json`; the exact stable typed code remains visible only as a secondary support identifier.
- **Exhaustive safe copy:** The eight stop codes map to exactly this user-facing copy:

  | Stable typed code                    | Summary                                                                      | Remediation                                                                                                                                       |
  | ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `configuration-unreadable`           | The IDE could not safely read the XCOM 2 project configuration.              | Make `.ide` a regular directory and `.ide/xcom2.json` a readable regular file, with neither entry a symbolic link, then refresh the workspace.    |
  | `configuration-too-large`            | The XCOM 2 project configuration exceeds the 64 KiB limit.                   | Reduce `.ide/xcom2.json` to 64 KiB or less, then refresh the workspace.                                                                           |
  | `configuration-invalid-utf8`         | The XCOM 2 project configuration is not valid UTF-8.                         | Save `.ide/xcom2.json` as UTF-8, then refresh the workspace.                                                                                      |
  | `configuration-invalid-json`         | The XCOM 2 project configuration is not valid JSON.                          | Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.                                                |
  | `configuration-invalid-schema`       | The XCOM 2 project configuration does not match the activation v1 structure. | Use exactly these fields once: numeric `version`, text `target`, and the `moduleRoots` list; remove all other fields, then refresh the workspace. |
  | `configuration-unsupported-version`  | This XCOM 2 project configuration version is not supported.                  | Set `version` to 1, then refresh the workspace.                                                                                                   |
  | `configuration-unsupported-target`   | This XCOM 2 project target is not supported.                                 | Set `target` to `"wotc"`, then refresh the workspace.                                                                                             |
  | `configuration-invalid-module-roots` | The configured module roots are not valid for this workspace.                | Provide 1–64 unique, exact-case workspace-relative paths to existing directories, with no symbolic links, then refresh the workspace.             |

- **No implied authority or mutation:** The diagnostic alone creates no XCOM activity, bottom contribution, badge implying activation, tool, or action. It offers no edit, open, or write action, and the IDE does not write the project file.
- **Explicit-refresh lifecycle:** Only explicit **Workspace Refresh** reevaluates this state; there is no watcher or poll. Refresh synchronously revokes the old diagnostic and configured decision, displays a neutral **Checking XCOM 2 project configuration…** state, and accepts only the exactly correlated current result. Late or stale results restore neither old diagnostics nor old configured decisions.
- **Result handling:** A valid correlated result clears the warning and may activate configured recognition. An invalid correlated result removes all configured authority. Strong existing Option A recognition (`recognized` / `high`) may remain active independently and, when its activity exists, mirrors the same complete safe warning using the atomic accessible presentation rather than a raw-code-only alert. An absent result is silent.
- **Failure and disclosure boundary:** Transport, adapter, or controller errors remain generic failures and must never be forged into one of the eight stop codes. Never render or retain configuration bytes or content canaries, submitted roots, actual absolute paths, parser/provider/native-command details, secrets, raw causes, or other internals.

#### 2026-07-17 configured-diagnostic lifecycle amendment

At exact HEAD `2ecbb29`, `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` is declared `@implemented-and-validated`, and the complete approved diagnostic policy above is CURRENT/AS-BUILT. This amendment changes lifecycle status, not the accepted presentation, safe-copy mapping, activation semantics, or authority boundary:

- The single warning remains in **Settings > Workspace > Current workspace** as one atomic accessible alert with the fixed title, `.ide/xcom2.json` label, summary, remediation, and secondary support identifier. The exhaustive eight-code mapping above is the exact current mapping.
- Only explicit **Workspace Refresh** reevaluates the diagnostic. It synchronously clears prior diagnostic and configured authority, exposes the neutral checking state, and accepts only the strictly correlated current configuration-and-recognition result; there is no watcher or poll, and a stale or late result restores nothing.
- Invalid configuration grants no configured authority and creates no activity or tool authority. Independent strong Option A recognition survives, and its recognition panel mirrors the same complete atomic warning rather than reducing it to a raw code.
- The diagnostic offers no edit, open, write, process, external-root, or project action. It neither writes project inputs nor broadens disclosure. Machine Settings remains separate and cannot activate the project.

#### Implementation and evidence

The implementation follows this policy through separate bounded components:

- [`xcom2_module_evidence.rs`](apps/desktop/src-tauri/src/commands/xcom2_module_evidence.rs) is the dedicated read-only Rust metadata/name scanner. It uses exact-case Linux convention matching, excludes symlinks from traversal and evidence, fixes depth 8 and 20,000 encountered entries, and counts but does not traverse `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`, or `.vite` directories.
- [`xcom2-module-scanner-tauri.ts`](packages/tauri-adapters/src/xcom2-module-scanner-tauri.ts) is the strict Tauri scanner adapter. It accepts only the fixed request and response schema, bounds, canonical workspace-relative paths, ordered enums, and exact workspace/scan correlation.
- [`xcom2_module_configuration.rs`](apps/desktop/src-tauri/src/commands/xcom2_module_configuration.rs) owns the fixed native read, strict JSON/UTF-8/schema checks, no-follow file and component traversal, exact-case directory lookup, containment, and stable-file checks. [`xcom2-module-configuration-tauri.ts`](packages/tauri-adapters/src/xcom2-module-configuration-tauri.ts) independently normalizes the exact safe result union and correlation without exposing native errors.
- [`module-activation.ts`](packages/web-core/src/xcom2/module-activation.ts) remains the pure Option A evaluator. [`module-configuration-activation.ts`](packages/web-core/src/xcom2/module-configuration-activation.ts) combines configured intent and convention observations while preserving independent source and confidence, deterministic reasons, Option A fallback, and typed diagnostics. [`module-configuration-diagnostics.ts`](packages/web-core/src/xcom2/module-configuration-diagnostics.ts) maps only the eight safe contract codes to the fixed presentation.
- [`useXcom2ModuleActivationController.ts`](apps/desktop/src/features/xcom2-module-activation/useXcom2ModuleActivationController.ts) jointly correlates one configuration read and one scan, revokes synchronously, and rejects late or mismatched workspace, activation, configuration-read, and scan identity/generation. The workspace controller reserves this re-read for explicit full Workspace Refresh.
- [`App.tsx`](apps/desktop/src/App.tsx) supplies the correlated diagnostic and checking state. [`Xcom2ModuleConfigurationDiagnosticAlert.tsx`](packages/ui/src/components/Xcom2ModuleConfigurationDiagnosticAlert/Xcom2ModuleConfigurationDiagnosticAlert.tsx) provides the shared atomic alert used by [`SettingsPanel.tsx`](packages/ui/src/components/SettingsPanel/SettingsPanel.tsx) and [`Xcom2ProjectRecognitionPanel.tsx`](packages/ui/src/components/Xcom2ProjectRecognitionPanel/Xcom2ProjectRecognitionPanel.tsx). The recognition panel renders source, separate confidences, ordered reasons, safe diagnostics, completeness, and issues without a bottom contribution or project action. Machine Settings remains separate.

The promoted Option A [BDD Story](features/xcom2/module-activation.feature) passed one scenario with 26 reported steps against promotion baseline `903cb1a` using the actual sandbox filesystem and a freshly built production Linux X11 Tauri release/no-bundle executable with a 1440x900 WebKit DOM viewport. Focused Rust, Spec, strict-adapter, controller, composition, and UI tests cover exact-case and symlink exclusions, fixed limits and an excluded-directory fixture, distinct-kind evaluation, name-only and one-kind false-positive refusal, one-shot correlation, accessible presentation, synchronous deactivation, and stale-result suppression. This evidence makes no application-package, bundle, installer, Wayland, other-OS/DPI, proprietary-project compatibility, content-parsing, external-root, explicit-configuration, manual-confirmation, machine-setup-correctness, Build, Problems, Logs, or language-support claim.

The configured-activation [BDD Story](features/xcom2/module-configuration-activation.feature) passed one scenario with 37 reported steps at implementation baseline `b706371`; promotion and implemented-route reconciliation are complete at HEAD `34d5a5e`. It used a scenario-owned sandbox and a fresh production Linux X11 Tauri release/no-bundle executable with an asserted 1440x900 WebKit DOM viewport. Its exact configuration fixture was 63 UTF-8 bytes with SHA-256 `53d92f8cd91d90f49a98a133b5de3ef3862b5472805248780d561e2c9b765dfb`. The run exercised configured-only activation, unchanged state before explicit refresh, synchronous revocation, stale-result suppression, exact external restoration, read-only file preservation, and contained non-symlink roots. It establishes no application package/installer, Git synchronization, watcher, Wayland or other-OS/DPI, proprietary-content compatibility, module-content parsing, external-root, manual-confirmation, machine-correctness, Build, Problems, Logs, language-support, action, or tool authority.

The configuration-diagnostic [BDD Story](features/xcom2/module-configuration-diagnostics.feature) passed one scenario with 52 reported steps against exact clean validation baseline `515122c`; requirement promotion and implemented native-route reconciliation are complete at exact HEAD `2ecbb29`. It used a scenario-owned sandbox and a freshly built production Linux X11 Tauri release/no-bundle executable with an asserted 1440x900 WebKit DOM viewport. The run exercised the atomic Settings warning, neutral explicit-refresh lifecycle, synchronous configured-authority revocation, strict stale suppression, independent high-confidence Option A survival, and complete warning mirroring in the recognition panel. Its scoped no-project-input-write assertion covered `.ide/xcom2.json` and the two Option A descriptor paths; normal application-owned `.ide/workspace.json` marker/registry metadata updates were explicitly excluded and are not XCOM configuration or evidence writes. Disclosure checks excluded configuration bytes and submitted roots, the absolute sandbox root, parser/provider/native-command details, and the scenario-owner canary or raw causes. This evidence establishes no browser behavior, application package/bundle/installer, Git synchronization, configuration watcher, Wayland or other-OS/DPI behavior, proprietary compatibility or content parsing, external-root authority, machine correctness, broader process or mutation authority, or contextual XCOM tools.

#### Approved FUTURE/TARGET native missing-Steam Machine Settings acceptance

`REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001` is a separate, approved native UI-only acceptance target. Approval records architecture and acceptance scope only; it is not implementation, progress, or validation evidence. It does not supersede, broaden, or reclassify `REQ-XCOM2-MACHINE-SETTINGS-001`, which remains unchanged and exclusively harness-only; that existing requirement provides no native GUI evidence.

- **Launch and isolation boundary:** The target starts a fresh Linux X11 production release/no-bundle executable after isolating an empty `HOME`, all XDG locations, `IDE_HOME`, and the workspace before launch. From that clean process, acceptance navigates naturally to **Settings > XCOM 2** through the unmodified application and its real Tauri/Rust calls.
- **Accessible UI-only acceptance:** Observation is limited to the rendered native WebView UI. The accessible **Settings** dialog, **XCOM 2** tab, **XCOM 2 WOTC Setup** heading, **Built-in · Experimental** badge, and focusable **XCOM 2 setup monitor details** scroll region must be present. The monitor note is exactly **Steam products were not found. Install them through Steam, then refresh.**
- **Bounded missing-product state:** The aggregate state is **Not Found** and visibly presents safe provenance, warnings, and blockers. Exactly three product cards appear, each with a **Not Found** lifecycle: **XCOM 2** (AppID `268500`), **XCOM 2: War of the Chosen Development Tools** (AppID `602410`), and **XCOM 2 Development Tools** (AppID `299990`). Product and discovery details remain redacted, unknown, or otherwise presentation-safe; this target must not infer paths or machine correctness.
- **Required-versus-optional rule:** Missing required **XCOM 2** and **XCOM 2: War of the Chosen Development Tools** products each contribute aggregate blocker evidence. Missing optional **XCOM 2 Development Tools** contributes no aggregate blocker. This decision does not freeze exact blocker copy or count beyond those bounded attribution rules.
- **Forbidden seams and claims:** Acceptance uses no IPC interception, monkeypatching, payload or call-count assertions, fake timers, polling/subscription lifecycle assertions, live Steam dependency, or filesystem mutation. It makes no application package, bundle, or installer claim; no project activation, activity, or tool claim; no refresh/reopen claim; and no machine-correctness claim.
- **Excluded transaction surface:** This slice neither freezes nor asserts **Plan Setup**, `canPlan`, the dry-run planner, transaction UI, or any transaction behavior.

#### 2026-07-18 native missing-Steam Machine Settings lifecycle amendment

The preceding FUTURE/TARGET language is retained as the historical approval record. At repository baseline `af0b858`, `REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001` is declared `@implemented-and-validated` following its promotion at `c4a9644`, based on the focused native validation PASS at exact clean HEAD `958fc0a`. The approved UI-only slice is therefore CURRENT/AS-BUILT. This amendment changes its lifecycle status and records the exact evidence-bounded presentation; it does not supersede, broaden, or reclassify `REQ-XCOM2-MACHINE-SETTINGS-001`, which remains exclusively `@implemented-not-e2e-validated` through its deterministic harness and supplies no native GUI evidence.

- **Natural native path and prelaunch isolation:** One scenario-owned sandbox supplied eight distinct empty locations before launch: `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, `IDE_HOME`, and the authorized generic workspace. A freshly built production Linux X11 Tauri release/no-bundle executable used its unmodified real App → Tauri adapter/invoke → Rust path. The person reached the monitor only through the visible **Settings** control and **Settings sections** navigation. Observation was limited to the rendered accessible WebView DOM at an asserted 1440×900 viewport.
- **Exact accessible monitor frame:** The presentation contains the accessible modal dialog **Settings**, selected **XCOM 2** tab with description **Global machine setup**, heading **XCOM 2 WOTC Setup**, badge **Built-in · Experimental**, and focusable scroll region **XCOM 2 setup monitor details**. The current exact note is **Steam products not found. Steam may be unavailable, or no monitored app manifests were discovered.** This current copy supersedes only the different proposed note copy in the historical target subsection above; that subsection remains unchanged as the approval record.
- **Exact aggregate presentation:** **Aggregate setup state** shows **Overall state — Not Found**, **Warnings — No warnings reported**, and **Steam discovery provenance — Unknown (path redacted)**. Its ordered blockers are exactly: **XCOM 2 download or installation is incomplete**; **XCOM 2 is not stable**; **XCOM 2: War of the Chosen Development Tools download or installation is incomplete**; and **XCOM 2: War of the Chosen Development Tools is not stable**.
- **Exact product presentation:** **Monitored Steam products** contains exactly three cards: **XCOM 2** / AppID `268500` / **Required** / **Not Found**; **XCOM 2: War of the Chosen Development Tools** / AppID `602410` / **Required** / **Not Found**; and **XCOM 2 Development Tools** / AppID `299990` / **Related / optional evidence** / **Not Found**. Each card presents exactly **Progress unknown**, **Unknown downloaded / Unknown total**, **Progress unknown**, **Unknown staged / Unknown total**, **Not reported**, **Unknown**, **No**, **No**, **No manifest found**, **Incomplete**, **Steam appmanifest was not found**, **Unstable**, **Product state is unavailable**, and **Blocked** for Download progress, Download bytes, Staging progress, Staging bytes, StateFlags, Size on disk, Install directory present, Download directory present, Last update, Completeness, Completeness evidence, Stability, Stability evidence, and Mutation respectively. Each card presents the ordered reasons **Product is unavailable** and **This built-in monitor is read-only**, and presents no manifest provenance or manifest, install, download, or other local filesystem path. **Blocked** and its reasons are rendered text only, not evidence of mutation behavior.
- **Evidence boundary:** The [focused BDD Story](features/xcom2/machine-settings-missing-steam.feature) passed one scenario with 22 reported steps at exact clean `958fc0a`; promotion occurred later at `c4a9644`. The Story did not intercept, monkeypatch, hook, instrument, transcribe, or count application IPC/invocations and makes no payload or call-count claim. It establishes no monitor lifecycle, polling, subscription, refresh, reopen, **Plan Setup**, `canPlan`, dry-run planner, transaction UI or behavior, project activation/activity/tool, mutation, post-launch filesystem identity or behavior, live Steam, supplied Steam fixture, machine correctness, browser, application package/bundle/installer, Wayland, other-operating-system, or other-DPI behavior claim.

### Consequences

**Positive:**

- Machine and project scope remain separate, and names alone cannot classify a workspace.
- Exact convention matching, independent canonical module roots, deterministic reason ordering, and a distinct-kind threshold make activation decisions reproducible.
- Bounded read-only scanning, no symlink traversal, explicit partial completeness, and four-part stale-result rejection constrain authority and prevent uncertain traversal from becoming false absence.
- Recognition-only activation now supports either corroborated Option A evidence or the bounded project-owned configuration while preserving independent source/confidence and leaving contextual tools for separate decisions or slices.

**Negative:**

- Depth, entry, exclusion, unreadable-path, and Linux-only limits can produce partial results or omit evidence that a broader scanner could discover.
- A single Option A evidence kind still cannot activate the recognition panel, and there is no manual confirmation path.
- External interactive setup, weak-evidence confirmation/persistence, XCOM-specific build/problem/log/language/action/tool flows, and a general external-root grant model remain target work.
- A future generic extension runtime may require descriptor/API migration.

---

## ADR 0008 — Global Tooling Settings and Evidence-Activated Project Contributions

**Status:** Accepted; XCOM recognition-only activation through convention evidence or activation-only configuration and its safe invalid-configuration diagnostic are CURRENT/AS-BUILT, Java activation remains UNSCHEDULED TODO / frozen historical inventory, and broader contextual project contributions remain FUTURE/TARGET.

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

#### 2026-07-16 XCOM recognition lifecycle amendment

ADR 0008's original FUTURE/TARGET wording is retained above as historical rationale. Its XCOM portion is now current only for ADR 0007's bounded recognition slice: one authorized-workspace metadata/name scan per generation, pure two-distinct-kind evaluation, synchronous deactivation and stale-result suppression, and the dynamic accessible **XCOM 2 Project** evidence activity. Name-only and one-kind workspaces contribute nothing, and machine Settings evidence remains independent and cannot activate recognition.

This amendment does not make configured XCOM activation or contextual tooling current. Explicit configuration, manual confirmation and persistence, external roots, content parsing, Build, Problems, Tests, Logs, language support, actions, and bottom contributions remain FUTURE/TARGET. It does not alter ADR 0005's general RefactorKit capability policy or Java activation freeze, the package-manager postponement in ADR 0007/0009, or the requirement for a separate generic plugin-runtime decision. ADR 0005's option-A parking of TS-001 and TS-002 is historical; [ADR 0011](#adr-0011--option-b-refactorkit-070-snapshot-exceptions-for-saved-snapshot-typescript-capabilities) is the current authority for those two requirements.

#### 2026-07-17 XCOM configured-activation lifecycle amendment

The preceding sentence is retained as the recognition-slice lifecycle record but is superseded for explicit activation status by ADR 0007's configured-activation amendment. Project-owned `.ide/xcom2.json` v1 is now CURRENT/AS-BUILT only for the recognition contribution, with an explicit full-Workspace-Refresh lifecycle, synchronous revocation, and stale-result suppression. Option A remains independent; invalid configuration grants no authority and cannot suppress recognized activation. Machine Settings and browser behavior remain unchanged.

Manual weak-evidence confirmation and persistence, external roots, content parsing, Build, Problems, Tests, Logs, language support, actions/tools, and bottom contributions remain FUTURE/TARGET. This amendment does not alter ADR 0005's general RefactorKit capability policy or Java activation freeze, the package-manager postponement in ADR 0007/0009, or the separate-decision requirement for a generic plugin runtime. ADR 0005's option-A parking of TS-001 and TS-002 is historical; [ADR 0011](#adr-0011--option-b-refactorkit-070-snapshot-exceptions-for-saved-snapshot-typescript-capabilities) is the current authority for those two requirements.

#### 2026-07-17 XCOM configured-diagnostic lifecycle amendment

At exact HEAD `2ecbb29`, ADR 0007's complete safe invalid-configuration diagnostic is also CURRENT/AS-BUILT and `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` is declared `@implemented-and-validated`. It remains a project-scoped presentation in **Settings > Workspace > Current workspace**, not machine Settings or a new project contribution. It follows only explicit Workspace Refresh, neutral checking, and strict stale-result rejection, with no watcher or poll. Invalid configuration grants no configured authority; strong Option A recognition may independently retain the accessible **XCOM 2 Project** activity and mirror the complete warning in its panel, but the diagnostic itself grants no activity, bottom contribution, process, write, external-root, action, or contextual-tool authority.

Machine Settings and browser behavior remain unchanged. Manual confirmation/persistence, external roots, contextual tooling, and all other exclusions above remain non-current. This amendment does not alter ADR 0005's general Java/RefactorKit lifecycle and capability policies, ADR 0007's Option A rules, the package-manager postponement in ADR 0007/0009, or the separate-decision requirement for a generic plugin runtime. ADR 0005's option-A parking of TS-001 and TS-002 is historical; [ADR 0011](#adr-0011--option-b-refactorkit-070-snapshot-exceptions-for-saved-snapshot-typescript-capabilities) is the current authority for those two requirements.

### Consequences

**Positive:**

- Generic workspaces remain relevant and quiet.
- Java and XCOM follow the same testable scope and activation rule.
- Settings communicates global tooling health without becoming a project-action console.
- The BottomPanel can host future contextual tools accessibly without unconditional technology tabs.

**Negative:**

- Existing native Java project-action handlers remain undiscoverable until activation exists.
- Current XCOM activation still provides no manual confirmation, external-root authority, or contextual project tools; those concerns require future decisions, implementation, and evidence.
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

## ADR 0010 — Deterministic Project Foundry v1 for XCOM 2

**Status:** Accepted architecture; lifecycle and evidence reconciled through exact repository HEAD `17d1d37`. `REQ-XCOM2-PROJECT-FOUNDRY-001` through `REQ-XCOM2-PROJECT-FOUNDRY-004` are declared `@implemented-not-e2e-validated` and remain harness-only, with complementary focused production Rust filesystem evidence for the Apply boundaries and strict contract/adapter evidence for REQ004's closed cleanup attestation. Preview and Apply use the same dynamic Rust `git2` renderer as their sole output authority; TypeScript strictly validates and digests the closed result and owns immutable preview custody. Apply is one-shot and atomically publishes the complete generated output set as one local destination. This local filesystem commit is not package or distribution publication: XCOM publication remains fail-closed behind separate-module extraction and licensing approval, and Foundry remains separate from machine Settings. No native chooser, WebKit/native E2E, real IPC, package, bundle, installer, Windows, build/deploy, cooking, launch, auto-open, extraction, licensing, publication, release, or distribution evidence is claimed.

### Context

Project Foundry v1 needs a deterministic plan for creating an XCOM 2 mod project from EnhancedModProjectTemplate v1.4 without executing the template, granting ambient filesystem authority, or treating local source availability as redistribution permission. The authoritative input is one pinned commit and tree in a user-selected local Git object database. Working-tree and untracked content are outside that authority.

The desired output is the semantic project topology after the template's `RUN_THIS` processing, not its wizard inputs or intermediate files. The plan must therefore define exact identity, transformations, generated content, topology, absences, fingerprints, and non-execution boundaries. The extraction-ready pack must not become a second source of template bytes, and structural separability alone cannot satisfy the licensing and publication boundary.

The first bounded increment was approved as narrower than project creation: deterministic preview and discard only through production use cases and a separate test composition. A clean-HEAD review at `9d1214d` found that the implementation does not satisfy the approved rendering authority for arbitrary valid `ModId` values: `packages/web-core` owns fixture-hardcoded approved output metadata and previews, so a non-fixture valid `ModId` can produce an internally inconsistent plan. The exact fixture evidence remains useful but cannot support a general implementation promotion. Native selection, corrected rendering, output mutation, Apply, staging, journaling, recovery, and native acceptance remain target work unless separately and honestly validated.

The approved target is Linux native desktop only. Windows implementation, evidence, and parity are postponed until the end of the project. There is no web route.

### Decision

Adopt **Project Foundry v1**. The policy below retains the accepted target architecture. The 2026-07-18 authority/evidence correction explicitly supersedes the earlier preview promotion language: no Foundry requirement is promoted by this ADR while the renderer defect remains.

#### Platform, packaging, and licensing boundary

- The target capability is Linux native desktop only. Windows implementation, evidence, support, validation, and parity are end-of-project work and must not be implied before then.
- There is no browser adapter, browser simulation, remote browser service, web application path, query-parameter route, or other web route for Foundry.
- The experimental first-party pack ID is exactly `ide.xcom2.empt-v1_4`.
- The extraction-ready pack contains only the recipe and expected immutable fingerprints. It contains no embedded EMPT/development capsule, fallback capsule, template blob, or other template bytes, even when such bytes would be marked local-only or non-distributable.
- Any publication, package, module, application bundle, or release containing this capability or template-derived material must fail closed until the XCOM capability is explicitly extracted as a separately distributable module and an applicable licensing, attribution, notices, and redistribution policy is approved. Structural extraction-readiness does not satisfy this gate.
- This approval grants no licensing clearance or redistribution permission and establishes no generic plugin runtime or third-party pack loading, installation, removal, or execution.

#### Exact source object and repository policy

- The only source revision is commit `d968be3c32b250376723563a743a120770ec5c95` with tree `cc8823fa99c0d292c4fe48a8b9463ff790176371`, resolved from a user-selected local Git object database.
- Recipe inputs are read from that committed tree, never from working-tree files. Working-tree modifications and untracked files are ignored and cannot affect the plan.
- A target implementation may use an in-process Git object reader or library. It must never spawn `git` and has no shell, network, checkout, branch-switch, worktree-mutation, or repository-mutation authority.
- Missing, unreadable, mismatched, or fingerprint-invalid commit, tree, or blob evidence refuses the operation. There is no fallback to working-tree content, the network, an embedded copy, or execution.
- **Use current workspace** is offered only when the current workspace's local object database contains that exact commit and tree. Otherwise the user must choose **Choose EMPT repository**. Selecting another repository does not switch or replace the active workspace.

#### Exact `ModId` and deterministic GUID

- `ModId` must match the exact regular expression `^[A-Za-z][A-Za-z0-9_]{0,47}$`; it is therefore 1–48 ASCII bytes.
- `ModId` is case-preserving and case-sensitive. It is never trimmed, normalized, sanitized, case-folded, or replaced with a generated alternative.
- The exact value is reused for solution, project, package, destination/path, `$Name$`, and `$ModSafeName$` identities.
- The case-insensitive Windows device names `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, and `LPT1`–`LPT9` are refused as future portability hygiene. This refusal does not claim Windows implementation, support, evidence, or parity.
- Foundry does not check SDK or game package collisions because it has no SDK/game authority; the preview must warn about that limitation.
- The project GUID is UUIDv5 in URL namespace `6ba7b811-9dad-11d1-80b4-00c04fd430c8`, using this exact UTF-8 name, where `<ModId>` is the unmodified validated value:

  ```text
  urn:ide:project-foundry:ide.xcom2.empt-v1_4:d968be3c32b250376723563a743a120770ec5c95:<ModId>
  ```

- The GUID is rendered uppercase with braces. The same rendered GUID is used in `<ModId>.x2proj` and `<ModId>.XCOM_sln`.

#### Exact semantic post-`RUN_THIS` topology

The destination is exactly `<selected-parent>/<ModId>` and contains the following 27 regular files. Every file has mode `0644`, every directory has mode `0755`, no path is a symlink, and `Content/` and `ContentForCook/` are present and empty.

```text
<ModId>/
├── .gitignore
├── <ModId>.XCOM_sln
├── .scripts/
│   ├── build.ps1
│   └── X2ModBuildCommon/
│       ├── CHANGELOG.md
│       ├── EmptyUMap
│       ├── InvokePowershellTask.cs
│       ├── LICENSE
│       ├── README.md
│       ├── XCOM2.targets
│       ├── build_common.ps1
│       ├── clean.ps1
│       └── clean_cooker_output.ps1
└── <ModId>/
    ├── <ModId>.x2proj
    ├── Content/                       # empty
    ├── ContentForCook/                # empty
    ├── ContentOptions.json
    ├── ModPreview.jpg
    ├── ReadMe.txt
    ├── Config/
    │   ├── Base/
    │   │   ├── XComEditor.ini
    │   │   ├── XComEngine.ini
    │   │   └── XComGame.ini
    │   ├── XComTemplateCreator.ini
    │   └── XComTemplateEditor.ini
    ├── Localization/
    │   ├── XComGame.int
    │   └── <ModId>.int
    └── Src/
        ├── extra_globals.uci
        └── <ModId>/Classes/
            ├── ConfigEngine.uc
            ├── Help.uc
            └── X2DLCInfo_<ModId>.uc
```

The topology explicitly excludes `.XComMod`, `.ide/xcom2.json`, Git initialization, a build profile, `RUN_THIS.bat`, `replace_text.exe`, the template root `README.md`, `ProjectIcon.ico`, `EnhancedModProjectTemplate.vstemplate`, and `Src/.gitignore`. The first four are v1 product defaults; the remaining paths are excluded template/intermediate artifacts. An existing destination is refused rather than merged, replaced, or adopted.

#### Token and transformation boundary

- The only recognized tokens are `$guid1$` for the deterministic GUID, `$Name$` and `$ModSafeName$` for the exact `ModId`, and `$Description$` for the empty string in v1.
- PowerShell variables and MSBuild `$()` expressions are never interpreted as template tokens.
- Token transformation is enabled only for these mapped source files:
  - `ProjectTemplate.x2proj` to `<ModId>.x2proj`;
  - `.scripts/build.ps1`;
  - `Config/Base/XComEditor.ini`, `Config/Base/XComEngine.ini`, and `Config/Base/XComGame.ini`;
  - `ConfigEngine.uc`, `Help.uc`, and `extra_globals.uci`;
  - `X2DLCInfo_Mod.uc` to `X2DLCInfo_<ModId>.uc`; and
  - `Mod.int` to `Localization/<ModId>.int`.
- The generated `.x2proj` directly expresses post-`RUN_THIS` semantics: remove the two `.scripts` folder entries; remove all `.scripts`, `.gitignore`, `RUN_THIS.bat`, and `replace_text.exe` content entries; set `<SolutionRoot>$(MSBuildProjectDirectory)\..\</SolutionRoot>`; retain `ScriptsDir`, `BuildCommonRoot`, and the import; and require that no recognized template token remains.
- `<ModId>.XCOM_sln` is generated with the established Visual Studio 2013/XCOM 2 configuration shape, fixed project-type GUID `{9519DC3F-12CA-4742-AC8D-A664DE90DF21}`, exact nested project path, and the deterministic project GUID.
- `ReadMe.txt` is generated as UTF-8 with LF line endings and this exact content:

  ```text
  X2ModBuildCommon v1.2.1 successfully installed.
  Edit .scripts\build.ps1 if you want to enable cooking or build against Highlander.

  Enjoy making your mod, and may the odds be ever in your favor.


  Created with Enhanced Mod Project Template v1.4

  Get news and updates here:
  https://github.com/Iridar/EnhancedModProjectTemplate
  ```

- Every untouched mapped source blob is copied byte-identically from the exact Git object by the authoritative Rust renderer.

#### Authoritative Rust renderer and TypeScript custody boundary

- One shared Rust in-process `git2` renderer is the sole output authority for both Preview and Apply. For the exact validated `ModId`, it reopens the pinned commit, tree, and required blobs from the granted local object database, verifies every expected fingerprint, dynamically performs the approved transformations and generation, and returns the complete rendered plan body together with the internal bytes for every output file.
- Preview and Apply must invoke that same renderer implementation. Neither path may reconstruct output from a parallel manifest, fixture, cached frontend plan, or separately maintained transformation implementation.
- `packages/web-core` contains no EMPT or other template-derived bytes and no fixture-hardcoded approved output paths, sizes, hashes, generated previews, or other output metadata. It must not infer authoritative output from the recipe alone.
- TypeScript receives a renderer DTO, validates its complete closed schema strictly, computes the plan digest as SHA-256 over the RFC 8785 canonical JSON plan body, and deep-freezes, retains, and displays the immutable preview. TypeScript owns validation, digest custody, approval state, and presentation; it is not output authority and cannot repair, supplement, substitute, or reinterpret renderer output.
- Apply submits only the expected digest and bound identities, including the exact `ModId` and source, parent, destination, and operation-grant identities. It sends no authoritative manifest or rendered file bytes. Rust reopens the pinned blobs, reruns the same renderer, recomputes and authoritatively verifies the complete rendered result and expected digest, and only then may enter the separately approved write transaction.
- Any malformed, incomplete, contradictory, unexpected, or non-canonical rendered plan or internal-byte result stops as `rendered-plan-invalid`. Its presentation-safe summary is **The project preview could not be validated.** Only that code and safe summary may cross the native boundary or be rendered or retained; no raw renderer, parser, validation, or other internal reason may cross, be rendered, or be retained.

#### Preview contract

Preview is the strictly validated, deep-frozen complete plan returned by the shared Rust renderer, not proof that output was created. It shows and digest-binds:

- pack ID `ide.xcom2.empt-v1_4`, Linux-only scope, and non-publishable status;
- selected source repository and grant identity, full commit and tree IDs, source fingerprint result, and the statement that working-tree and untracked content are ignored;
- exact `ModId`, deterministic GUID, selected-parent and derived absent destination identities, and operation grant identities;
- the complete directory topology at mode `0755`, including the explicitly empty `Content/` and `ContentForCook/` directories;
- all 27 files, each with path, mode `0644`, byte size, SHA-256 value, and copied/transformed/generated classification;
- exact generated `<ModId>.XCOM_sln` and `<ModId>.x2proj` content;
- the four default absences and all other explicit topology absences above; and
- warnings that there is no `.XComMod`, build, deployment, cooking, SDK/game validation, collision validation, or Windows support, and that changed or unexpected output will be preserved rather than rolled back or removed.

After strict DTO validation, TypeScript computes the plan digest as SHA-256 over a versioned RFC 8785 canonical JSON representation of all bound plan data. Rust independently recomputes and verifies that digest from the same shared renderer during Apply. Any change to source, fingerprints, grants, identities, GUID, destination, topology, mode, size, content hash, classification, generated content, warning, absence, option, or canonical-schema version produces a different plan or a refusal.

Copied PowerShell and C# files are inert output only. Preview must say that Foundry never executes them.

#### No-execution and non-authority boundary

Foundry never executes anything. It must not invoke Visual Studio, the template wizard, `RUN_THIS.bat` or any batch file, `replace_text.exe` or any PE helper, PowerShell, inline or compiled C#, template code, `git`, or any general process. It has no shell, SDK/game read or mutation, build, deployment, cooking, launch, package-manager, network, browser, or general process authority. Directly producing post-`RUN_THIS` semantics is a data transformation, not execution.

#### First bounded increment: deterministic preview and discard only

The first increment is limited to **preview and discard an exact EMPT v1.4 creation plan**:

- A separate test-only deterministic composition may supply fake native-chooser results for the source repository and selected existing parent plus a development-local external EMPT repository, while invoking the unchanged production use cases. It must not supply fixture output metadata, rendered bytes, or an operation grant: Preview must still use the shared Rust renderer, which mints the exact operation grant only after a successful exact render.
- No query parameter, environment switch, hidden command, test branch, production backdoor, alternate test-only use case, or frontend output authority may be added to production.
- The increment must cover dynamic rendering for accepted exact `ModId` values, exact local object resolution, the complete 27-file/two-empty-directory preview, fingerprints, generated content, warnings, classifications, explicit absences, and internally consistent identities, paths, bytes, sizes, and hashes.
- Cancel before or after preview writes nothing, discards the plan, and revokes the source grant, selected-parent grant, and any operation grant minted after a successful render.
- The increment has no real native source or destination selection, no native chooser acceptance, no Apply, no staging, no journal, no recovery, no filesystem output, and no execution claim.

This deterministic test tier does not establish native acceptance, completed creation, implementation of later lifecycle boundaries, or complete requirement status.

#### 2026-07-18 authority and evidence correction

The preceding first-increment language remains the historical target record, but the earlier broad preview lifecycle promotion is explicitly superseded. This correction records the discovery at clean repository HEAD `9d1214d` without rewriting the original rationale.

- The deterministic `desktop/tauri-harness` Story passed 1 scenario/35 steps at exact clean validation baseline `c88198f`. Its valid evidence is limited to the exact `FoundryPreviewFixture` fixture path and data exercised through the production desktop `App`, global **New XCOM 2 Project** control, controller, shared dialog UI, and separate deterministic composition. It was not a native chooser, native WebView GUI, real IPC, packaged-application, or E2E run.
- That exact fixture shows a 12-directory/27-file preview, two empty directories, no symlink, the fixture UUIDv5 identity, the fixture generated previews and metadata, digest custody, zero-write discard, and revocation for the supplied fake grants. These observations remain evidence only for those exact fixture values.
- The current `packages/web-core` approved metadata is hardcoded to `FoundryPreviewFixture`, including output paths, byte sizes, hashes, and generated previews. For an arbitrary other valid `ModId`, the current planner changes some bound identities while retaining fixture-owned paths, previews, and metadata, producing an internally inconsistent plan. Therefore `c88198f` is not evidence of arbitrary valid-`ModId` correctness, and it cannot justify a broad CURRENT/AS-BUILT or `@implemented-not-e2e-validated` claim.
- Current Rust `git2` code attests pinned local objects and current frontend/controller code provides Preview and Apply scaffolding, but the production path does not yet implement the shared authoritative Rust renderer specified above. Presence of scaffolding, focused tests, UI/controller state, adapters, or production code is not completion evidence.
- Promotion of `REQ-XCOM2-PROJECT-FOUNDRY-001` is suspended pending correction and new applicable evidence. `REQ-XCOM2-PROJECT-FOUNDRY-002` remains `@not-implemented` and unwired; there is no Apply validation, status promotion, filesystem-creation evidence, or native acceptance at clean HEAD `9d1214d`.
- The global Foundry dialog remains neither machine Settings nor an activated XCOM project contribution. Linux remains the only target, Windows remains end-of-project work, and there is no web route. Publication, packaging, extraction, licensing, attribution, notices, redistribution, release, and distribution remain fail-closed exactly as stated above.

#### Renderer implementation and evidence reconciliation at `6eb1cba`

The preceding `9d1214d` correction remains the historical record of the authority defect and the limits of `c88198f`; it is not the current implementation statement. At exact clean baseline `6eb1cba`, the following lifecycle and evidence facts supersede only those earlier current-fact and promotion-purpose statements. They do not change the accepted architecture or target decision:

- The shared authoritative Rust `git2` renderer is implemented for Preview in [`renderer.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/renderer.rs). It dynamically renders the complete Preview plan and retains renderer-owned internal output bytes. TypeScript strictly validates the closed renderer result, computes its canonical digest, deep-freezes it, and owns preview, approval, and presentation custody through [`rendered-plan-custody.ts`](packages/web-core/src/xcom2/project-foundry/rendered-plan-custody.ts). `packages/web-core` no longer owns template source, fixture-hardcoded approved output metadata, output bytes, generated previews, or a parallel renderer.
- `REQ-XCOM2-PROJECT-FOUNDRY-001` remains declared `@partial`. The historical `c88198f` deterministic result of 1 scenario/35 steps remains bounded evidence for the exact `FoundryPreviewFixture` path and data, but it is superseded for promotion purposes. The corrected focused dynamic [Story](features/xcom2/project-foundry.feature) is GREEN at exact baseline `6eb1cba` with 1 scenario/58 steps, including dynamic `ModId` replacement and rejection of stale fixture identity. That focused result is not an independent promotion decision: promotion/re-gate remains pending, and this ADR records no promotion.
- `REQ-XCOM2-PROJECT-FOUNDRY-002` remains declared `@not-implemented`. Its focused deterministic harness is GREEN with 1 scenario/39 steps, but the harness injects scenario-only Apply and filesystem materialization through [`xcom2-project-foundry-materializer.ts`](tests/story/support/xcom2-project-foundry-materializer.ts). Production Rust does not implement Apply, same-parent staging, journaling, fsync durability, or Linux `renameat2(..., RENAME_NOREPLACE)` commit, so the result is not production filesystem-creation evidence and cannot promote the requirement.
- No current claim is made that a native chooser GUI/E2E path is implemented or validated. The focused deterministic Stories do not establish native chooser interaction, a native WebView GUI, real chooser IPC, a packaged application, or end-to-end native acceptance.

#### Foundry lifecycle and Apply implementation reconciliation at `4363654`

The `6eb1cba` reconciliation remains the historical record of the corrected renderer before requirement promotion and before production Apply. At repository commit `4363654`, the following facts supersede only its then-current lifecycle and implementation-absence statements; the accepted authority, transaction, and exclusion decisions remain unchanged:

- `REQ-XCOM2-PROJECT-FOUNDRY-001` is now declared [`@implemented-not-e2e-validated`](features/xcom2/project-foundry.feature). Independent corrected deterministic-harness validation passed the dynamic 1-scenario/58-step Story at exact clean `606007a`; the requirements-owned promotion followed at `143fb5f`. This evidence exercises the production desktop `App`, controller, dialog, strict TypeScript rendered-plan custody, and shared authoritative Rust renderer through a deterministic harness. It establishes the corrected renderer-backed Preview/discard slice, not native chooser interaction, a native WebView GUI, real chooser IPC, a packaged application, or native E2E acceptance.
- Production Apply is now implemented by [`apply.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply.rs) and registered by [`lib.rs`](apps/desktop/src-tauri/src/lib.rs). [`xcom2-project-foundry-tauri.ts`](packages/tauri-adapters/src/xcom2-project-foundry-tauri.ts) strictly validates the authority-only Apply request and exact phase-specific result unions; [`main.tsx`](apps/desktop/src/main.tsx) injects that Apply-capable composition into the unchanged [`App.tsx`](apps/desktop/src/App.tsx), controller, and [`Xcom2ProjectFoundryDialog`](packages/ui/src/components/Xcom2ProjectFoundryDialog/Xcom2ProjectFoundryDialog.tsx). This is production composition and focused integration evidence, not proof that a native chooser, packaged executable, or GUI/E2E route ran.
- Apply consumes the one-shot operation before validating approval or touching the filesystem, revalidates source, parent, destination, grants, `ModId`, and digest, and rerenders from pinned committed Git objects through the same Rust renderer used by Preview. It compares the fresh canonical plan digest and renderer-owned output bytes with the approved operation before staging and rerenders/revalidates again immediately before commit. The frontend supplies no output manifest or rendered bytes and is not write authority.
- The Linux transaction creates the exclusive mode-`0600` sibling journal `.<ModId>.foundry-journal-<full-plan-digest>.json` and private same-parent stage `.<ModId>.foundry-stage-<full-plan-digest>`. It fsyncs each completed file, staged directories after their entries are complete, every durable journal transition, and the selected parent when sibling entries change. After exact owned-stage topology, mode, byte, digest, source, parent, destination, and authority revalidation, `renameat2(..., RENAME_NOREPLACE)` commits the stage to the still-absent destination without merge, replacement, copy-over, or fallback rename.
- Focused Rust evidence in [`apply/tests.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply/tests.rs) covers exact successful output, source preservation, one-shot consumption, staged fault cleanup, destination-race non-replacement, preservation of unverified state, and post-commit recovery reporting. On success, the selected parent retains only the exact created destination: no stage, journal, receipt file, other sibling, symlink, Git repository, IDE configuration, grant, or later Apply authority remains. The returned exact plan/destination/source/count receipt is immutable and in memory only; the dialog presents it without turning it into durable project, workspace, Settings, machine, or recent-project state. A pre-commit refusal or failure leaves the destination absent and removes only reverified transaction-owned residue; unverified state is preserved. A post-commit durability failure preserves the created destination and journal and reports `created-recovery-required`, never rollback or ordinary success.
- `REQ-XCOM2-PROJECT-FOUNDRY-002` nevertheless remains [`@not-implemented`](features/xcom2/project-foundry.feature) pending its requirements-owned promotion gate. Its deterministic Story remains GREEN at 1 scenario/39 steps, but its temporary-filesystem effect still comes from the scenario-only materializer; the focused production Rust transaction tests are the separate filesystem authority, while strict adapter, controller, App-composition, and UI tests establish their bounded layers. These complementary evidence classes must not be conflated into promotion already completed.
- No evidence at `4363654` establishes real native chooser acquisition, a native WebView GUI/E2E run, a packaged application or packaged/full build, Windows behavior, build/deploy/cook/launch behavior, licensing clearance, module extraction, publication, release, or distribution.

#### REQ002 promotion and evidence reconciliation at `61ee98f`

The accepted renderer, custody, one-shot transaction, atomic-commit, publication-gate, and Settings-separation decisions above are unchanged. This is a lifecycle and evidence amendment, not a new architectural choice. Validation counts are mutable evidence metadata and do not define the decision.

- Independent deterministic-harness promotion validation for `REQ-XCOM2-PROJECT-FOUNDRY-002` passed its focused 1-scenario/39-step Story at exact clean `fdf822c`; the requirement declaration was promoted in [`project-foundry.feature`](features/xcom2/project-foundry.feature) at `524c8d9`, and implemented-route reconciliation completed at `61ee98f`. It is now `@implemented-not-e2e-validated`, alongside `REQ-XCOM2-PROJECT-FOUNDRY-001`, and neither requirement enters a native GUI route.
- The applicable Foundry acceptance evidence is complementary: the corrected dynamic Preview Story contributes 58 steps, and the one-shot Apply Story contributes 39 steps. The Preview evidence establishes dynamic shared-renderer output and TypeScript custody; the Apply evidence establishes exact-plan approval, one call, complete 12-directory/27-file materialization in a scenario-owned temporary filesystem, immutable receipt presentation, source and sibling preservation, and no transaction residue. Neither Story alone transfers the other requirement's evidence.
- Focused production Rust filesystem acceptance remains the authority for actual pinned-EMPT creation, fresh rerendering through the same dynamic renderer, authority and digest revalidation, private same-parent staging and journaling, fsync durability, and the Linux `renameat2(..., RENAME_NOREPLACE)` commit. Apply consumes its authority once and publishes the entire verified generated output set at the single rename commit point; it never incrementally exposes a partial destination.
- “Publish” in that transaction sense means making the complete local destination visible atomically. It does not satisfy or relax the separate XCOM-module extraction, licensing, attribution, notices, redistribution, package, release, or distribution gate. The receipt creates no project, workspace, recent-project, machine, or Settings state; machine Settings remains independent and cannot activate Foundry.
- The 58-step and 39-step focused counts, and any aggregate profile count derived from them, describe the reconciled validation baseline rather than immutable architecture. This evidence establishes no real native chooser, WebKit/native GUI E2E, packaged application, package/distribution, Windows behavior, project build/deploy, cooking, or auto-open behavior.

#### Native selection and grant target

This target policy is not established by the exact fixture evidence. At `9d1214d`, adapter and Rust scaffolding did not establish its native chooser, renderer, grant-lifecycle, GUI/E2E, or Apply behavior. The `6eb1cba` reconciliation later established the shared renderer for Preview, and the `4363654` reconciliation above establishes production grant-bound Apply composition. Neither establishes real native chooser acquisition or native GUI/E2E validation:

- The current-workspace source option is available only under the exact commit/tree condition above. Otherwise a native repository chooser obtains a source grant without switching the workspace.
- The source grant authorizes only the selected repository's local object database and the exact pinned objects required by the recipe. It grants no working-tree, repository-mutation, network, process, or ambient external-root authority.
- The native destination chooser grants only the selected existing parent. It does not mint an exact-destination or write-operation grant. The only candidate destination remains the derived `<selected-parent>/<ModId>`; there is no independent destination basename.
- Only after the shared Rust renderer succeeds for the exact validated `ModId`, verifies the pinned fingerprints, and confirms the exact derived destination is absent may Rust mint an operation grant for that exact destination and its operation-specific same-parent stage/journal names. Rust binds that newly minted identity into the complete plan DTO before returning Preview. A successful new render atomically replaces and revokes any previous operation grant before its plan can be approved.
- Any `ModId` change synchronously revokes the operation grant and clears the preview plan, digest, approval, and Apply authority before further asynchronous work. The selected-parent grant may remain because it authorizes only the existing parent; it cannot authorize a derived destination until a new exact render succeeds. Source or parent replacement likewise invalidates the plan and affected grants.
- Preview binds source, selected parent, exact derived destination, and all grant identities. Apply uses the same renderer and can consume only the matching live operation grant. Changed or replaced identities cannot inherit approval.
- Grants are non-persistent and are revoked or consumed on cancel, discard, refusal, replacement, failure, or completion as appropriate. Opening the created project is a separate explicit action after successful completion.

#### Historical Apply, staging, journal, removal, and recovery target

The Apply, staging, and journal lifecycle below was originally reserved for later Stories and made no claim about increment 1. Its production implementation status is superseded by the `4363654` reconciliation above. Explicit interrupted-state discovery/recovery and post-commit removal remain separate later Stories:

- Apply is one-shot and repeat submission is disabled. Before mutation Rust uses the same shared renderer as Preview to reopen every required source blob, verify expected fingerprints, dynamically rerender the complete plan and internal file bytes for the exact `ModId`, and revalidate every grant, parent, destination, digest, and bound plan field. Any stale, changed, unreadable, absent, unexpected, malformed, internally inconsistent, or mismatched condition refuses Apply and requires a new preview; an invalid renderer result stops safely as `rendered-plan-invalid`.
- Apply stages on the same filesystem at `.<ModId>.foundry-stage-<full-plan-digest>` and records a private mode-`0600` sibling journal at `.<ModId>.foundry-journal-<full-plan-digest>.json`.
- It verifies the complete staged topology, modes, bytes, and fingerprints before atomically renaming the stage to the still-absent destination. Rename is the commit point; no merge or copy-over is permitted.
- Before rename, failure triggers cleanup only after verifying the exact operation-owned stage. Anything unverified is preserved.
- A failure after rename reports **created; recovery required** and never claims rollback.
- Post-commit removal is a separate explicit operation requiring a fresh grant. It removes the destination only after exact inventory and content verification; changed, unexpected, or unverified output is refused and preserved.
- Recovery starts only after explicit parent selection and never scans ambient paths. A valid journal may offer only: discard an exact incomplete stage; acknowledge an exact committed destination and clean the journal; or preserve and report a mismatch or orphan. Recovery never silently resumes Apply or deletes an unverified path.

#### Approved exact-preview Apply slice — historical FUTURE/TARGET record

The domain handoff assigned `REQ-XCOM2-PROJECT-FOUNDRY-002` to this approved Foundry slice as a FUTURE/TARGET architectural boundary. That approval did not itself reinstate the then-suspended `REQ-XCOM2-PROJECT-FOUNDRY-001` promotion or record Apply implementation, wiring, validation, native acceptance, status promotion, or completion evidence. The later Preview promotion and production Apply implementation facts are recorded in the explicit `4363654` lifecycle reconciliation above; REQ002 remained unpromoted at that baseline, and its later promotion is recorded only by the `61ee98f` lifecycle amendment.

This slice is one-shot **Apply the exact preview**:

- Apply is available only for one still-live preview and is bound to that preview's exact full SHA-256 plan digest. Plain-language helper text must show the exact derived destination path and explain that Foundry will create that project once. The first submission consumes the Apply authority and disables repeat submission; success, refusal, or failure requires a new preview before any later Apply attempt.
- The frontend submits only the expected preview digest and bound identities, including the exact `ModId` and grant identities, never authoritative output. Rust invokes the same shared in-process `git2` renderer used by Preview: it reopens the pinned local blobs, revalidates every expected fingerprint, dynamically renders the complete post-`RUN_THIS` plan and internal file bytes, validates the grants, selected parent, exact derived destination absence, topology, modes, sizes, hashes, classifications, generated content, warnings, absences, and canonical-schema version, and independently recomputes and verifies the RFC 8785/SHA-256 digest. A frontend DTO, manifest, claimed digest, path, rendered byte sequence, or success assertion is never trusted as filesystem-write authority. Any mismatch refuses before staging or destination commit.
- Rust keeps the selected source repository read-only and starts no process. It creates the private mode-`0600` journal and same-parent stage under the digest-bound names `.<ModId>.foundry-journal-<full-plan-digest>.json` and `.<ModId>.foundry-stage-<full-plan-digest>` with exclusive, no-follow semantics. The stage contains exactly the previewed 12 mode-`0755` destination directories, counting the destination root, and 27 mode-`0644` regular files; the sibling stage and journal mechanics are not additional destination topology.
- Durability is explicit: Rust fsyncs every completed file, the staged directories after their entries are complete, the journal at each durable phase transition, and the selected parent when sibling entries change. After exact staged revalidation, Linux `renameat2(..., RENAME_NOREPLACE)` atomically commits the stage to the still-absent destination; no check-then-replace rename, merge, copy-over, non-atomic fallback, or destination adoption is permitted. Rust then fsyncs the parent, durably completes and removes the journal, fsyncs the parent again, and only then reports success.
- A pre-commit refusal leaves the destination absent. A malformed, incomplete, contradictory, unexpected, or non-canonical renderer DTO or internal-byte result returns only `rendered-plan-invalid` with the safe summary **The project preview could not be validated.** No raw renderer, parser, validation, or other internal reason crosses the native boundary or is rendered or retained. Ordinary in-process cleanup may remove only an exact operation-owned stage that has been reverified under the existing policy; interrupted, stale, mismatched, or unverified staging/journal state is preserved. A post-rename durability failure reports **created; recovery required** rather than success or rollback.
- Successful completion returns an immutable in-memory receipt containing the exact plan digest, derived destination, source commit/tree identities, and the `12`-directory/`27`-file committed counts. The receipt creates no durable project, workspace, Settings, machine, or recent-project configuration and grants no later authority.

The slice has no repeat Apply, source-repository write, working-tree write, process execution, auto-open, project/workspace/machine configuration, build, deployment, cooking, launch, SDK/game mutation or validation, native chooser or native GUI/E2E acceptance, Windows implementation/parity, package, bundle, installer, extracted-module, licensing-clearance, publication, release, or distribution claim. The previewed template-owned files under `Config/` remain inert creation output and do not constitute IDE or tool configuration authority.

Stale-preview and interrupted staging/journal discovery and recovery, post-commit removal, and real Linux native chooser acquisition and acceptance are three separate later Stories. None is included in `REQ-XCOM2-PROJECT-FOUNDRY-002`, and the existence of the journal, removal policy, current dialog adapter, or native chooser plugin must not imply otherwise.

#### Approved destination-created-after-preview refusal slice — FUTURE/TARGET only

`REQ-XCOM2-PROJECT-FOUNDRY-003` / `AT-X2-031`, initially `@not-implemented`, is approved as an architecture-only FUTURE/TARGET Story with the working title **Refuse a destination created after Foundry Preview**. This approval records no implementation, progress, validation, or status promotion and does not alter any current implementation or evidence statement for `REQ-XCOM2-PROJECT-FOUNDRY-001` or `REQ-XCOM2-PROJECT-FOUNDRY-002`.

- **Timing and refusal:** Preview succeeds while the exact derived destination is absent and the ready preview and operation grant are shown. Before Create activation and before any Apply request, the scenario owner externally creates one exact regular, non-symlink file at the derived destination and records its exact bytes, mode, identity, and parent topology. One Create activation yields the production-shaped `result: refused`, `phase: pre-commit`, `reason: destination-present`. Directory, symlink, special-file, and commit-race variants are outside this Story.
- **Preservation, no writes, and no residue:** The refusal preserves the external conflict's bytes, mode, type, and identity exactly, plus the source repository, source working-tree canaries, and every baseline parent entry and sibling. The only parent change from the pre-Preview baseline is the scenario owner's external conflict. Foundry performs no filesystem write and leaves no Foundry destination output, stage, journal, receipt file, `.ide` state, Git repository, remembered project, or other residue. It starts no process, shell, Git process, PowerShell, network operation, build, deployment, cook, launch, or auto-open.
- **One-shot and terminal lifecycle:** The frontend synchronously consumes creation authority before calling the Apply port; Rust consumes the operation grant before destination validation. Create remains disabled, repeat activation makes no second Apply call, and exact native request reuse returns `apply-authority-consumed`. After refusal, controller grants are discarded and `revokeAll` completes. The reviewed preview may remain visible only as non-authoritative context. The session is terminal: source and destination selection, `ModId`, Preview, and Create are disabled; only Cancel is enabled, with no retry, overwrite, delete, move, open, reveal, or recovery action. Cancel and Escape have the same semantics: close the dialog, clear controlled values, preview, refusal, and authority, and leave the conflict untouched. A new dialog, new selections, and a successful new Preview are required. The modal focus trap remains active, Cancel remains keyboard accessible, and close returns focus to `New XCOM 2 Project`.
- **Exact accessible presentation:** The refusal renders exactly one atomic accessible `role="alert"`, with no nested alert, no color-only meaning, and a structurally identified title. The same alert contains exactly these fixed four fields:
  - Title: `Project location conflict`
  - Summary: `The final project location is no longer absent. Foundry did not replace or change the existing item, and this approved preview cannot be retried.`
  - Remediation: `Cancel and review or move the existing item. Then reopen Project Foundry, choose an absent final project location, and preview again.`
  - Support code: `foundry-apply-destination-present`
- **Disclosure boundary:** The alert exposes only those fixed four fields. It discloses no conflict bytes or metadata, harness or temporary root, listings or siblings, stage or journal names or paths, Tauri command, Rust or provider identity, errno, stack, raw cause, arbitrary native detail, persisted diagnostic or log, or support bundle. Already reviewed controlled Preview facts may remain until Cancel; the refusal introduces no new filesystem information.
- **Provider-neutral mapping:** The presentation mapper has one bespoke `destination-present` mapping and a generic, non-interpolating fallback for every other current refusal, failure, or recovery value. Implementation will later collapse this boundary into table tests; no other bespoke semantics are approved now. The exact fallback fields are Title `Project creation needs attention`, Summary `Foundry could not complete or safely confirm project creation. This approved preview cannot be retried.`, Remediation `Cancel and leave the destination unchanged. Contact support before trying again.`, and support code `foundry-apply-unavailable`. The existing atomic commit-race remains the separate `atomic-commit-failed` behavior.
- **Future evidence split, not current evidence:** The deterministic harness will own the timing, single Apply call, terminal consumed UI, exact accessibility and copy, disclosure boundary, fingerprints and no residue, and Cancel/grant lifecycle. Complementary focused production Rust tests will own refusal when the destination is created after Preview but before transaction writes, exact preservation, and proof that subsequent reuse of the same request returns `ApplyAuthorityConsumed` while the preserved state remains unchanged and no stage or journal residue exists. Neither evidence target is claimed as present by this approval.

Explicitly excluded are all other stale source, grant, parent, digest, or `ModId` cases; stage or journal conflicts; commit races; pre-commit failure and cleanup-residue matrices; interruption, restart, discovery, recovery, or removal; `created-recovery-required`; in-flight Cancel; native chooser or WebKit E2E; real IPC or package evidence; Windows; build, deployment, cooking, launch; and publication or licensing.

#### REQ003 promotion and evidence reconciliation at `b267803`

The preceding FUTURE/TARGET section is retained as the historical approval and no-evidence record. At exact reconciliation HEAD `b267803`, `REQ-XCOM2-PROJECT-FOUNDRY-003` and its accepted destination-created-after-Preview terminal refusal are CURRENT/AS-BUILT within the bounded evidence below. This amendment supersedes only the historical section's lifecycle, implementation-absence, and future-evidence statements; it does not change the accepted behavior or broaden its evidence boundary:

- [`REQ-XCOM2-PROJECT-FOUNDRY-003`](features/xcom2/project-foundry.feature) / `AT-X2-031` is now declared `@implemented-not-e2e-validated`. At exact clean focused baseline `a1c6b78`, its deterministic desktop/Tauri-harness Story passed with exactly 1 scenario/53 steps. The declaration was promoted at `53c98f8`, and the implemented harness-route reconciliation completed at `b267803`. This is harness evidence through the production strict TypeScript adapter, one-shot Apply use case, controller, desktop `App`, and dialog over a deterministic backend and scenario-owned temporary filesystem, not a native chooser, WebKit/native GUI E2E, real IPC, packaged-application, package, bundle, or installer run.
- The implemented terminal boundary has Preview complete while the exact destination is absent, followed by the scenario owner's creation of one exact regular, non-symlink destination file. One Create activation makes exactly one Apply call and receives exactly `result: refused`, `phase: pre-commit`, `reason: destination-present`. The conflict's type, mode, bytes, hash, and filesystem identity; the source repository and working-tree canaries; and the destination parent's baseline entries and siblings are preserved. The scenario-owner conflict is the only parent change. Foundry performs no destination, source, sibling, stage, journal, receipt, IDE-state, Git-repository, remembered-project, or other filesystem write, starts no process or shell, performs no Git-process or network operation, and leaves no Foundry output, stage, journal, receipt, grant, transaction, or other residue.
- Creation authority is synchronously consumed in the frontend before the Apply call, and Rust consumes the native operation grant before destination validation. Create remains disabled, and repeated UI activation makes no second call. Complementary focused production Rust evidence in [`apply/tests.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply/tests.rs) reuses the exact native request and receives `ApplyAuthorityConsumed`; the destination, source, parent, and siblings remain unchanged and no stage or journal residue appears. The deterministic Story and focused Rust test are complementary evidence classes and are not native GUI/E2E evidence.
- The implemented presentation is exactly one atomic accessible `role="alert"`, without a nested alert or color-only meaning and with a structurally identified title. Its four fixed fields are Title `Project location conflict`, Summary `The final project location is no longer absent. Foundry did not replace or change the existing item, and this approved preview cannot be retried.`, Remediation `Cancel and review or move the existing item. Then reopen Project Foundry, choose an absent final project location, and preview again.`, and support code `foundry-apply-destination-present`. The provider-neutral, non-interpolating fallback remains exactly Title `Project creation needs attention`, Summary `Foundry could not complete or safely confirm project creation. This approved preview cannot be retried.`, Remediation `Cancel and leave the destination unchanged. Contact support before trying again.`, and support code `foundry-apply-unavailable`; this mapping does not establish the excluded failure matrices.
- The disclosure boundary is unchanged: the refusal introduces no conflict bytes, mode, type, identity, or other metadata; harness path or temporary root; destination listing or sibling information; stage or journal name or path; Tauri command; Rust, provider, or backend identity; errno, stack, raw cause, or arbitrary native detail; persisted diagnostic or log; or support bundle. Only already reviewed controlled Preview facts may remain visible as non-authoritative context.
- The refusal is terminal. Source and destination selection, `ModId`, Preview, and Create remain disabled; only keyboard-accessible Cancel is enabled, with no retry, overwrite, delete, move, open, reveal, or recovery action. The modal focus trap remains active, controller grants are discarded, and `revokeAll` completes. Cancel and Escape identically clear controlled values, Preview, refusal, digest, approval state, and authority; close the dialog; preserve the conflict, source, parent, and siblings; leave no grant; and return focus to **New XCOM 2 Project**. A new dialog, new selections, and a successful new Preview are required for another attempt.

This promotion establishes no other stale source, grant, parent, digest, `ModId`, destination-type, or commit-race conflict; stage or journal conflict; pre-commit failure, cleanup, or other failure matrix; interruption, restart, discovery, recovery, removal, or `created-recovery-required` behavior; or in-flight Cancel. It establishes no native chooser, WebKit/native E2E, real IPC, Windows, packaged app, package, bundle, installer, build, deployment, cooking, launch, auto-open, publication, licensing, release, or distribution evidence.

#### Approved exact second-file stage-write cleanup attestation — FUTURE/TARGET only

`REQ-XCOM2-PROJECT-FOUNDRY-004` / `AT-X2-032` is approved as an architecture-only FUTURE/TARGET Story with the working title **Report verified cleanup after the exact second-file Foundry stage-write failure**. This approval records no implementation, progress, validation, declaration, status promotion, or completion evidence. It changes no CURRENT/AS-BUILT statement, status, or evidence boundary for `REQ-XCOM2-PROJECT-FOUNDRY-001` through `REQ-XCOM2-PROJECT-FOUNDRY-003`.

- **One exact injected boundary:** After one still-live exact Preview is approved and Create consumes its one-shot frontend and native authority, a test-owned fault injects `stage-write-failed` at exact `before-file-create` occurrence `2`. At that point all `11` child directories and the first ordered output, exact `.gitignore`, must already be complete, fsynced, and verified; `.scripts/X2ModBuildCommon/CHANGELOG.md`, the second ordered output, must not have been created. The injection facility is evidence scaffolding only and must add no production query route, environment switch, hidden command, alternate use case, or user-triggerable fault control.
- **Closed cleanup-attestation contract:** Every strict `result: failed`, `phase: pre-commit` Apply result must contain the mandatory field `cleanupStatus`; its complete value set is exactly `verified-complete` and `not-verified`, with no omitted, `null`, defaulted, inferred, or additional value. The exact positive result for this Story is `result: failed`, `phase: pre-commit`, `reason: stage-write-failed`, `cleanupStatus: verified-complete`. `cleanupStatus` attests only the bounded cleanup outcome; it does not turn failure into success, restore consumed authority, or permit retry of the approved Preview.
- **Positive attestation gate:** `verified-complete` is permitted only when cleanup has revalidated the operation-owned `OwnedStage` device/inode/type identities and exact tracked topology, removed its tracked entries deepest-first, revalidated and removed the exact operation-owned journal identity, observed the exact digest-bound stage name absent, observed the exact digest-bound journal name absent, observed the derived destination absent, and successfully fsynced the same revalidated selected parent after the sibling removals. Absence means an exact no-follow metadata observation of `NotFound`; an unreadable, ambiguous, mismatched, replaced, or otherwise unverified entry is not absence. Every condition is conjunctive, and no ignored cleanup or parent-sync result may contribute to the attestation.
- **Fail-closed outcome:** Any failed removal, identity/topology mismatch, unexpected entry, absence-check error, destination-presence or destination-check error, stale parent, or parent-directory open/fsync failure yields only `cleanupStatus: not-verified`. Existing `cleanup-failed` behavior is not a synonym for verified cleanup and receives no safety claim. The journal-setup error branches that currently discard exact-journal removal and parent-sync outcomes must also fail closed rather than infer cleanup from an attempted operation. Unverified state remains preserved for separate explicit recovery; it is never deleted merely to obtain the positive status.
- **Exact bespoke terminal alert:** Only a strictly validated result with the exact tuple `failed` / `pre-commit` / `stage-write-failed` / `verified-complete` receives one bespoke, non-interpolating, atomic accessible `role="alert"`, with no nested alert or color-only meaning and with a structurally identified title. Its fixed fields are Title `Project creation stopped safely`; Summary `Foundry could not finish writing the project, but verified that the final project location and temporary transaction items are absent. This approved preview cannot be retried.`; Remediation `Cancel, then reopen Project Foundry and preview again before trying to create the project.`; and support code `foundry-apply-stage-write-cleanup-verified`.
- **Generic fallback for everything else:** `cleanupStatus: not-verified`, `reason: cleanup-failed`, every refusal, every post-commit or recovery result, every other strict result tuple, and every malformed, incomplete, contradictory, unknown, or legacy result use only the existing fixed non-interpolating fallback: Title `Project creation needs attention`; Summary `Foundry could not complete or safely confirm project creation. This approved preview cannot be retried.`; Remediation `Cancel and leave the destination unchanged. Contact support before trying again.`; and support code `foundry-apply-unavailable`. Unknown data is rejected rather than repaired or upgraded, and neither `stage-write-failed` alone nor filesystem inspection by TypeScript may manufacture `verified-complete`.
- **Terminal and disclosure boundary:** The failure consumes the approved Preview and remains terminal under the existing Foundry failure lifecycle: source and destination selection, `ModId`, Preview, and Create stay disabled; only keyboard-accessible Cancel and equivalent Escape dismissal remain; no retry, cleanup, delete, overwrite, move, open, reveal, or recovery action is offered. The bespoke alert discloses no selected, destination, stage, journal, harness, or temporary path; digest, grant or filesystem identity; directory or file inventory; source bytes or canary; Tauri command; Rust/provider/backend identity; fault injector; errno, stack, raw cause, arbitrary native detail, persisted diagnostic/log, or support bundle. Already reviewed controlled Preview facts may remain only as non-authoritative context.
- **Required future evidence split:** A focused production Rust filesystem test must own the exact occurrence-`2` ordering, the complete/fsynced/verified `11` child directories and `.gitignore`, absence of `CHANGELOG.md` before injection, identity/topology-safe deepest-first cleanup, exact stage/journal/destination absence, successful final selected-parent fsync, consumed native request reuse, and preservation of source, working-tree canaries, baseline parent siblings, and grants. Strict adapter/contract tests must own the closed mandatory field and two-value enum, reject malformed or additional states, and prove the exact positive tuple versus exhaustive generic fallback. A deterministic desktop/Tauri-harness Story must own one Apply call, consumed terminal UI, exact accessible copy, disclosure, Cancel/Escape, and no retained authority. These are future evidence obligations, not evidence claimed by this approval.
- **Current evidence and precise gap:** At inspected repository HEAD `d0c6c7c`, [`apply.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply.rs) returns pre-commit failure with only `result`, `phase`, and `reason`. Its ordinary cleanup revalidates recorded `OwnedStage` identity/topology, removes tracked entries deepest-first, and removes the exact recorded journal identity, but ignores the final selected-parent sync result; special journal-setup cleanup also ignores removal and sync outcomes. The parameterized [`apply/tests.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply/tests.rs) source injects `before-file-create` at occurrences `1` and `27` and asserts destination absence, empty parent, and consumed-request reuse, while its tampered-stage test returns `cleanup-failed` and preserves unverified stage/journal state. Those current facts neither supply occurrence-`2` evidence nor a cleanup attestation, strict `cleanupStatus` contract, bespoke mapping, Story result, implementation claim, or validation claim for this target.

Explicitly excluded are other `before-file-create` occurrences; other directory, file, journal, sync, verification, parent, rename, commit, and post-commit fault points; destination conflicts governed by `REQ-XCOM2-PROJECT-FOUNDRY-003`; broad pre-commit failure/cleanup matrices; cleanup of tampered, mismatched, stale, interrupted, orphaned, or otherwise unverified state; interruption, restart, discovery, recovery, removal, and `created-recovery-required`; in-flight Cancel; real native chooser acquisition; WebKit/native GUI E2E; real IPC; packaged application, package, bundle, or installer evidence; Windows; build, deployment, cooking, launch, or auto-open; and extraction, licensing, publication, release, or distribution claims.

#### REQ004 pre-promotion implementation and evidence reconciliation at `bd756a9`

The preceding FUTURE/TARGET section is retained as the historical approval and no-evidence record. At exact repository HEAD `bd756a9`, the following current implementation and evidence facts supersede only that section's implementation-absence, evidence-gap, and future-evidence statements. They do not promote `REQ-XCOM2-PROJECT-FOUNDRY-004`: it remains declared `@not-implemented`, and all evidence in this amendment remains pre-promotion evidence pending independent requirements-owned promotion.

- Production Rust now defines every `ApplyFoundryProjectResult::Failed` value as `phase: pre-commit` with mandatory `cleanupStatus`; the complete serialized value set is exactly `verified-complete` and `not-verified`. The strict Tauri adapter accepts only the exact four-field failed result and those two values, while web-core retains that closed value in the consumed terminal failure state. Omitted, `null`, malformed, additional, contradictory, unknown, and legacy values are rejected rather than defaulted, repaired, inferred, or upgraded.
- Production cleanup permits `verified-complete` only for `stage-write-failed` after an operation-owned stage existed and the conjunctive cleanup outcome is verified. [`apply.rs`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply.rs) revalidates the tracked stage device/inode/type identities and exact topology, removes tracked entries deepest-first, revalidates and removes the exact journal, observes the exact stage, journal, and destination absent with no-follow `NotFound` checks, and successfully fsyncs the same revalidated selected parent. Every other reason, incomplete removal, failed absence observation, parent-identity or parent-fsync uncertainty, and early journal-setup branch yields `not-verified`; unverified state receives no positive cleanup claim.
- The current provider-neutral presentation mapper admits to the bespoke atomic alert only a strictly validated object whose own fields are exactly `result`, `phase`, `reason`, and `cleanupStatus`, with the corresponding values `failed` / `pre-commit` / `stage-write-failed` / `verified-complete`. Its fields remain exactly Title `Project creation stopped safely`; Summary `Foundry could not finish writing the project, but verified that the final project location and temporary transaction items are absent. This approved preview cannot be retried.`; Remediation `Cancel, then reopen Project Foundry and preview again before trying to create the project.`; and support code `foundry-apply-stage-write-cleanup-verified`. The separately approved exact `destination-present` tuple retains its `REQ-XCOM2-PROJECT-FOUNDRY-003` conflict presentation. Every other strict or untrusted input receives the unchanged generic `Project creation needs attention` / `foundry-apply-unavailable` presentation, without interpolation or a manufactured safety claim.
- At exact commit `bd756a9`, the focused deterministic Story passed exactly `1` scenario and `66` steps. The Story drives the production desktop `App`, controller, preview and Apply use cases, terminal UI, exact alert copy and accessibility, disclosure boundary, one Apply call, consumed Create behavior, grant revocation, Cancel/Escape equivalence, source and parent preservation, and no residue through a separate deterministic backend. It does not substitute that backend for production filesystem authority.
- Complementary focused production Rust evidence in [`exact_second_file_failure_attests_only_after_verified_durable_cleanup`](apps/desktop/src-tauri/src/commands/xcom2_project_foundry/apply/tests.rs) owns exact `before-file-create` occurrence `2`: all `11` child directories and the first ordered `0644`, 17-byte `.gitignore` with SHA-256 `1a0a301b6ced334acafddaf76181e4ac1b46692c04627fe335a60182d7f1f9b8` are complete, fsynced, and verified before the absent second output `.scripts/X2ModBuildCommon/CHANGELOG.md`. It proves the exact verified stage/journal/destination cleanup and final selected-parent durability, preserves source and baseline sibling topology and identities, then reuses the exact native request and receives `ApplyAuthorityConsumed` with the final state unchanged. Focused fail-closed Rust tests separately prove cleanup and parent-sync uncertainty return `not-verified`; strict adapter, contract, controller, composition, and UI tests remain complementary layer evidence.
- Because no independent promotion has occurred, the inventory and routing remain unchanged: `17` total requirements with `9` validated, `5` harness-only, `0` partial, and `3` not implemented; implemented routes remain `2` web, `5` harness with `199` reported steps, and `7` native with `198` reported steps. REQ004 adds no implemented route and establishes no native chooser, WebKit/native GUI E2E, real IPC, packaged-application, package, bundle, installer, Windows, build/deploy, cooking, auto-open, extraction, licensing, publication, release, or distribution evidence.

#### REQ004 promotion and route reconciliation at `17d1d37`

The preceding FUTURE/TARGET and `bd756a9` pre-promotion sections are retained as the historical approval and pre-promotion evidence record. Independent requirements-owned validation passed the focused REQ004 Story at exact clean baseline `4c1bc4a`; the feature declaration was promoted at `2c46a3c`, and implemented harness-route/scaffolding reconciliation completed at exact repository HEAD `17d1d37`. These events supersede only the earlier lifecycle, pending-promotion, and aggregate-routing statements: `REQ-XCOM2-PROJECT-FOUNDRY-004` is now CURRENT/AS-BUILT within the exact evidence boundaries below and is declared `@implemented-not-e2e-validated`, harness-only.

- The focused deterministic desktop/Tauri-harness Story passed exactly `1` scenario and `66` steps. It drives the production desktop `App`, controller, preview and one-shot Apply use cases, strict TypeScript adapter, and shared UI over a separate deterministic backend for the exact `failed` / `pre-commit` / `stage-write-failed` / `verified-complete` tuple. This harness evidence owns the single Apply call, consumed terminal lifecycle, fixed accessible alert and disclosure boundary, grant revocation, Cancel/Escape equivalence, and no-retained-authority presentation; it is not production filesystem authority.
- Complementary focused production Rust filesystem evidence owns exact `before-file-create` occurrence `2`: all `11` child directories and the first ordered `.gitignore` are complete, fsynced, and verified while the second ordered `.scripts/X2ModBuildCommon/CHANGELOG.md` is absent. It owns operation-bound device/inode/type identity and exact-topology revalidation, deepest-first tracked cleanup, no-follow verification that the exact stage, journal, and destination are absent, successful final fsync of the same revalidated selected parent, preservation of the source and parent identities/topology, and reuse of the consumed exact native request as `ApplyAuthorityConsumed` with final state unchanged.
- Complementary strict contract and adapter evidence owns mandatory `cleanupStatus` on every failed pre-commit result, its closed exact `verified-complete` / `not-verified` value set, rejection of omitted, `null`, malformed, additional, contradictory, unknown, and legacy states, and the exact positive tuple versus the generic rejection/fallback matrix. Neither TypeScript nor `stage-write-failed` alone manufactures a verified cleanup claim; every other strict or invalid cleanup outcome receives no safety wording, while REQ003's separately required `destination-present` presentation remains unchanged.
- The implemented inventory is now `17` total requirements: `9` validated, `6` harness-only, `0` partial, and `2` not implemented. Implemented routing is `2` web, `6` harness, and `7` native; the deterministic desktop/Tauri-harness aggregate is exactly `6` scenarios and `265` steps.

This promotion establishes no other injection occurrence or fault/failure matrix; no cleanup of tampered, mismatched, stale, interrupted, orphaned, or otherwise unverified state; and no interruption, restart, discovery, recovery, or removal matrix. It establishes no native chooser, WebKit/native E2E, real IPC, packaged application, package, bundle, installer, Windows, build, deployment, cooking, launch, auto-open, extraction, licensing, publication, release, or distribution evidence.

#### Requirements and acceptance handoff

The requirements owner assigns stable requirement identifiers and statuses; this ADR does not originate or independently promote them. At repository commit `4363654`, `REQ-XCOM2-PROJECT-FOUNDRY-001` was declared `@implemented-not-e2e-validated` after independent corrected deterministic-harness validation at exact clean `606007a` and requirements-owned promotion at `143fb5f`; `REQ-XCOM2-PROJECT-FOUNDRY-002` was still `@not-implemented`. REQ002's independent focused validation passed at exact clean `fdf822c`, its requirements-owned declaration was promoted at `524c8d9`, and its harness-route reconciliation completed at `61ee98f`. REQ003's independent focused validation passed at exact clean `a1c6b78`, its declaration was promoted at `53c98f8`, and its harness-route reconciliation completed at `b267803`. REQ004's independent requirements-owned focused validation passed at exact clean `4c1bc4a`, its declaration was promoted at `2c46a3c`, and its harness-route reconciliation completed at `17d1d37`. All four requirements are now `@implemented-not-e2e-validated` and remain harness-only. Target approval, production implementation, focused tests, documentation reconciliation, status promotion, and route reconciliation remain distinct evidence and lifecycle events.

The first bounded Story establishes deterministic Preview and discard: exact source commit/tree and dirty-worktree independence; dynamic correctness for accepted exact `ModId` values; one shared Rust renderer returning the complete plan body and internal file bytes; strict TypeScript DTO validation, RFC 8785/SHA-256 digest custody, deep-freeze and display; exact topology, modes, sizes, hashes, classifications, generated content, warnings, and absences; strict no-execution; and cancel/discard with zero mutation and correct grant revocation. The historical `c88198f` result remains superseded for promotion purposes. The corrected focused Story passed 1 scenario/58 steps at `6eb1cba`, independent validation passed at `606007a`, and promotion completed at `143fb5f`, justifying only the current harness-level declaration.

The second Story establishes the approved one-shot Apply behavior at the harness level: accessible exact-plan approval, one call, complete temporary-filesystem output, in-memory receipt, and no-residue presentation semantics. Its focused Story passed 1 scenario/39 steps at `fdf822c`; complementary focused Rust tests establish actual pinned-EMPT creation through shared-renderer rerender/revalidation and the staged, journaled, fsynced, non-replacing Linux transaction, while strict adapter, controller, App-composition, and UI tests establish their respective integration boundaries. These bounded evidence classes justify only `@implemented-not-e2e-validated`; they do not establish native chooser, WebKit E2E, package/distribution, Windows, build/deploy, cooking, or auto-open behavior.

The third Story's separately approved FUTURE/TARGET `REQ-XCOM2-PROJECT-FOUNDRY-003` / `AT-X2-031` destination-created-after-Preview refusal boundary remains above as historical rationale. Its initial `@not-implemented` and future-evidence statements are superseded only by the explicit [`b267803` lifecycle amendment](#req003-promotion-and-evidence-reconciliation-at-b267803): it is now `@implemented-not-e2e-validated` on the bounded deterministic-harness plus focused Rust evidence recorded there. This promotion does not modify the REQ001 or REQ002 implementation, validation, or evidence record.

The fourth Story's separately approved FUTURE/TARGET `REQ-XCOM2-PROJECT-FOUNDRY-004` / `AT-X2-032` exact second-file stage-write cleanup-attestation boundary also remains above as historical rationale. Its initial `@not-implemented`, no-evidence, pending-promotion, and pre-promotion aggregate statements are superseded only by the explicit [`17d1d37` lifecycle amendment](#req004-promotion-and-route-reconciliation-at-17d1d37): it is now `@implemented-not-e2e-validated` on the bounded deterministic-harness, focused production Rust filesystem, and strict contract/adapter evidence recorded there. This promotion does not broaden REQ001 through REQ003 or transfer native GUI/E2E or filesystem authority to the harness.

Still-later stories cover, independently:

1. all other stale source, grant, parent, destination, plan, digest, and `ModId` refusal matrices, including stage/journal conflicts and pre-commit failure/cleanup-residue matrices, together with explicit-parent interrupted staging/journal discovery and recovery;
2. conflict-refusing post-commit removal under a fresh exact grant;
3. real Linux native source and existing-parent chooser acquisition, grant lifecycle, and native GUI/E2E acceptance through the unchanged production route;
4. remaining missing/mismatched object and invalid `ModId` refusal coverage not assigned to the Apply slice;
5. the extraction boundary and fail-closed package/publication/release gate; and
6. Windows implementation and parity at the end of the project only.

### Consequences

**Positive:**

- One exact commit and tree, one exact `ModId`, deterministic UUIDv5 identity, and a complete canonical preview make the proposed project independently inspectable without executing template tooling.
- The pack remains structurally extractable without embedding a second copy of EMPT source bytes.
- Direct post-`RUN_THIS` data semantics exclude wizard intermediates and define one exact 27-file destination.
- The corrected boundary gives Preview and Apply one native rendering authority while keeping TypeScript responsible only for strict DTO validation, digest custody, immutable approval state, and presentation.
- Exact-fixture evidence can remain useful without being overgeneralized to arbitrary valid `ModId` rendering or native chooser evidence.
- Exact-root grants, shared-renderer revalidation, staged atomic commit, durable journaling, conflict refusal, and receipt semantics have clear implemented boundaries, while explicit interrupted-state discovery/recovery and removal remain separate.
- Linux-only and no-web boundaries prevent premature Windows, native-acceptance, and browser claims.

**Negative:**

- `REQ-XCOM2-PROJECT-FOUNDRY-001` is only `@implemented-not-e2e-validated`: corrected deterministic harness evidence does not establish a native chooser, native GUI/E2E, or packaged application.
- `REQ-XCOM2-PROJECT-FOUNDRY-002` is only `@implemented-not-e2e-validated`: its promotion and complementary focused evidence do not establish native chooser or WebKit E2E behavior.
- `REQ-XCOM2-PROJECT-FOUNDRY-003` and `REQ-XCOM2-PROJECT-FOUNDRY-004` are also only `@implemented-not-e2e-validated`: their exact conflict and verified-cleanup evidence does not establish native chooser, WebKit/native E2E, broader failure/cleanup/recovery matrices, or packaged behavior.
- Users will need the exact local commit and tree; missing or mismatched object evidence stops planning rather than falling back.
- The conservative `ModId` grammar and device-name refusal reject names that broader filesystems might accept, and Foundry cannot validate SDK/game collisions.
- Exact plan binding means any relevant source, grant, destination, identity, topology, warning, or content change requires a new preview.
- Transaction cleanup deliberately preserves unverified staging or generated output for recovery review, and later recovery/removal flows must retain the same conflict-safe rule.
- Packaging, publication, and release remain blocked even when structural extraction-readiness or local deterministic evidence exists.
- Windows work waits until the end of the project, and no web route is planned.

---

## ADR 0011 — Option-B RefactorKit 0.7.0-SNAPSHOT Exceptions for Saved-Snapshot TypeScript Capabilities

**Status:** Accepted as user-approved exceptions for `REQ-REFACTORKIT-TS-001` diagnostics and `REQ-REFACTORKIT-TS-002` semantic navigation. For each requirement, the prior option-A / `WAIT_FOR_UPSTREAM_PROTOCOL_FIX` parking decision is superseded. Both requirements are declared `@implemented-not-e2e-validated`, not `@implemented-and-validated`. This amendment supersedes the `REQ-REFACTORKIT-TS-001` parked-bucket statement in ADR 0005 and the earlier TS-002-only scope of this ADR; it does not extend the exception to any other RefactorKit capability.

### Context

[ADR 0005](ADR.md#adr-0005--hybrid-java-intelligence-with-jdt-ls-and-refactorkit) parked `REQ-REFACTORKIT-TS-001` ([`features/refactorkit/typescript-compiler-diagnostics.feature`](features/refactorkit/typescript-compiler-diagnostics.feature)) because the then-validated protocol lost required range, failure, snapshot, attestation, and authority-correlation semantics. It also parked `REQ-REFACTORKIT-TS-002` ([`features/refactorkit/typescript-javascript-symbol-definition.feature`](features/refactorkit/typescript-javascript-symbol-definition.feature)) because `v0.6.2` validation observed an unauthorized `.refactorkit/workspace.lock` write from `project.open`. No immutable released provider satisfying either accepted contract was available.

The user first approved the option-B source-built RefactorKit `0.7.0-SNAPSHOT` exception for TS-002 and later explicitly extended it to TS-001. The extension is capability-specific: semantic navigation continues to use the saved-snapshot language-server protocol, while diagnostics requires the strict `diagnostics.v2` compiler contract and its existing IDE presentation surfaces. Both uses remain conditional on exact committed-source evidence, a clean detached source build, controlled process/toolchain evidence, and sampled workspace audits. Those controls bound the exceptions; they do not turn the snapshot into a released provider or establish signed, hermetic, syscall-complete, native GUI/E2E, browser, packaged, or cross-platform validation.

### Decision

Accept the **option-B exception** for exactly `REQ-REFACTORKIT-TS-001` and `REQ-REFACTORKIT-TS-002`.

#### Common source-build and audit boundary

- Use RefactorKit `0.7.0-SNAPSHOT` with API version `0.2` and non-structural `languageKernel` capability evidence. The semantic-navigation gate requires backend protocol `typescript-lsp-explicit-v1` and rejects `0.6.2`, `0.6.3`, and structural/native-AST evidence. Diagnostics separately requires operation `diagnostics.v2` and compiler backend `typescript-compiler-exact-v1`; one capability does not authorize the other.
- Identify provider source with `sourceCommit` `db25c9af2d62c8e9e90f93792a6c6593e6e13698` and `sourceTreeHash`, where `sourceTreeHash` is the exact Git **tree object identity** obtained from that commit and paired with `sourceTreeFingerprintAlgorithm: git-tree-oid-sha1-v1` and `sourceTreeGitObjectType: tree`. It is reproducible with `git rev-parse '<commit>^{tree}'`. It is not a SHA-256 over absolute paths or dirty working-tree path/content bytes, and working-tree dirtiness cannot change that committed-tree identity.
- Build the provider from a newly created, clean, detached worktree pinned to that commit, using JDK 21 and exactly `./gradlew --no-daemon clean :modules:refactorkit-daemon:installDist`. [`build-refactorkit-daemon-attested.sh`](apps/desktop/src-tauri/scripts/build-refactorkit-daemon-attested.sh) refuses pre-existing worktree, build-log, and attestation destinations; checks detached HEAD plus clean Git state before and after the build; and emits a create-new attestation binding source HEAD/tree, command, Java/Gradle versions, build times, build-log SHA-256, and daemon SHA-256. The audit revalidates those fields and the expected Gradle install layout. This is observed provenance, not a signed or hermetic build attestation.
- Persist audit receipts outside the sampled workspace with create-new semantics under `apps/desktop/src-tauri/target/rk-semantic-receipts/`. Receipt schema `refactorkit-saved-snapshot-audit-v2` binds hashes for the build attestation, build log, daemon, build-attestation script, Node audit preload, Rust audit source, audit test executable, and Node process trace. A receipt may record an IDE revision and IDE source-worktree cleanliness, but neither is a final delivery receipt, approval, or reviewer verdict.
- Execute the supplied Node binary through a controlled wrapper and inherited preload. Record process starts and resolution/use of the supplied `typescript-language-server` and TypeScript package roots; guard package-manager and project-script launches through preload child-process hooks, PATH guards, workspace-module refusal, and a project-script canary. Zero observed prohibited invocations is required. These controls are not syscall-complete: an absolute executable launched outside the instrumented Node/PATH paths, for example, is not ruled out.
- Audit the workspace at operation-specific sampled boundaries and compare each non-directory path/content fingerprint with the baseline; explicitly check that `.refactorkit/workspace.lock` is absent. This discipline does not completely prove the absence of transient writes between samples, metadata-only changes, or empty-directory changes.

#### TS-002 saved-snapshot semantic navigation

- Treat `semanticLease` as the exact provider wire value `^semantic-[a-f0-9-]{36}$`. Rust production, TypeScript contracts, the Tauri adapter, fixtures, and desktop orchestration apply the same strict shape. The validated lease and saved-snapshot identity are retained as semantic authority and must correlate `semantic.start`, `symbol.search`, and `symbol.definition`; no layer may widen the lease to an arbitrary opaque string.
- Keep TS-002 at `@implemented-not-e2e-validated`. Its deterministic desktop/Tauri-harness evidence does not establish native GUI/E2E behavior.

#### TS-001 strict compiler diagnostics

- Admit diagnostics only through the closed strict schema-version-2 `diagnostics.v2` request and response contract. The operation identity and request identity must correlate exactly. The response is a closed `ready` / `refused` / `error` union: only `ready` may carry diagnostics; `refused` and `error` stop processing and cannot be repaired, inferred as ready, or replaced by stdout or fallback output.
- Bind every accepted response to the current workspace identity and generation, semantic session, exact `semanticLease`, project and provider snapshot hashes, and immutable-editor-overlay source authority, including each authorized document path, version, and content digest. Stale, late, mismatched, incomplete, extra-field, or truncated responses fail closed before replacing current IDE state.
- Require compiler backend `typescript-compiler-exact-v1` and compiler attestation for the accepted Node and TypeScript toolchain. The attestation includes toolchain provider, Node and TypeScript versions, compiler and toolchain-evidence SHA-256 values, and compiler-process executable hash, argument hash, and process identity. A diagnostic is accepted only as compiler evidence with its exact TypeScript code, category, message, severity, authorized path, and ordered zero-based UTF-16 range; line-only, absent, out-of-document, or non-UTF-16 locations are refused.
- Retain and enforce the advertised external-process runtime: timeout and cancellation support, immutable workspace overlay use, process provenance, 30,000 ms request timeout, 536,870,912 input bytes, 8,388,608 output bytes, and one process. The strict response adds limits of 65,536 stderr bytes, 512 MiB compiler heap, 500 diagnostics, 4,096 characters per diagnostic message, and 2,097,152 response bytes. Accepted output must report exact encoded response bytes, `truncated: false`, and equal total, returned, and actual diagnostic counts.
- Project accepted current diagnostics into the existing **Problems** experience and Monaco markers. Present checking, ready, refused, and error states honestly in the existing **Language Tooling** UI. Do not add a TypeScript-specific panel or a fallback diagnostics source.
- Keep the browser independent of the local provider. The browser adapter refuses this capability as unavailable and does not simulate compiler diagnostics. Any remote browser diagnostics service requires explicit opt-in and a separate architecture decision.
- Keep TS-001 at `@implemented-not-e2e-validated`. Its focused deterministic desktop/Tauri harness exercises production TypeScript composition against a controlled backend; it is not a native WebView/GUI or end-to-end provider run.

### Evidence

A historical TS-002 schema-v2 audit observed the clean detached provider HEAD `db25c9af2d62c8e9e90f93792a6c6593e6e13698`, Git tree object ID `0ee693d519f9c2bf9159bebbbc37857a56112d97`, JDK 21 build attestation, build-log and daemon hashes, controlled-wrapper and traced Node process evidence, supplied language-server and TypeScript observations, zero prohibited invocations, and five equal sampled workspace fingerprints. The audited IDE source worktree was not clean. This remains bounded historical audit evidence, not a mutable “latest receipt,” final delivered revision, or reviewer PASS.

For TS-001, the focused deterministic desktop/Tauri-harness Story was GREEN with exactly 1 scenario and 18 steps, the full Spec suite was GREEN at 305/305, and the independent technical gate returned PASS at `f019262`. The status-only promotion at `c755a4d` declared the requirement `@implemented-not-e2e-validated`. These are separate evidence classes and are not a combined Story-plus-Spec coverage claim. No Story aggregate rerun or final requirements-quality reviewer PASS is claimed by this ADR.

A separate supporting source-built diagnostics smoke observed the same clean detached provider commit/tree boundary, exact compiler diagnostic `TS2322` at zero-based UTF-16 range `0:23..0:29`, compiler/process attestation, zero prohibited process invocations, and six equal sampled workspace fingerprints. That smoke supports only its exact provider/toolchain/workspace fixture and audit boundary; it is not native GUI/E2E, packaged-provider, packaged-application, cross-OS, aggregate-suite, or final-review evidence.

### Consequences

**Positive:**

- Both accepted requirements can use real source-built saved-snapshot protocols without granting the metadata-write or lossy-diagnostics exceptions that option A rejected.
- TS-001 gains strict structured status, complete authority correlation, compiler/process attestation, exact UTF-16 compiler locations, enforced runtime/response bounds, stale rejection, and integration with the IDE's existing Problems, Monaco, and Language Tooling experiences.
- Exact committed-source identity, clean detached-build evidence, controlled process/toolchain evidence, and sampled workspace checks make both exceptions reproducible and auditable within their stated scopes.
- Browser refusal and the absence of fallback output preserve the web-first and provider-authority boundaries.

**Negative:**

- `0.7.0-SNAPSHOT` remains an unreleased source-built provider. Neither the provider nor the application has packaged validation, and no cross-operating-system validation is established.
- Build provenance is neither signed nor hermetic, and process controls are not syscall-complete.
- Sampled workspace evidence does not completely prove the absence of transient between-checkpoint writes, metadata-only changes, or empty-directory changes.
- Focused deterministic desktop/Tauri-harness evidence is not a native GUI/E2E provider run. Story and Spec results remain separate and cannot be combined into a coverage claim.
- Both requirements remain `@implemented-not-e2e-validated`; this ADR records no stronger lifecycle status, aggregate rerun, final delivery receipt, or independent requirements-quality reviewer PASS.

---

## ADR 0012 — Native Activation-Evidence Authority for XCOM 2 Build-Recipe Inspection

**Status:** Accepted. The architectural decision and rationale were accepted with implementation-informed evidence at exact repository commit `0d7637b86273e96cc1b4da37c4378f9183ce6a81`. At repository HEAD `c7c922c05d5d10b14f004402d7934179185b8ae5`, `REQ-XCOM2-PROJECT-BUILD-RECIPE-001` is declared `@implemented-not-e2e-validated`. This lifecycle statement remains evidence-bounded and is not a final delivery or reviewer verdict.

### Lifecycle and evidence amendment

The original `0d7637b86273e96cc1b4da37c4378f9183ce6a81` rationale and evidence boundary below remain historical; this amendment does not rewrite them. The technical gate returned PASS at pre-promotion production revision `6e4276bf7781d78ad38e628fd02649f2eb4a12ff`. Status-only promotion followed at `3644142043a3a490062cb9932162aa992ffacbde`, and HEAD `c7c922c05d5d10b14f004402d7934179185b8ae5` routes the promoted scenario through the implemented deterministic Tauri-harness aggregate.

At that current declaration boundary:

- the production-composed focused deterministic Tauri-harness Story passed 1 scenario and 41 Gherkin steps; the runner reported 42 step executions when its cleanup hook is included;
- the implemented inventory is 18 scenarios: 9 `@implemented-and-validated` and 9 `@implemented-not-e2e-validated`;
- the full implemented Story aggregate passed 2 web scenarios/16 runner steps, 9 deterministic Tauri-harness scenarios/343 runner steps, and 7 native GUI scenarios/198 runner steps, for 18 scenarios/557 runner steps total; and
- the pre-promotion technical gate reported 380 passing Specs, 1,792 passing package tests, and 265 passing Cargo tests with 10 ignored; canonical dual-runner coverage evidence was valid at that revision.

These evidence classes remain separate. No post-documentation technical-gate or requirements-quality-reviewer rerun has yet been recorded, and no final requirements-quality-reviewer PASS is claimed. The native GUI evidence covers activation regressions only, not recipe review or approval. There is no application-package, bundle, installer, cross-platform, Rust-coverage, or manual-accessibility claim.

The accepted authority boundary is unchanged: metadata-only review and volatile exact one-shot approval, opaque native activation evidence, exact lifecycle revocation, and browser unavailability. It adds no Build, Deploy, Cook, or Launch behavior; process, shell, network, or write authority; SDK, game, prefix, or proprietary-data access; or copied `modxcom`, GPL, proprietary, source, asset, or log content.

### Context

[ADR 0007](#adr-0007--machine-settings-and-evidence-activated-xcom-project-contributions) already governs XCOM 2 convention recognition and the activation-only project configuration. Its accepted recognition/configuration semantics and the exact project-owned, IDE-read-only `.ide/xcom2.json` v1 schema `{ "version": 1, "target": "wotc", "moduleRoots": [...] }` remain unchanged. This decision neither reopens that rationale nor turns recognition state into contextual tool authority by itself.

Build-recipe inspection needs a stronger boundary than cached presentation state. The trusted TypeScript evaluator can combine the safe convention and configuration facts defined by ADR 0007, but native code owns the authorized workspace, current directory identities, and permission to inspect a module. Passing evaluated roots back as ordinary strings would let renderer state recreate native authority after refresh, workspace switch, failed activation, or cached React restoration. Conversely, exposing native receipts or evidence handles on the later inspection request would make those opaque values a renderer-managed inspection token and would broaden the existing request contract.

The bounded recipe is review material for a possible future build. The contained `.scripts/build.ps1` is untrusted project input, and an exact approval is not permission to invoke it. The current slice must preserve a useful review without acquiring process, network, mutation, SDK, game, prefix, proprietary-content, or execution authority.

### Decision

Adopt **native activation-evidence authority with opaque acknowledgment and token-free inspection** for `REQ-XCOM2-PROJECT-BUILD-RECIPE-001`.

#### Activation-evidence authority

- A native begin operation binds the current authorized workspace and generation, performs the existing bounded convention scan and `.ide/xcom2.json` v1 read, and returns safe activation facts together with one opaque activation-attempt receipt and opaque per-root evidence handles. The receipt and handles identify only that volatile native attempt; neither grants authority independently.
- Trusted TypeScript evaluates the safe facts through the unchanged ADR 0007 recognition/configuration policy. It may acknowledge only the native attempt receipt and the opaque handles selected for the evaluator's complete, current, active roots. The acknowledgment contains no workspace path, module root, configuration, source bytes, hash, digest, command, or executable.
- Rust validates that the receipt is current, the scan is complete, every selected handle is known and strong or configured as required, and the selection is exactly the active set retained for the attempt. Rust then materializes its accepted authority as exactly those active module roots, revalidates the current workspace and module directory identities, and retains the root-to-handle association only in volatile native state. This materialization is an authority-state transition, not a filesystem creation or write.
- Workspace refresh, workspace switch or activation start, activation failure, a newer activation generation, application exit, and cached React restoration synchronously revoke native authority. Revocation cannot create or restore authority. Cached recognition or recipe presentation may be restored for display only; it can never restore native inspection authority.
- Build-recipe inspection keeps the existing exact request `{ workspaceId, generation, moduleRoot }`. It carries no activation-attempt receipt or evidence handle. Native code authorizes that request only by matching it to the current accepted native workspace generation and one of the exact accepted roots; stale workspaces, inactive roots, malformed requests, and absent or mismatched accepted authority fail closed.

#### Recipe capability and content boundary

- The native recipe capability is limited to contained, no-follow, metadata-only inspection. TypeScript may strictly review the closed metadata, take deterministic digest custody, and retain one volatile one-shot approval for the exact reviewed facts. There is no operational build consumer in this slice.
- Native review and one-shot approval are available only as metadata authority. Execution remains unavailable. The slice has zero process, shell, network, workspace-write, project-write, SDK, game, Steam-managed-prefix, `pfx_copy`, proprietary-content, deployment, cooking, launch, and success-claim authority. Browser inspection, review, approval, and execution are unavailable and must not be simulated.
- `.scripts/build.ps1` remains untrusted project input. Inspection may identify its fixed module-relative path, bounded byte size, and lowercase SHA-256, but may neither expose its bytes as a command nor invoke, rewrite, install, fetch, or otherwise trust it. Approval is inspection/review authority only and can authorize at most one future exact Default Build request after a separate execution decision; it authorizes no current execution.
- `pfx_copy` remains an unresolved future prerequisite. The project-local Highlander source dependency remains distinct from its matching Workshop runtime dependency; no global SDK source overlay is inferred. Build, Deploy, Cook, and Launch remain separate actions. This decision covers one exact Default Build recipe and grants no Deploy, Cook, or Launch approval.
- Provenance is limited to MIT-licensed X2ModBuildCommon (X2MBC) concepts and the applicable attribution notice. Acceptance fixtures must be synthetic and hand-authored. No `modxcom`, proprietary game or SDK material, GPL material, private material, generated source or assets, logs, or other copied source/asset content may be imported into the fixture or product under this decision.
- Recipe inspection does not extend `.ide/xcom2.json`, add tool or machine fields to it, or require/create a build manifest. Machine-owned prerequisites remain unresolved and require separate authority and decisions.

### Evidence

The decision was initially informed by the following bounded repository evidence at `0d7637b86273e96cc1b4da37c4378f9183ce6a81`. The later lifecycle and validation evidence is recorded separately in the amendment above:

- [`xcom2_native_activation/application.rs`](apps/desktop/src-tauri/src/commands/xcom2_native_activation/application.rs), [`state.rs`](apps/desktop/src-tauri/src/commands/xcom2_native_activation/state.rs), and [`filesystem.rs`](apps/desktop/src-tauri/src/commands/xcom2_native_activation/filesystem.rs) retain opaque native attempts, validate exact acknowledgments, hold accepted roots in volatile state, perform lifecycle revocation, and inspect the fixed contained metadata without executing project input.
- [`xcom2_native_activation.rs`](apps/desktop/src-tauri/src/commands/xcom2_native_activation.rs) exposes the four narrow begin, acknowledge, revoke, and inspect commands. [`xcom2-native-activation-evidence-tauri.ts`](packages/tauri-adapters/src/xcom2-native-activation-evidence-tauri.ts) and [`xcom2-project-build-recipe-inspection-tauri.ts`](packages/tauri-adapters/src/xcom2-project-build-recipe-inspection-tauri.ts) enforce the corresponding strict TypeScript/native envelopes.
- [`xcom2-native-activation-evidence-policy.ts`](packages/contracts/src/domain/xcom2-native-activation-evidence-policy.ts) selects only evaluator-approved active handles and keeps the inspection request token-free. [`xcom2-project-build-recipe-policy.ts`](packages/contracts/src/domain/xcom2-project-build-recipe-policy.ts) validates and digests the closed metadata and constrains approval to volatile one-shot policy state with execution unavailable.
- [`useXcom2ModuleActivationController.ts`](apps/desktop/src/features/xcom2-module-activation/useXcom2ModuleActivationController.ts) evaluates safe facts before sending the opaque acknowledgment and treats cached React restoration as revocation-only. [`useXcom2ProjectBuildRecipeController.ts`](apps/desktop/src/features/xcom2-project-build-recipe/useXcom2ProjectBuildRecipeController.ts) exposes metadata review/approval without a build consumer.
- At that original evidence boundary, the canonical [`project-build-recipe.feature`](features/xcom2/project-build-recipe.feature) declared `REQ-XCOM2-PROJECT-BUILD-RECIPE-001` as `@not-implemented`, and no passing technical gate or status promotion had yet occurred. That statement is intentionally historical; the current declaration and later evidence are recorded in the lifecycle and evidence amendment. Neither boundary claims native GUI/E2E recipe review, packaged behavior, cross-platform behavior, or execution.

### Consequences

**Positive:**

- Native workspace and root authority cannot be reconstructed from cached renderer state or a caller-supplied module root.
- The opaque acknowledgment minimizes renderer-to-native authority data while preserving the trusted TypeScript evaluator and ADR 0007's established semantics.
- A stable token-free inspection request remains usable behind strict native authorization without exposing receipts or handles as reusable inspection credentials.
- Metadata review and exact one-shot approval can evolve independently from any future execution, machine-root, prefix, or build-action authority.
- Browser unavailability and the explicit no-execution boundary prevent fake success or accidental web capability expansion.

**Negative:**

- The begin/evaluate/acknowledge/revoke protocol adds volatile state, correlation, and lifecycle complexity across Rust, Tauri adapters, and desktop composition.
- Opaque handles still cross the renderer boundary during activation and therefore require strict redaction, bounded lifetime, exact validation, and no persistence or logging.
- A refresh, switch, failed activation, cached restoration, identity change, incomplete scan, or metadata change can require a fresh begin/evaluation/acknowledgment and recipe review.
- The current evidence remains platform- and implementation-bounded. The promoted requirement is only `@implemented-not-e2e-validated`; native GUI evidence covers activation regressions rather than recipe review, and final post-documentation technical and requirements-quality review remain outstanding.
- This decision intentionally leaves execution, process isolation, machine prerequisite grants, `pfx_copy`, Build/Deploy/Cook/Launch consumers, proprietary compatibility, packaging, and cross-platform validation unresolved.
