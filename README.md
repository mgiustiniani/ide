# IDE — Three-Panel Integrated Development Environment

A **Tauri 2.x** desktop application and **standalone webapp** featuring a three-panel IDE layout:

- **Left sidebar** — accordion navigation with File Explorer above Workspace Explorer; each section expands and collapses independently
- **Right/center area** — Monaco-only code editor with tabs
- **Bottom panel** — dynamic, accessible tool-window host; desktop contributes core Terminal and AI Agent plus a conditional project-scoped Problems tab for the current Java context/diagnostics, while web contributes core Terminal only

**CURRENT/AS-BUILT layout:** within application content, the activity rail and left sidebar span the full available height while the bottom shell/tool-window host belongs only to the narrower editor-side column. Top-level chrome/status remains separate. The optional right sidebar stays inside the editor row and is responsively bounded so it does not force document overflow at narrow widths. Both panel boundaries retain keyboard resizing and accessible separator semantics. When the whole sidebar is collapsed, an accessible expand control remains in the activity rail; the bottom-panel toggle remains in the status bar in both visibility states. Desktop shell wiring routes these controls without clearing the retained panel dimensions.

Built with a **ports-and-adapters (hexagonal) architecture** to share UI and logic between desktop and web runtimes. Executable requirement declarations and target-specific observed evidence are reconciled separately in the [requirements appendix](docs/arc42/appendix-requirements.adoc).

The desktop sidebar is an accordion with **File Explorer above Workspace Explorer**. Both sections expand and collapse independently. Workspace Explorer lists every registered workspace and owns switching, refresh, loading, and error feedback; the former duplicate workspace selector in the header has been removed. The file tree recognizes conventional Java source roots and compacts package-only namespace chains beneath them without changing the deepest real path used for expansion and file opening. Production source and test folders remain visually distinct, and `pom.xml` uses a dedicated Maven icon. Unrecognized folders retain their ordinary hierarchy.

[Monaco Editor 0.52.2](https://github.com/microsoft/monaco-editor) is the only editor. It is bundled locally for offline use with same-origin workers, one model per file, and a bundled Java Monarch/basic language contribution for syntax highlighting. Monaco mounts lazily only after an active file host is visible, renderable, and has positive area; the load timeout starts only then, and layout runs again after visibility returns. With no file open, the editor shows a Kate-style create-file state. While Monaco loads, it shows an inert source-free placeholder; import or runtime failure offers **Retry Monaco**, never a native editor fallback. No CDN or Content Security Policy expansion is required.

Java intelligence is desktop-only and presented according to scope. **Settings > Java** owns global tooling: full-JDK and external JDT LS discovery plus managed lifecycle/status, and RefactorKit availability/version/path/capability discovery. The managed JDT LS path includes provider-neutral lifecycle, versioned document sync, diagnostics, completion, hover, signature help, and cancellation; typed Tauri adapters; fixed no-shell Rust transport with isolated per-workspace data; and guarded Monaco providers. The browser reports native Java providers unavailable, shows no Java tab, starts no hidden Java polling, and does not simulate these capabilities.

The as-built Java boundary serves only the exact synchronized Monaco model. Workspace/session/path/URI/version/request/cancel guards, optimistic versions, serialized full-text `didChange` flushes before semantic requests, cancellation, and stale/late-result suppression prevent cross-model or outdated rendering. Current diagnostics feed Monaco and a conditional project-scoped Problems tab; this visibility guard is not Java module activation. Completion applies only its primary edit; additional/workspace edits and commands are suppressed. Documentation is untrusted Markdown with HTML disabled, and managed configuration sets `java.signatureHelp.enabled=true`.

**Roadmap freeze:** future IntelliSense and JDT LS expansion is not actively scheduled. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, the full contextual Problems/Build/Tests/Logs lifecycle, and other contextual Java tooling are **unscheduled TODO / frozen historical inventory** until a relevant released RefactorKit capability passes immutable real acceptance validation. Unsupported or unintegrated capabilities are not simulated. See the [current Java boundary and frozen inventory](docs/JAVA_INTELLISENSE_PLAN.md). This direction does not claim IntelliJ Ultimate parity.

### Paste Java Class from Clipboard

The desktop IDE has an **operational, capability-gated** directory-tree workflow for importing an external Java class. Select a directory, then use its **Paste Java Class from Clipboard** context action or press `Ctrl+V`/`Cmd+V` while the file tree owns focus. Normal editor paste is never intercepted, and there is no global paste listener.

The workflow validates the selected directory and probes RefactorKit capability **before** one explicit clipboard read. A supported provider must advertise `java.importExternalClass` with `targetDirectory`, preview, and apply; operational promotion also requires rollback. The preview dialog shows backend-produced placement, affected files, package changes, rendered and structured diffs, evidence, risk, warnings, diagnostics, provenance/license information, unresolved dependencies, conflicts, staleness, and apply blockers. Apply is enabled only for the exact ready, eligible, non-stale plan the user reviewed, with additional acknowledgement for unknown/high-risk provenance. The IDE sends only its approved plan ID, displays the returned opaque transaction, and refreshes the tree/opens the primary file only from backend-authoritative results. Cancel, workspace changes, and directory-selection invalidation clear local plan/authority synchronously before starting asynchronous correlated discard cleanup. Discard failure is non-fatal and cannot restore that authority. RefactorKit remains the sole imported-project-content writer and rollback authority: the IDE performs no package inference or fallback/direct writes and sends no clipboard source, plan, or transaction to Pi. Rollback exists in contracts, adapters, Rust, and provider authority, but the current import UI has no rollback action.

[`REQ-REFACTORKIT-JAVA-IMPORT-001`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-JAVA-IMPORT-001) is declared `@implemented-not-e2e-validated`. At `54c28f3`, its deterministic `desktop/tauri-harness` Story passed 1 scenario and 22/22 steps. Under jsdom it renders the real desktop `App`, FileTree context action, review dialog, import controller, and typed Tauri adapters over a fake in-process Tauri backend and mocked Monaco textarea. It proves capability acceptance before exactly one clipboard read, exact preview and Apply DTOs, complete rendered and structured review, required acknowledgement, backend-only refresh/open, a bounded source-free trace, and cancellation/stale-generation discard safety. It does **not** prove the OS clipboard, native GUI, real Monaco, a live or immutable RefactorKit provider, native filesystem authority, hidden-metadata identity, or a packaged application.

[`REQ-REFACTORKIT-JAVA-IMPORT-002`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-JAVA-IMPORT-002) is separately declared `@implemented-and-validated`. On 2026-07-16 at `5146221`, an independent focused Linux X11 native run passed 1 scenario/36 Cucumber markers against a freshly built production release/no-bundle executable. The real Tauri WebKit path exercised File Explorer, its directory context menu, the review dialog, real Monaco, and the production native clipboard command against a GTK-owned OS clipboard and a sandbox-owned deterministic daemon. Two previews carried the exact fixture hash under distinct plans; the first was discarded with no target, while the second reached the daemon as Apply params containing only `{ "planId": "native-java-import-plan-002" }`, recorded one primary-file creation, and changed the exact workspace tree from 8 to 9 entries. The source-free transcript, absent scenario `.refactorkit` state, configured-root confinement, and owned-process cleanup passed. This evidence is only for the deterministic fixture daemon and observed Linux X11 release/no-bundle boundary. It proves neither underlying clipboard-read cardinality nor raw IPC, provider metadata/no-write behavior, a real/global/immutable/packaged RefactorKit provider, syscall-level or global confinement, package/installer behavior, Wayland/other operating systems, user-facing rollback, or the `REQ-REFACTORKIT-JAVA-IMPORT-001` stale/cancellation matrix.

The workflow is operational only when `bin/refactorkit-daemon` advertises API 0.2 and the required import/apply/discard/rollback method features. Provider version is diagnostic metadata, not an authorization gate. Language-kernel and safety metadata are strictly normalized and retained when advertised, but the four top-level safety booleans do **not** all gate current Java-import authorization and may be absent; they must not be described as a complete compatibility gate. Rust owns one NDJSON daemon for the current workspace generation, opens the canonical workspace, normalizes the rich `targetDirectory` preview, applies only the exact `planId`, discards pending plans, and can roll back by transaction ID behind the non-UI boundary. Malformed output, timeout, workspace switch, and application exit terminate the process; source text is never logged. Missing, failed, or incomplete required method capability remains unavailable before clipboard access, with no force flag or compatibility fallback. Real temporary-workspace smoke passed against the globally installed `0.5.0-SNAPSHOT`; separate isolated evidence passed against the immutable packaged `v0.6.2` daemon. Their preview/no-write result means no imported target or other project-content write before Apply, not complete hidden workspace-tree identity: provider `project.open` may create `.refactorkit/workspace.lock`. This Java-import harness makes no live-provider or metadata claim. The global launcher and checksum were not replaced and still report `0.5.0-SNAPSHOT`. See [ADR 0005](ADR.md#adr-0005--hybrid-java-intelligence-with-jdt-ls-and-refactorkit) and the [current/target C4 view](docs/c4/target-java-intelligence.md).

A completed supporting sub-slice now preserves and strictly validates RefactorKit schema-v1 per-operation metadata through Rust, TypeScript adapters, contracts, and the Language Lab. The Language Lab receives deterministic canonical order produced after validation—rather than preserving provider-supplied order—and presents operation, stability, evidence, mutation authority, backend, runtime, then extensions. A pure readiness policy can produce one immutable, workspace/session/snapshot-bound TypeScript diagnostics request from exact fixture evidence. This is supporting Spec/metadata evidence only: [`REQ-REFACTORKIT-TS-001`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-TS-001) remains declared `@not-implemented`, and its desktop/Tauri Story is meaningfully RED because the legacy diagnostics command still receives no qualified request and returns no structured authority envelope.

**`WAIT_FOR_UPSTREAM_PROTOCOL_FIX` (option A until further notice):** this is a reversible temporary product decision for `REQ-REFACTORKIT-TS-001`, not a permanent ADR. The IDE will not implement a Problems-only saved-disk fallback and will not fabricate approximate Monaco line markers. Work may resume after upstream provides exact bounded UTF-16 ranges or explicit enforceable precision, request/result authority correlation, exact compiler attestation, explicit saved/unsaved snapshot semantics, structured readiness/refusal/failure outcomes, and compatible advertised/observed runtime and response bounds—or after the user explicitly revises this decision. The requirement remains declared `@not-implemented`; its completed metadata/readiness evidence and meaningful Story RED remain valid bounded evidence. TypeScript/JavaScript operations are not universally stable: semantic definition/references/workspace symbols/diagnostics remain experimental, rename is experimental proposal-only, and format, move, organize imports, change signature, extract, and inline remain unsupported.

**RefactorKit symbol-navigation option A — wait for upstream:** no `.refactorkit/workspace.lock` or other metadata write is authorized for `REQ-REFACTORKIT-TS-002`. The requirement remains declared `@not-implemented` and blocked despite deterministic 18/18 Story evidence. Work may resume only after a corrected released provider capability, separately approved contract, and applicable immutable real acceptance evidence establish read-only behavior. Both TypeScript/JavaScript RefactorKit requirements are parked; they are not active roadmap slices.

The desktop also includes an **AS-BUILT XCOM 2 machine setup/download monitor and concrete repeatable SDK transaction** in **Settings** as the built-in, experimental first-party feature `ide.xcom2-wotc`. Its plugin-shaped descriptor and ports do not constitute a generic plugin runtime. Native monitoring remains bounded and read-only for Steam AppIDs `268500`, `602410`, and optional `299990`, with conservative state and redacted provenance. The pure dry-run planner remains separate and non-executable.

The native transaction engine now provides the concrete, repeatable **Make SDK Operational** transaction. Prepare audits the vanilla WOTC SDK (Steam AppID `602410`) and, for the validated baseline, produces exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack source quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game. Machine-level journals and content-addressed backups capture the Steam build/manifest/root fingerprint plus exact original bytes, hashes, modes, inventory, and symlink absence. Apply requires approval of the exact complete digest for this one external-SDK transaction. **Restore Vanilla SDK** restores the captured baseline exactly, never overwrites conflicts, and enables rollback followed by **Prepare Again** for repeat setup tests.

A live Prepare audit produced 15 operations, `executable=true`, and no blockers; **no live Apply has been performed**. Protontricks, Steam shortcut creation, Proton-prefix work, package-manager operations, and all interactive setup remain **FUTURE/TARGET**, explicitly excluded and non-executable. The browser setup adapter reports unavailable without simulation and starts no hidden XCOM work.

[`REQ-XCOM2-MACHINE-SETTINGS-001`](docs/arc42/appendix-requirements.adoc#REQ-XCOM2-MACHINE-SETTINGS-001) is declared `@implemented-not-e2e-validated`. Settings closed across cold start or workspace switching performs zero XCOM monitor, history, detail, event-poll, or subscription work. Opening owns exactly one monitor-adapter and one transaction-adapter lifecycle, with one fresh snapshot and one history load; manual refresh performs one refresh and one additional history load. Close synchronously invalidates requests, unsubscribes both adapters, and clears both poll timers; reopen creates one fresh lifecycle of each. Failed restoration, open workspace switching, and stale responses remain generation-guarded. The 27/27-step deterministic harness exercises the production `App`, controllers, and typed Tauri adapters over a fake backend and fake clock. It proves no native GUI, real IPC, live Steam, real filesystem, package, bundle, or installer behavior.

[`REQ-XCOM2-MODULE-ACTIVATION-001`](docs/arc42/appendix-requirements.adoc#REQ-XCOM2-MODULE-ACTIVATION-001) is separately `@implemented-and-validated` for the first recognition-only slice. On an authorized Linux workspace, one generation-correlated controller request crosses a strict Tauri adapter into a dedicated read-only Rust metadata/name scanner. Option A accepts exact-case regular entries only, excludes symlinks and the heavy `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`, and `.vite` directories, and stops at depth 8 or 20,000 encountered entries with explicit limitations. A pure evaluator contributes the dynamic accessible **XCOM 2 Project** activity only for two distinct accepted evidence kinds under one module root; names and one-kind evidence never activate it. A committed switch removes recognition synchronously, and stale results cannot restore it. The focused native Story passed 1 scenario/26 reported steps (25 authored plus cleanup) against the actual sandbox filesystem and production Linux X11 release/no-bundle Tauri WebKit DOM at 1440×900. This validates recognition only: `.ide/xcom2.json`, explicit configuration, manual confirmation/persistence, external roots, proprietary compatibility, content parsing, Build, Problems, Logs, language support, actions, and bottom contributions remain future. Machine Settings remains separate and cannot activate a project.

See the [XCOM 2 requirements](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md), [ADR 0009](ADR.md#adr-0009--durable-digest-approved-xcom-setup-transactions), and [current/target C4 views](docs/c4/target-xcom2-setup.md).

---

## Tech Stack

| Layer              | Technology                                                    |
| ------------------ | ------------------------------------------------------------- |
| Desktop shell      | Tauri 2.x (Rust)                                              |
| Frontend framework | React 18 + TypeScript                                         |
| Code editor        | Monaco Editor 0.52.2 only (local, lazy)                       |
| Terminal           | xterm.js UI + desktop command runner / simulated web terminal |
| Build tooling      | Vite + pnpm workspaces                                        |
| CSS                | Tailwind CSS shared through `packages/ui`                     |
| State management   | Zustand                                                       |

---

## Architecture Summary

```
┌──────────────────────────────────────┐
│   UI Components (presentation layer) │
│  FileTree · Editor · Terminal · ... │
└──────────────┬───────────────────────┘
               │ receives props/callbacks
┌──────────────┴───────────────────────┐
│   View Models & State (web-core)     │
│   — ports, Zustand stores, logic    │
└──────────────┬───────────────────────┘
               │ uses port implementations
┌──────────────┴───────────────────────┐
│   Adapter Layer                      │
│  browser-adapters  │  tauri-adapters │
└──────────────────────────────────────┘
```

The core design rule: **UI never talks directly to platform APIs**. App shells wire UI props to view models, view models use ports from `packages/web-core/ports/`, and adapters (`@ide/browser-adapters` or `@ide/tauri-adapters`) implement those ports.

### Current composition and application-controller boundary

`apps/desktop/src/App.tsx` remains a composition-only root: it creates stores, view models, and adapters; wires controllers; derives presentation props; and renders the shell. Six extracted controllers own the remaining shell/document/editor coordination: **Settings**, **Terminal**, **File Explorer**, **Document Navigation**, **Editor Command**, and **Desktop Shell**.

The root also composes nine application controllers. This is an implementation-informed current boundary, not a claim that the DDD roadmap is complete.

| Controller                        | Current responsibility                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Editor**                        | Guarded file open/create, tab lifecycle, deferred restore, workspace reset, and presentation-safe editor state                                                           |
| **Java Language**                 | Workspace-scoped language lifecycle, versioned document sync, diagnostics, guarded completion/hover/signature help, cancellation, and stale-result rejection             |
| **RefactorKit Import**            | Separate capability-gated clipboard import preview/apply flow with selection and workspace freshness checks                                                              |
| **RefactorKit Symbol Navigation** | Parked implementation-informed support: deterministic orchestration exists, but the real provider violates the no-workspace-write contract; not a current IDE capability |
| **Workspace**                     | Authorized active-root transition, registry state, switching, and the shared workspace-generation boundary                                                               |
| **AI Agent**                      | Configuration/status and workspace-isolated commands, messages, activities, prompts, and stale-request suppression                                                       |
| **XCOM Setup**                    | Settings-owned monitor/transaction lifecycles, workspace-correlated transaction authority, pure planning, event re-reads, and stale-transition guards                    |
| **XCOM Module Activation**        | One-shot authorized-workspace recognition, pure two-kind evaluation, synchronous deactivation, stale-result suppression, and recognition-only activity state             |
| **RefactorKit Status**            | Provider-neutral, diagnostic-only status and capability discovery; it has no mutation authority                                                                          |

On cold start, the Workspace controller first completes `ensureCurrentWorkspace`, then lists/promotes registry metadata, and only then restores or loads workspace-scoped Editor, file-tree, Java, AI Agent, and RefactorKit Status state. It supplies workspace/generation correlation to XCOM transaction authority but does not start the XCOM runtime: only open Settings owns that lifecycle. `WorkspaceGeneration` starts positive and increases monotonically for user-initiated workspace switches; dependent controllers use it to reject stale work. RefactorKit Import also starts with a positive generation when used independently and consumes the shared authority in desktop composition.

The native Java Language and managed RefactorKit Tauri boundaries remain facades over application, contract, policy, protocol, semantic, toolchain, transport, and support modules. Public Tauri commands remain stable while process ownership, policy, protocol, and use-case orchestration stay behind the facades.

**RefactorKit policy and current migration status:** the IDE integrates only exact capabilities that work now with evidence appropriate to the claimed target. The current RefactorKit IDE bucket contains diagnostic-only capability discovery and the managed Java import transaction. The transaction has separately bounded deterministic harness evidence for `REQ-REFACTORKIT-JAVA-IMPORT-001` and deterministic-fixture Linux X11 native evidence for `REQ-REFACTORKIT-JAVA-IMPORT-002`; neither transfers provider-metadata/no-write, real/global/immutable/packaged-provider, package, broader-OS, or broader-confinement claims. TypeScript diagnostics (`REQ-REFACTORKIT-TS-001`) and semantic navigation (`REQ-REFACTORKIT-TS-002`) remain declared `@not-implemented` and parked for confirmed protocol/provider defects; deterministic support evidence does not override those defects, and option A grants no metadata exception for read-only symbol navigation. Structural outline and identifier search are working provider foundations, while TypeScript references and rename are experimental provider foundations; none is thereby an IDE capability. General Java refactoring remains TODO beyond the managed import. Announced RefactorKit search operations with optional JSON also remain TODO until a released capability provides strict typed bounded versioned machine-readable JSON (or equivalent daemon DTO), including structured errors, truncation, authorized locations, and request/result correlation, plus real acceptance evidence. Human-oriented stdout is never an IDE protocol.

Chapter 1 goals, quality goals, and stakeholders remain confirmed. The full-height navigation/editor-column bottom-host amendment is implemented and target-validated: both `REQ-LAYOUT-WEB-001` and `REQ-LAYOUT-DESKTOP-001` are `@implemented-and-validated`. The desktop requirement retains its earlier deterministic `desktop/tauri-harness` 9/9 history, but promotion rests on an independent Linux X11 release/no-bundle Tauri WebView DOM run at `146f10a`: 1 scenario/9 steps at an asserted 1440×900 viewport, two exact +10 keyboard resizes, and seven settled expanded/resized/collapsed/re-expanded states. It verified collapse and recovery controls for both panels, full-height rail/sidebar geometry, editor-side bottom topology, application-header/status stability within ±1 px, separator ARIA/focus behavior, and clean exit/cleanup. Production fixes keep the collapsed-sidebar expand control in the activity rail and the bottom toggle in the status bar, with desktop-shell wiring to retained layout state.

`REQ-DESKTOP-FILE-OPEN-001` remains separately `@implemented-and-validated`. On 2026-07-15 its Linux X11/Xvfb Tauri WebKitWebDriver Story passed 1 scenario and 16/16 steps against a freshly built release/no-bundle executable (SHA-256 `e19af16c60712631caab7c934d88f8750c54e46f5a1456fcad9d08d68119a8a6`). The configured inventory is **6 validated, 2 harness-only, and 2 not implemented**. The canonical implemented aggregate now routes **2 web, 2 deterministic desktop harness, and 4 native GUI** scenarios; native Java import remains bounded to its deterministic fixture daemon and XCOM project activation to recognition-only sandbox evidence. Native layout and file-open support acquire distinct per-scenario environment leases, including isolated `IDE_HOME` and workspace roots, so one scenario cannot reuse another's `.ide` state. These are bounded direct repository-build results, not OS-decoration, package/installer, Wayland, other-OS/DPI, drag-resize, restart-persistence, optional-right-sidebar, screen-reader, or reproducible-binary evidence. Packaging `synapse-ide-desktop` remains postponed until the full-build milestone and must use repository-only runtime dependencies. See [ARC42](ARC42.md#ddd-roadmap-status) and the [requirements appendix](docs/arc42/appendix-requirements.adoc) for exact evidence boundaries.

### Current quality tooling

At implementation baseline `5cdc9c0`, `pnpm test:coverage` passes **1021/1021 tests** and records the owned production TS/TSX V8 baseline: **86.37% statements/lines, 82.66% branches, and 86.74% functions**. The Spec suite reports **132/132 cases**, while Rust defaults report **181 passed and 8 ignored**. The scope covers contracts, web-core, UI, browser/Tauri adapters, and both app frontends, with declarations, tests, dependencies, generated code, and build output excluded. No coverage thresholds are configured; Story, Spec, browser, native GUI, and Rust evidence remain separate rather than being folded into these percentages.

The generic `pnpm test:e2e` command truthfully runs **2 Playwright Chromium web scenarios/16 steps**, then **4 Linux Tauri-WebDriver native scenarios/87 reported steps** against one fresh release/no-bundle executable. Its native route covers promoted layout, file opening, deterministic-fixture Java import, and recognition-only XCOM module activation. It intentionally excludes both deterministic desktop-harness scenarios, whose aggregate passes 2 scenarios/49 steps, and remains distinct from the canonical 2-web/2-harness/4-native declared Story aggregate.

ESLint 9 now performs substantive JavaScript and TypeScript analysis through `@eslint/js` and `typescript-eslint`; `pnpm lint:strict` passes with zero warnings. For the current React 18 runtime, React Hooks linting enables only canonical `rules-of-hooks` and `exhaustive-deps`; React Compiler-specific rules remain out of scope pending a separate adoption decision. Repository-wide Prettier also passes with zero failures after isolated AST-equivalent batches replaced the former formatting baseline debt.

The architecture model owns its default styling locally and validates without the retired remote Cloud theme or its EOL warning, including offline validation once Structurizr CLI is available. First-time CLI or execution-image acquisition may still require network access.

---

## Package Layout

```
apps/
├── web/             # Standalone webapp (no Tauri dependency)
└── desktop/         # Tauri desktop app
    └── src-tauri/   # Rust/Tauri code (commands, lib, main)

packages/
├── contracts/       # Shared TypeScript types/interfaces
├── web-core/        # Reusable frontend logic, ports, view models, Zustand stores
├── ui/              # Reusable UI components (no Tauri imports)
├── browser-adapters/# Browser implementations of ports
└── tauri-adapters/  # Tauri-specific TS implementations of ports
```

---

## Setup & Development

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9 (corepack enabled)
- **Rust** (for Tauri desktop development only)
- System dependencies for Tauri (Linux: `webkit2gtk-4.1`, `libgtk-3`, etc.)

### Quick Start

```bash
# Install dependencies
pnpm install

# Run web-only (no Tauri)
cd apps/web
pnpm dev

# Run desktop (Tauri)
cd apps/desktop
pnpm tauri dev
```

### Build

```bash
# Build webapp
cd apps/web
pnpm build

# Build desktop app
cd apps/desktop
pnpm tauri build
```

### Eclipse JDT Language Server tool

Phase 1A uses a full JDK and Eclipse JDT LS as external developer/runtime tools. Install a full JDK through your platform and ensure its `java` is discoverable (for example through `JAVA_HOME` or `PATH`), then install and verify the pinned JDT LS release without `sudo`:

```bash
pnpm tools:install-jdtls
pnpm tools:verify-jdtls
```

The installer downloads JDT LS `1.61.0-202607102111` on demand from `download.eclipse.org`, verifies its pinned SHA-256 before extraction, and installs it under `${XDG_DATA_HOME:-$HOME/.local/share}/ide/tools/jdtls`. The `current` symlink selects the validated version. JDT LS and the JDK are **not bundled or redistributed in the Tauri binary or this repository**; each remains an externally installed tool under its own license. JDT LS is EPL-2.0-licensed Eclipse Foundation software; review the upstream [Eclipse JDT LS licensing information](https://github.com/eclipse-jdtls/eclipse.jdt.ls#license) and your chosen JDK's terms before use.

Real integration has passed with JDT LS `1.61.0-202607102111` and JDK `25.0.3`. Lifecycle coverage includes discovery, initialization, capability normalization, event polling, workspace-data isolation, and graceful shutdown. A real semantic smoke additionally verifies repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop. These external-tool tests are intentionally `#[ignore]` in the default Rust run; run them after installation:

```bash
cd apps/desktop/src-tauri
cargo test --locked managed_jdtls_real_initialize_poll_and_graceful_stop -- --ignored --nocapture
cargo test --locked managed_jdtls_real_semantic_completion_hover_and_signature_smoke -- --ignored --nocapture
```

The native XCOM 2 monitor also has an intentionally ignored, read-only live Steam probe. Run it only on a machine with the relevant Steam manifests:

```bash
cd apps/desktop/src-tauri
cargo test --locked live_steam_snapshot_probe -- --ignored --nocapture
```

Earlier time-specific monitor samples exercised incomplete-download and staging gates. After the game and SDK became complete and stable, the live read-only Prepare audit reported exactly 15 operations, executable, with no blockers. This is validation evidence rather than a static status promise; no live Apply occurred.

Synthetic transaction fixtures prove two complete apply→rollback cycles restore the exact original file states and SHA-256 hashes for atomic patch, quarantine, generated file, generated directory, and symlink operations. They also prove reverse rollback ordering, restart recovery, conflict refusal, and conflict-safe retry. The latest dated gate and target-specific validation evidence is centralized in [ARC42 section 10](ARC42.md#section-10-quality-requirements). The expected diagnostics RED and deterministic symbol-navigation evidence remain bounded by the frozen RefactorKit policies above; the latter is still blocked because immutable `v0.6.2` wrote `.refactorkit/workspace.lock`, and option A permits no metadata exception. Desktop aggregate evidence is split deliberately: `REQ-REFACTORKIT-JAVA-IMPORT-001` and `REQ-XCOM2-MACHINE-SETTINGS-001` use the non-GUI `desktop/tauri-harness` route, while promoted layout, native file opening, deterministic-fixture `REQ-REFACTORKIT-JAVA-IMPORT-002`, and recognition-only `REQ-XCOM2-MODULE-ACTIVATION-001` use Linux `desktop/tauri-webdriver` release/no-bundle. Neither parked TypeScript/JavaScript RefactorKit scenario is selected. The harness Java-import evidence still uses a fake Tauri backend and mocked Monaco textarea; native Java-import evidence remains real GUI/OS-clipboard evidence only for its sandbox fixture daemon and is not real/global/immutable/packaged-provider, provider-metadata/no-write, raw-IPC/read-cardinality, package, broader-OS, or broader-confinement evidence. Native layout retains its separate DOM-geometry and accessibility boundary and does not establish OS decoration, packaging, Wayland, other OS/DPI, drag, restart, optional-right-sidebar, screen-reader, or reproducible-binary claims.

---

## Documentation

[ARC42.md](ARC42.md) is the central integrated architecture narrative and mutable implementation-status source. The specialist plans, requirements, and C4 pages below are bounded satellites: they retain their detailed domain narratives and are linked rather than copied into the central status summary. Current claims require source/test/config or dated validation evidence; planned work is labeled explicitly.

| Document                                                                               | Description                                                                                                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR.md](ADR.md)                                                                       | Architecture Decision Records                                                                                                                |
| [ARC42.md](ARC42.md)                                                                   | Central architecture narrative and current implementation-status source                                                                      |
| [docs/arc42/appendix-requirements.adoc](docs/arc42/appendix-requirements.adoc)         | Executable requirement traceability with declared status kept separate from dated target-specific evidence                                   |
| [SKELETON.md](SKELETON.md)                                                             | Stale historical package-layout guide                                                                                                        |
| [docs/IDE_EXTENSION_PLAN.md](docs/IDE_EXTENSION_PLAN.md)                               | Stale historical IDE extension plan retained for migration context                                                                           |
| [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md)                       | Current as-built Java boundary, RefactorKit policy, and unscheduled frozen TODO inventory                                                    |
| [docs/INTELLIJ_ULTIMATE_ROADMAP.md](docs/INTELLIJ_ULTIMATE_ROADMAP.md)                 | Bounded capability research retained as frozen historical inventory; not an active roadmap or parity claim                                   |
| [docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md) | Specialist XCOM 2 requirements separating current machine setup and recognition-only project activation from future interactive/tooling work |
| [docs/c4/system-context.md](docs/c4/system-context.md)                                 | CURRENT/AS-BUILT global Settings, core BottomPanel, and external-system boundary                                                             |
| [docs/c4/target-java-intelligence.md](docs/c4/target-java-intelligence.md)             | Current Java delivery boundary with frozen unscheduled historical inventory; filename retained for stable links                              |
| [docs/c4/target-xcom2-setup.md](docs/c4/target-xcom2-setup.md)                         | Current XCOM 2 recognition and SDK transaction versus target-only configuration, external setup, language, and build architecture            |

---

## License

MIT
