# IDE — Three-Panel Integrated Development Environment

## Project Overview

A **Tauri 2.x** desktop application and **standalone webapp** featuring a three-panel IDE layout:

- **Left sidebar** — accordion navigation with File Explorer above Workspace Explorer; both independently collapsible
- **Right/center area** — Monaco-only code editor with tabs
- **Bottom panel** — dynamic accessible tool-window host; desktop contributes core Terminal and AI Agent plus a conditional project-scoped Problems tab for the current Java context/diagnostics, while web contributes core Terminal only

Built with a **ports-and-adapters (hexagonal) architecture** to share UI and logic between desktop and web runtimes. The webapp builds and runs independently with no Tauri dependency.

**Layout status:** `REQ-LAYOUT-WEB-001` and `REQ-LAYOUT-DESKTOP-001` are both `@implemented-and-validated`. Navigation remains full-height beside an editor-side bottom host. When the whole sidebar is collapsed, its expand control remains in the activity rail; the bottom-panel toggle remains in the status bar in either state. Desktop shell wiring changes visibility without clearing retained dimensions.

**Workspace navigation:** the desktop left sidebar places File Explorer above Workspace Explorer in an accordion. Each section expands and collapses independently. Workspace Explorer lists all registered workspaces and handles switching, refresh, loading, and errors; the duplicate header workspace select has been removed.

**Java project presentation:** package-only namespace chains are compacted only below recognized Java source roots. Compact rows preserve the deepest real node and path, production `src` and test folders are distinguished, and `pom.xml` has a dedicated Maven icon. Ordinary folders and unrecognized hierarchies are not compacted.

**Editor status:** Monaco Editor 0.52.2 is the only editor and is bundled locally for offline operation. It uses same-origin workers, one model per file, and a bundled Java Monarch/basic language contribution for syntax highlighting. Lazy activation waits for a visible, renderable, positive-area active-file host; the timeout starts only then, and layout reruns after visibility returns. With no file open, a Kate-style create-file state is shown. Loading uses an inert source-free placeholder, while import/runtime failure offers Retry Monaco rather than a native fallback. No CDN or broader CSP permission is required.

**Java intelligence status:** **Settings > Java** owns global JDK/JDT LS lifecycle/status and RefactorKit availability/version/path/capability discovery. Managed JDT LS runs through provider-neutral lifecycle, versioned document sync, diagnostics, completion, hover, signature help, and cancellation contracts, typed Tauri adapters, bounded Rust/LSP transport, and guarded Monaco providers. The as-built slice serves only the exact synchronized Java model and enforces workspace/session/path/URI/version/request/cancel identity, optimistic model versions, serialized full-text `didChange` flushes before semantic requests, cancellation, and stale/late-result suppression. Current diagnostics feed Monaco and a conditional project-scoped Problems tab; this does not imply module activation. Completion maps only the primary edit; additional/workspace edits and commands are suppressed. Markdown is untrusted with HTML disabled, and managed configuration sets `java.signatureHelp.enabled=true`. Web exposes no Java tab or hidden Java polling and does not simulate native support.

**Java roadmap freeze:** definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, the full contextual Problems/Build/Tests/Logs lifecycle, and other contextual Java tooling are unscheduled TODO/frozen historical inventory, not active milestones. No broader JDT LS IntelliSense expansion is scheduled until a relevant released RefactorKit capability passes immutable real acceptance validation. See the [current Java boundary and frozen inventory](docs/JAVA_INTELLISENSE_PLAN.md).

**RefactorKit status:** the current IDE capability bucket contains provider status/capability discovery and the bounded **Paste Java Class from Clipboard** transaction. The desktop directory tree implements the context action and tree-focused `Ctrl/Cmd+V`, explicit clipboard adapter, capability-first coordinator, rich `targetDirectory` review, exact-plan approval/apply, returned transaction display, backend-result tree refresh/primary-file open, and stale workspace/selection guards. It does not intercept editor paste, install a global listener, copy raw Java, infer a package, write project content directly, or disclose clipboard/plan/transaction data to Pi. Cancel and invalidation clear local plan authority synchronously before asynchronous correlated discard cleanup; discard failure cannot restore authority.

`REQ-REFACTORKIT-JAVA-IMPORT-001` is declared `@implemented-not-e2e-validated` and has deterministic `desktop/tauri-harness` evidence only: 1 scenario and 22/22 steps under jsdom with the production desktop flow over a fake in-process Tauri backend and mocked Monaco textarea. Preview/no-write evidence means no imported target or other project-content write before Apply; it does not claim hidden-workspace-metadata identity, and provider `project.open` may create `.refactorkit/workspace.lock`. Backend rollback exists in contracts, adapters, Rust, and provider authority, but the current UI exposes no rollback action. The harness does not prove the OS clipboard, native GUI, real Monaco, live provider, native filesystem authority, or a packaged application.

`REQ-REFACTORKIT-JAVA-IMPORT-002` is separately declared `@implemented-and-validated`. Its independent 2026-07-16 focused run at `5146221` passed 1 scenario/36 Cucumber markers against a fresh production release/no-bundle executable on Linux X11. Through the real Tauri WebKit UI, the actual File Explorer context menu and review dialog consumed a GTK-owned OS clipboard via the production native command and opened the result in real Monaco. Two exact-hash previews returned distinct plans: the first was correlated to one discard with no target, and the second reached the fixture daemon as Apply params containing only `{ "planId": "native-java-import-plan-002" }`. The daemon recorded one primary target creation, the exact workspace tree changed 8→9 entries, the retained transcript contained no source, scenario `.refactorkit` remained absent, and configured-root plus owned-process cleanup passed. This is deterministic sandbox-fixture evidence only—not real/global/immutable/packaged RefactorKit, provider metadata/no-write, raw IPC or clipboard-read cardinality, syscall/global confinement, package, Wayland/other-OS, rollback UI, or `REQ-REFACTORKIT-JAVA-IMPORT-001` stale-matrix evidence.

TypeScript diagnostics and semantic navigation remain declared `@not-implemented` and parked under option A for confirmed protocol/provider bugs. Option A authorizes no `.refactorkit/workspace.lock` or other metadata-write exception for read-only navigation. Structural outline and identifier search are working provider foundations; TypeScript references and rename are experimental provider foundations; general Java refactoring beyond import is unintegrated TODO. Announced optional-JSON RefactorKit search operations remain TODO until a released strict typed bounded versioned machine-readable contract includes structured errors, truncation, locations, correlation, and real acceptance evidence. The IDE never parses human-oriented stdout as a protocol.

**XCOM 2 status:** desktop Settings has an AS-BUILT read-only machine monitor and concrete repeatable native setup transaction under the fixed, built-in, experimental `ide.xcom2-wotc` descriptor. The pure dry-run planner remains separate and non-executable. Prepare audits vanilla SDK AppID `602410`; the validated baseline yields exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game. Machine-level journals/backups bind the Steam build/manifest/root fingerprint and exact original bytes, hashes, modes, inventory, and symlink absence. Apply requires exact-digest approval for the single external-SDK transaction. Restore Vanilla SDK restores the captured baseline exactly, refuses conflicting overwrites, and supports rollback followed by Prepare Again. A live Prepare audit reported 15 operations, executable, with no blockers; no live Apply occurred. Protontricks, Steam shortcut, prefix, package-manager, and interactive steps remain FUTURE/TARGET and non-executable. The browser setup adapter reports unavailable without simulation.

`REQ-XCOM2-MACHINE-SETTINGS-001` is `@implemented-not-e2e-validated`. Closed Settings performs zero XCOM monitor/history/detail/poll/subscription work across cold start and workspace switching. Open or reopened Settings owns exactly one monitor and one transaction adapter lifecycle; initial open performs one snapshot and one history load, manual refresh performs one refresh and one further history load, and close synchronously invalidates/unsubscribes/clears both timers. Open switches, failed restoration, and stale completions remain generation-guarded. Its 27/27 deterministic steps use the production `App`, controllers, and typed Tauri adapters over a fake backend and clock, excluding native GUI, real IPC, live Steam, real filesystem, package, bundle, and installer evidence.

`REQ-XCOM2-MODULE-ACTIVATION-001` is separately `@implemented-and-validated` for the current recognition-only slice. One generation-correlated controller request crosses a strict Tauri adapter to a dedicated read-only Rust metadata/name scanner over the authorized Linux workspace. Option A accepts exact-case regular entries, rejects symlinks, excludes `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`, and `.vite`, and reports depth-8 or 20,000-entry truncation. A pure evaluator requires two distinct evidence kinds under one inferred module root; workspace or file names and one-kind evidence do not activate. Only then does the dynamic accessible **XCOM 2 Project** activity appear. Committed switches remove it synchronously and generation correlation suppresses stale restoration. The focused native Story passed 1 scenario/26 reported steps (25 authored plus cleanup) against the actual sandbox filesystem and production Linux X11 release/no-bundle Tauri WebKit DOM at 1440×900. Explicit configuration, manual confirmation/persistence, external roots, proprietary compatibility, content parsing, Build, Problems, Logs, language support, actions, and bottom contributions remain future; Settings is separate and cannot activate recognition.

---

## Architecture

### Hexagonal Architecture

```
┌─────────────────────────────────────┐
│     UI Components (presentation)    │
│  FileTree / Editor / Terminal / ... │
└──────────────┬──────────────────────┘
               │ receives props/callbacks
┌──────────────┴──────────────────────┐
│        View Models / State          │
│   (web-core: ports, stores, logic) │
└──────────────┬──────────────────────┘
               │ uses port implementations
┌──────────────┴──────────────────────┐
│         Adapter Layer               │
│  browser-adapters │ tauri-adapters  │
└─────────────────────────────────────┘
```

**Core design rule**: UI never talks directly to platform APIs. App shells wire UI props to view models, view models use ports from `packages/web-core/ports/`, and `@ide/browser-adapters` or `@ide/tauri-adapters` implement those ports.

### Current DDD composition and application boundary

`apps/desktop/src/App.tsx` is a composition-only root. Six extracted controllers own Settings, Terminal, File Explorer, Document Navigation, Editor Command, and Desktop Shell coordination; the root wires these to stores, view models, adapters, and nine extracted application controllers:

- **Editor** — guarded open/create, tab lifecycle, deferred restore, workspace reset, and safe presentation state;
- **Java Language** — language lifecycle, versioned document sync, diagnostics, guarded semantics, cancellation, and stale-result rejection;
- **RefactorKit Import** — separate capability-gated clipboard import preview/apply orchestration;
- **RefactorKit Symbol Navigation** — parked implementation-informed orchestration support; the immutable real provider violates its no-workspace-write contract, so this is not a current IDE capability;
- **Workspace** — registry and authorized-root transition plus the shared workspace-generation authority;
- **AI Agent** — configuration/status and workspace-isolated commands, sessions, activities, prompts, and request lifecycle;
- **XCOM Setup** — Settings-owned monitor/transaction adapter lifecycles, workspace-correlated transaction authority, pure planning, event re-reads, and stale-transition guards;
- **XCOM Module Activation** — one-shot authorized-workspace recognition, pure two-kind evaluation, synchronous deactivation, stale-result suppression, and recognition-only activity state; and
- **RefactorKit Status** — provider-neutral, diagnostic-only status and capability discovery, with no mutation authority.

Cold start authorizes the current root before registry promotion and all dependent workspace reads/restores. Workspace authorization supplies XCOM correlation and permits one recognition scan for that generation; it does not start machine monitor/transaction runtime work, which only open Settings owns. `WorkspaceGeneration` starts positive and increases monotonically on user workspace-switch attempts, allowing collaborators to reject stale completions. RefactorKit Import starts positive independently and uses the shared authority in desktop composition.

The Rust Java Language boundary is a 123-line Tauri facade over application, contract, path-policy, protocol, semantic, toolchain, and support modules. The RefactorKit daemon boundary is a 63-line Tauri facade over application, capability-policy, contract, path-policy, and transport modules. These facades preserve the inbound command boundary while keeping process ownership, policy, and orchestration modular.

This is partial DDD-roadmap delivery, not full completion. Native file opening is separately complete: its Linux X11/Xvfb Tauri WebKitWebDriver Story passed 1 scenario and 16/16 steps against a freshly built release/no-bundle executable. Bounded deterministic-fixture native Java import is also promoted under its separate requirement and limits above. Promoted desktop layout retains its earlier deterministic 9/9 harness history and has independent 1-scenario/9-step native evidence at `146f10a`: Linux X11 release/no-bundle WebView DOM at an asserted 1440×900 viewport, two exact +10 keyboard resizes, seven settled states, collapse/re-expand of both panels, full-height navigation, editor-side bottom topology, application-header/status stability within ±1 px, separator ARIA/focus behavior, and cleanup. The configured inventory is **6 validated, 2 harness-only, and 2 not implemented**. The canonical implemented aggregate routes **2 web, 2 deterministic desktop harness, and 4 native GUI** scenarios. Layout, file-open, native Java-import, and XCOM-recognition support use distinct per-scenario native environment leases, including isolated `IDE_HOME` and workspace roots, to prevent `.ide` state cross-contamination. These native results are direct repository-build evidence, not OS decoration, package/installer, Wayland, other-OS/DPI, drag-resize, restart-persistence, optional-right-sidebar, screen-reader, or reproducible-binary evidence; `synapse-ide-desktop` packaging remains postponed until the full-build milestone. Detailed slice status remains centralized in [ARC42](ARC42.md#ddd-roadmap-status).

### C4 Architecture Diagrams

| Diagram                 | File                                                                       | Description                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **C1 — System Context** | [docs/c4/system-context.md](docs/c4/system-context.md)                     | Current external actors/tools, including the full JDK, external JDT LS, and RefactorKit                       |
| **C2 — Containers**     | [docs/c4/containers.md](docs/c4/containers.md)                             | Current web/desktop containers and the managed desktop JDT LS lifecycle boundary                              |
| **C3 — Components**     | [docs/c4/components.md](docs/c4/components.md)                             | Current global Settings, dynamic BottomPanel, and frozen Java inventory boundary                              |
| **Java Current/Frozen** | [docs/c4/target-java-intelligence.md](docs/c4/target-java-intelligence.md) | Delivered Java lifecycle/semantics plus unscheduled historical activation/navigation/action inventory         |
| **XCOM 2 Boundary**     | [docs/c4/target-xcom2-setup.md](docs/c4/target-xcom2-setup.md)             | Current recognition and SDK transaction versus target-only configuration, external setup, and project tooling |

---

## Packages

### Workspace Structure (pnpm monorepo)

```
ide/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
│
├── apps/
│   ├── web/                  # Standalone webapp (no Tauri dep)
│   └── desktop/              # Tauri desktop app
│       └── src-tauri/        # Rust/Tauri code (commands, lib, main)
│
├── packages/
│   ├── contracts/            # Shared TypeScript types/interfaces
│   ├── web-core/             # Ports, Zustand stores, view models
│   ├── ui/                   # Reusable React UI components
│   ├── browser-adapters/     # Browser implementations of ports
│   └── tauri-adapters/       # Tauri implementations of ports
│
└── scripts/                  # Build/test/lint scripts
```

### Package Details

| Package                      | Responsibility                               | Tauri Dependency |
| ---------------------------- | -------------------------------------------- | ---------------- |
| `apps/web/`                  | Standalone webapp entry point                | No               |
| `apps/desktop/`              | Tauri desktop app entry point                | Yes (Rust + TS)  |
| `packages/contracts/`        | Shared TypeScript types                      | No               |
| `packages/web-core/`         | Port interfaces, Zustand stores, view models | No               |
| `packages/ui/`               | Reusable React UI components                 | No               |
| `packages/browser-adapters/` | Browser implementations of ports             | No               |
| `packages/tauri-adapters/`   | Tauri implementations of ports               | Yes (TS only)    |

### Web Core Components

| Component             | Type          | Description                                     |
| --------------------- | ------------- | ----------------------------------------------- |
| **FileTreePort**      | Interface     | File system operations for file tree            |
| **EditorPort**        | Interface     | Editor file operations                          |
| **TerminalPort**      | Interface     | Terminal execution operations                   |
| **FileTreeStore**     | Zustand store | File tree state: nodes, expansion, selection    |
| **EditorStore**       | Zustand store | Editor tabs, content buffers, cursor positions  |
| **TerminalStore**     | Zustand store | Terminal output, command history, session state |
| **PanelStore**        | Zustand store | Panel layout visibility, sizes, resize          |
| **FileTreeViewModel** | View Model    | Wraps FileTreeStore + FileTreePort              |
| **EditorViewModel**   | View Model    | Wraps EditorStore + EditorPort                  |
| **TerminalViewModel** | View Model    | Wraps TerminalStore + TerminalPort              |

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

## Test Status

The dated evidence ledger is centralized in [ARC42 section 10](ARC42.md#section-10-quality-requirements). At implementation baseline `5cdc9c0`, `pnpm test:coverage` passes **1021/1021 frontend tests**. V8 measures owned production TS/TSX in contracts, web-core, UI, browser/Tauri adapters, web, and desktop at **86.37% statements/lines, 82.66% branches, and 86.74% functions**, excluding declarations, tests, dependencies, build output, and generated code. No coverage thresholds are configured. The Spec suite passes 132/132 cases, and Rust defaults report 181 passed plus 8 ignored. Story profiles, real-browser execution, native GUI/WebDriver, Spec, and Rust remain separate evidence rather than being included in a combined coverage claim.

The generic `pnpm test:e2e` route now passes **2 Playwright Chromium web scenarios/16 steps**, followed by **4 Linux Tauri-WebDriver native scenarios/87 reported steps** against one freshly built release/no-bundle executable. The native route covers promoted layout, file opening, bounded deterministic-fixture Java import, and recognition-only XCOM activation. It excludes the deterministic `desktop/tauri-harness`, while that aggregate passes **2 scenarios/49 steps** and the broader canonical declared Story aggregate is **2 web, 2 harness, and 4 native GUI scenarios**. Java import `-001` remains bounded to 22/22 harness steps over jsdom, fake Tauri effects, and mocked Monaco; XCOM machine Settings remains bounded to 27/27 steps over the production composition with fake Tauri effects and time.

ESLint 9 performs substantive JavaScript and TypeScript analysis through `@eslint/js` and `typescript-eslint`, and `pnpm lint:strict` passes with zero warnings. The React 18 compatibility scope enables the canonical `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` rules only; React Compiler-specific rules require a separate adoption decision. The repository-wide Prettier gate passes with zero failures after isolated AST-equivalent formatting batches across root/configuration and every application/package area.

The locally styled architecture model validates with no remote Cloud theme dependency or EOL warning, including a network-isolated run once Structurizr CLI 2026.06.28 is available. First-time CLI or execution-image acquisition may still require network access and remains an execution-environment responsibility. Remaining quality/maturity gaps are explicit: no V8 thresholds, the generic E2E route excludes the deterministic harness, native Java-import evidence is bounded to the sandbox fixture daemon rather than a real/global/immutable/packaged provider or package, both TypeScript/JavaScript RefactorKit requirements remain parked under option A, and `synapse-ide-desktop` packaging remains postponed until the full-build milestone.

Real JDT LS lifecycle and semantic smokes passed; the semantic smoke covered repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and stop. Separate temporary-workspace RefactorKit evidence establishes no imported-target or other project-content write before Apply, discard invalidation, exact apply, and byte-for-byte backend rollback for the tested fixtures; it is not complete hidden-metadata identity or user-facing rollback evidence. Synthetic XCOM fixtures continue to prove repeatable apply→rollback and conflict-safe recovery, while the ignored live Prepare audit reported exactly 15 executable operations with no blockers and performed no live Apply.

---

## Build Instructions

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

# Build all
pnpm build:all
```

### External Java tools and test evidence

Install a full JDK separately and make `java` discoverable through `JAVA_HOME` or `PATH`. Install and verify the pinned, checksum-protected external JDT LS tool with:

```bash
pnpm tools:install-jdtls
pnpm tools:verify-jdtls
```

JDT LS and the JDK are not bundled or redistributed; JDT LS is external EPL-2.0 software and the selected JDK has its own terms. Real integration passed with JDT LS `1.61.0-202607102111` and JDK `25.0.3`. The external lifecycle and semantic smoke tests are intentionally ignored by default; after installing both tools, run:

```bash
cd apps/desktop/src-tauri
cargo test --locked managed_jdtls_real_initialize_poll_and_graceful_stop -- --ignored --nocapture
cargo test --locked managed_jdtls_real_semantic_completion_hover_and_signature_smoke -- --ignored --nocapture
```

The read-only XCOM 2 live Steam probe is also intentionally ignored by default:

```bash
cd apps/desktop/src-tauri
cargo test --locked live_steam_snapshot_probe -- --ignored --nocapture
```

Earlier time-specific monitor samples captured download/staging behavior before the installations became complete and stable. The latest ignored live Prepare audit reported exactly 15 executable operations with no blockers. This is historical validation evidence, not a static status promise; no live Apply or visual result is claimed.

### Test

```bash
# Run the 1021-test frontend suite and owned TS/TSX V8 baseline
pnpm test:coverage

# Run implemented real E2E routes only (web Playwright, then native Tauri WebDriver)
pnpm test:e2e

# Run substantive ESLint with zero warnings and the repository-wide formatting gate
pnpm lint:strict
pnpm exec prettier --check "**/*.{ts,tsx,js,jsx,json,css,md}"
```

---

## Agent Workflow

Documentation governance is in **`bdd-ts` migration mode** from Git baseline `53addeb2654ac8e85ac153f5ac10ae99f2816d51`. The `bdd-ts-planner` orchestrates evidence and handoffs; `bdd-ts-architect` owns README and ARC42 integration, requirements reconciliation, risks, glossary, and architecture status; `c4model` owns C4/Structurizr artifacts; and `bdd-ts-adr-writer` owns ADR bodies.

---

## Documentation Index

[ARC42.md](ARC42.md) is the central integrated architecture narrative and mutable implementation-status source. Specialist plans, requirements, and C4 artifacts are bounded satellites; this summary links to them without replacing their detailed narratives. Current facts are evidence-backed, while future work is labeled planned or target.

| Document                                                                               | Description                                                                                                          |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [README.md](README.md)                                                                 | Project overview, setup, usage, architecture links                                                                   |
| [SUMMARY.md](SUMMARY.md)                                                               | This file — comprehensive project summary                                                                            |
| [ADR.md](ADR.md)                                                                       | Architecture Decision Records                                                                                        |
| [ARC42.md](ARC42.md)                                                                   | Central architecture narrative and current implementation-status source                                              |
| [SKELETON.md](SKELETON.md)                                                             | Stale historical package-layout guide                                                                                |
| [docs/IDE_EXTENSION_PLAN.md](docs/IDE_EXTENSION_PLAN.md)                               | Stale historical IDE extension plan retained for migration context                                                   |
| [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md)                       | Current Java delivery boundary, RefactorKit policy, and frozen unscheduled TODO inventory                            |
| [docs/INTELLIJ_ULTIMATE_ROADMAP.md](docs/INTELLIJ_ULTIMATE_ROADMAP.md)                 | Capability research retained as frozen historical inventory; no active sequencing or parity claim                    |
| [docs/c4/system-context.md](docs/c4/system-context.md)                                 | C1 System Context diagram                                                                                            |
| [docs/c4/target-java-intelligence.md](docs/c4/target-java-intelligence.md)             | Current Java provider boundary plus frozen unscheduled historical inventory                                          |
| [docs/c4/containers.md](docs/c4/containers.md)                                         | C2 Container diagram                                                                                                 |
| [docs/c4/components.md](docs/c4/components.md)                                         | C3 Component diagram                                                                                                 |
| [docs/c4/target-xcom2-setup.md](docs/c4/target-xcom2-setup.md)                         | Current XCOM 2 recognition and SDK transaction versus target-only configuration, external setup, and project tooling |
| [docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md) | Specialist XCOM 2 requirements separating current machine/recognition slices from future tooling                     |

---

## License

MIT
