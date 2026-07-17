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

A real JDT LS smoke passed repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop. Diagnostics composition, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, Java activation, and contextual project tools were originally recorded as future work in [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md). The external-class clipboard workflow is separately operational with the installed full-capability daemon; its real temporary-workspace smoke proved no imported target or other project-content write before Apply, discard, exact apply, and byte-for-byte restoration of the tested project content through provider rollback. Provider `project.open` may create `.refactorkit/workspace.lock`, so this preview/no-write evidence does not establish complete hidden workspace-tree identity. This bounded Java-import evidence does not authorize that or any other metadata write for the separately parked `REQ-REFACTORKIT-TS-002` flow. RefactorKit remains the only custom Java intelligence tool; its project model remains internal until extraction criteria emerge.

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

**Status:** Accepted; convention recognition, activation-only `.ide/xcom2.json` v1, and the safe invalid-configuration diagnostic UX are CURRENT/AS-BUILT, with their respective requirements declared `@implemented-and-validated`; manual confirmation, external roots, and contextual XCOM tooling remain FUTURE/TARGET.

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

This amendment does not make configured XCOM activation or contextual tooling current. Explicit configuration, manual confirmation and persistence, external roots, content parsing, Build, Problems, Tests, Logs, language support, actions, and bottom contributions remain FUTURE/TARGET. It does not alter ADR 0005's RefactorKit blockers or Java activation freeze, the package-manager postponement in ADR 0007/0009, or the requirement for a separate generic plugin-runtime decision.

#### 2026-07-17 XCOM configured-activation lifecycle amendment

The preceding sentence is retained as the recognition-slice lifecycle record but is superseded for explicit activation status by ADR 0007's configured-activation amendment. Project-owned `.ide/xcom2.json` v1 is now CURRENT/AS-BUILT only for the recognition contribution, with an explicit full-Workspace-Refresh lifecycle, synchronous revocation, and stale-result suppression. Option A remains independent; invalid configuration grants no authority and cannot suppress recognized activation. Machine Settings and browser behavior remain unchanged.

Manual weak-evidence confirmation and persistence, external roots, content parsing, Build, Problems, Tests, Logs, language support, actions/tools, and bottom contributions remain FUTURE/TARGET. This amendment does not alter ADR 0005's RefactorKit freeze/blockers, the package-manager postponement in ADR 0007/0009, or the separate-decision requirement for a generic plugin runtime.

#### 2026-07-17 XCOM configured-diagnostic lifecycle amendment

At exact HEAD `2ecbb29`, ADR 0007's complete safe invalid-configuration diagnostic is also CURRENT/AS-BUILT and `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` is declared `@implemented-and-validated`. It remains a project-scoped presentation in **Settings > Workspace > Current workspace**, not machine Settings or a new project contribution. It follows only explicit Workspace Refresh, neutral checking, and strict stale-result rejection, with no watcher or poll. Invalid configuration grants no configured authority; strong Option A recognition may independently retain the accessible **XCOM 2 Project** activity and mirror the complete warning in its panel, but the diagnostic itself grants no activity, bottom contribution, process, write, external-root, action, or contextual-tool authority.

Machine Settings and browser behavior remain unchanged. Manual confirmation/persistence, external roots, contextual tooling, and all other exclusions above remain non-current. This amendment does not alter ADR 0005's Java/RefactorKit lifecycle and capability policies, ADR 0007's Option A rules, the package-manager postponement in ADR 0007/0009, or the separate-decision requirement for a generic plugin runtime.

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
