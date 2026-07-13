# IDE — Tauri Desktop + Reusable Webapp

## Architecture Overview

A three-panel Integrated Development Environment built with Tauri (desktop) and reusable as a standalone webapp.

### Panel Layout

```
┌──────────────────────────────────────────────────────┐
│                    Menu / Toolbar                     │
├──────────┬──────────────────────────┬────────────────┤
│  Left     │      Editor (Right)      │  Future Right  │
│  Sidebar  │                          │  Sidebar       │
│  File +   │  (open file / tabs)      │  (reserved)    │
│ Workspace │                          │                │
│           │                          │                │
├──────────┴──────────────────────────┴────────────────┤
│       Dynamic Accessible Bottom Tool-window Host      │
│ Desktop: Terminal + AI Agent + conditional Problems  │
│ Web: Terminal only                                   │
└──────────────────────────────────────────────────────┘
```

The AS-BUILT desktop left sidebar is an accordion: File Explorer appears above Workspace Explorer, and both sections expand or collapse independently. Workspace Explorer lists all registered workspaces and owns switching, refresh, loading, and error feedback. The duplicate header workspace selector has been removed.

### Tech Stack

| Layer              | Technology                         |
| ------------------ | ---------------------------------- |
| Desktop shell      | Tauri 2.x (Rust)                   |
| Frontend framework | React 18 + TypeScript              |
| Editor             | Monaco Editor (web)                |
| Terminal           | xterm.js + Tauri shell plugin      |
| Build tooling      | Vite + pnpm workspaces             |
| CSS                | Tailwind CSS + Radix UI primitives |
| State management   | Zustand                            |

### Package Layout (pnpm workspace)

```
workspace/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json                # optional Turborepo config
│
├── apps/
│   ├── web/                  # Standalone webapp (no Tauri dep)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── adapters/     # Web-specific adapter implementations
│   │       └── ...
│   │
│   └── desktop/              # Tauri desktop app
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   └── adapters/     # Tauri-specific TS adapters
│       └── src-tauri/        # Rust/Tauri code
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           ├── src/
│           │   ├── lib.rs
│           │   ├── main.rs
│           │   ├── commands/  # Rust commands
│           │   └── ...
│           └── capabilities/
│
├── packages/
│   ├── contracts/            # Shared TypeScript types/interfaces
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── editor.ts     # Editor port types
│   │       ├── file-tree.ts  # File tree types
│   │       ├── terminal.ts   # Terminal port types
│   │       └── panel.ts      # Panel layout types
│   │
│   ├── web-core/             # Reusable frontend logic, ports, view models
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ports/        # Interfaces (EditorPort, FileTreePort, TerminalPort, etc.)
│   │       ├── state/        # Zustand stores
│   │       └── view-models/  # View models for panels
│   │
│   ├── ui/                   # Reusable UI components (no Tauri imports)
│   │   ├── package.json
│   │   └── src/
│   │       ├── components/
│   │       │   ├── FileTree/
│   │       │   ├── Editor/
│   │       │   ├── Terminal/
│   │       │   ├── PanelLayout/
│   │       │   └── ui/       # Design system primitives
│   │       └── index.ts
│   │
│   ├── browser-adapters/     # Browser implementations of ports
│   │   ├── package.json
│   │   └── src/
│   │       ├── file-tree-browser.ts
│   │       ├── editor-browser.ts
│   │       ├── terminal-browser.ts
│   │       └── index.ts
│   │
│   └── tauri-adapters/       # Tauri-specific TS implementations
│       ├── package.json
│       └── src/
│           ├── file-tree-tauri.ts
│           ├── editor-tauri.ts
│           ├── terminal-tauri.ts
│           └── index.ts
│
└── scripts/                  # Build/test/lint scripts
    ├── build-all.sh
    ├── test-all.sh
    └── check-boundaries.sh
```

### Ports & Adapters Pattern (Hexagonal Architecture)

```
┌─────────────────────────────────────┐
│     UI Components (presentation)    │
│  FileTree / Editor / Terminal / ... │
└──────────────┬──────────────────────┘
               │ uses ports (interfaces)
┌──────────────┴──────────────────────┐
│        View Models / State          │
│   (web-core: ports, stores, logic) │
└──────────────┬──────────────────────┘
               │ implemented by adapters
┌──────────────┴──────────────────────┐
│         Adapter Layer               │
│  browser-adapters │ tauri-adapters  │
└─────────────────────────────────────┘
```

### Key Architecture Rules

1. `packages/ui/**` and `packages/web-core/**` must not import `@tauri-apps/api`
2. `apps/web/**` must build and run without Tauri
3. Tauri/native integration lives in `apps/desktop/src-tauri/**` and `packages/tauri-adapters/**`
4. Browser/web implementations live in `packages/browser-adapters/**` and `apps/web/src/adapters/**`
5. UI talks to ports/view models, not directly to native APIs

### Data Flow

```
User clicks file in FileTree
  → FileTree component calls FileTreePort.onFileSelect(filePath)
  → ViewModel updates activeFile state
  → Editor component reads activeFile and calls EditorPort.loadContent(filePath)
  → Adapter (browser or Tauri) reads file and returns content
  → Editor displays content
```

### Terminal Flow

```
User types in Terminal component
  → TerminalPort.sendCommand(command)
  → Adapter (browser: mock/pty; Tauri: shell plugin) executes
  → Output streamed back to Terminal component
```

---

## DDD Roadmap Status

This section is the implementation-informed roadmap ledger. [ARC42.md](ARC42.md) remains the central integrated architecture narrative and evidence ledger; specialist plans and requirements remain bounded satellites and are linked rather than duplicated. The structural decomposition slices below are delivered, but the roadmap is not complete.

### Implemented controller slices

| Desktop application controller | Current implementation boundary                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Editor**                     | Guarded open/create, tab lifecycle, deferred restore, workspace reset, and safe presentation state                      |
| **Java Language**              | Workspace language lifecycle, document sync, diagnostics, guarded semantics, cancellation, and stale-result suppression |
| **RefactorKit Import**         | Capability-gated clipboard import preview/apply orchestration with exact-plan and generation checks                     |
| **Workspace**                  | Registry and authorized-root orchestration plus the positive, monotonic `WorkspaceGeneration` authority                 |
| **AI Agent**                   | Configuration/status and workspace-isolated command, session, activity, prompt, and request lifecycle                   |
| **XCOM Setup**                 | Monitor, pure planner, native transaction/history, event, and workspace-transition orchestration                        |
| **RefactorKit Status**         | Provider-neutral diagnostic status/capability discovery only; no provider assumption or mutation authority              |

The cold-start transition is explicit: `ensureCurrentWorkspace` authorizes the root before registry listing/promotion and before workspace-scoped editor restore, file-tree loading, Java attach/load, AI command/session activation, RefactorKit diagnostics, or XCOM loading. The generation starts at 1, remains positive, and advances monotonically on user workspace-switch attempts; stale completions are rejected. RefactorKit Import starts at generation 1 for standalone use and consumes the Workspace controller's generation in desktop composition.

### Delivered structural slices

| Slice                             | CURRENT/AS-BUILT result                                                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop composition**           | `apps/desktop/src/App.tsx` is a 672-line composition-only root. Settings, Terminal, File Explorer, Document Navigation, Editor Command, and Desktop Shell controllers own the extracted shell/document/editor coordination.                                                               |
| **Java Language native boundary** | `java_language.rs` is a 123-line Tauri facade over application, contract, path-policy, protocol, semantic, toolchain, and support modules.                                                                                                                                                |
| **RefactorKit native boundary**   | `refactorkit_daemon.rs` is a 63-line Tauri facade over application, capability-policy, contract, path-policy, and transport modules.                                                                                                                                                      |
| **RefactorKit compatibility**     | Authorization is provider-version-neutral. Advertised API, required method capabilities, normalized language-kernel metadata, and exact safety fields govern support; provider version is diagnostic only. Real temporary-workspace smoke runs passed against both 0.5 and 0.6 providers. |

### Remaining planned slices

1. Convert the relevant roadmap requirements/specifications into executable artifacts.
2. Complete a real unlocked click-to-open smoke test. The available graphical session locked, so this remains pending and no GUI result is claimed.

These are planned items, not delivered capabilities. Full DDD completion is not claimed. Detailed capability narratives remain in [IDE extension planning](docs/IDE_EXTENSION_PLAN.md), the [IntelliJ capability roadmap](docs/INTELLIJ_ULTIMATE_ROADMAP.md), the [Java IntelliSense plan](docs/JAVA_INTELLISENSE_PLAN.md), and the [XCOM 2 requirements](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md).

---

## Capability Roadmap

The evidence-based [IntelliJ IDEA Ultimate Capability Analysis and Implementation Roadmap](docs/INTELLIJ_ULTIMATE_ROADMAP.md) is the product-level reference for capability scope, the Java deep dive, provider ownership, gaps, backlog, and phased acceptance criteria. It complements this foundational architecture plan and does not claim IntelliJ IDEA Ultimate parity.

### Java language-service status — lifecycle, synchronization, and interactive Phase 2

**Implemented:** provider-neutral lifecycle, document-sync, diagnostics, completion, hover, signature-help, and cancellation contracts; desktop discovery of a full JDK and checksum-installed external JDT LS; fixed no-shell launch with isolated per-workspace data; LSP initialization and bounded transport; typed Tauri adapters; guarded Monaco providers; and diagnostic projection into Monaco plus a conditional project-scoped Problems tab. Java requests run only for the exact synchronized Monaco model. Workspace/session/path/URI/version/request/cancel guards, optimistic model versions, serialized full-text `didChange` flushes before semantic requests, cancellation, and stale/late suppression protect the edit loop. Completion applies only its primary edit; additional/workspace edits and commands are suppressed. Markdown is untrusted with HTML disabled. Managed configuration sets `java.signatureHelp.enabled=true`. The current Problems visibility guard does not imply module activation.

**Still future:** evidence-based Java project/module activation; the full activated-module Problems, Build, Tests, Logs, and Java tools lifecycle; definition/references with Monaco gestures; code actions; formatting; rename; hierarchy; and broader refactoring preview/apply. Fixed native RefactorKit project-action handlers remain unexposed globally until activation exists.

Install a full JDK separately, then install/verify the pinned external JDT LS release:

```bash
pnpm tools:install-jdtls
pnpm tools:verify-jdtls
```

Neither the JDK nor JDT LS is bundled or redistributed. JDT LS is external EPL-2.0 software; the chosen JDK has its own license. The external-tool tests are intentionally ignored by default and can be run after installation:

```bash
cd apps/desktop/src-tauri
cargo test --locked managed_jdtls_real_initialize_poll_and_graceful_stop -- --ignored --nocapture
cargo test --locked managed_jdtls_real_semantic_completion_hover_and_signature_smoke -- --ignored --nocapture
```

The real semantic smoke passed repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and stop. **Next Java slices:** definition/references transport and Monaco gestures, then code actions, formatting, rename, and hierarchy. Project activation and contextual tools remain separate future work. Global Settings remains limited to tooling lifecycle/status/availability.

### Paste Java Class from Clipboard integration

**CURRENT operational implementation:** a selected directory exposes **Paste Java Class from Clipboard** through its context menu and through `Ctrl/Cmd+V` only while the directory tree owns focus. Editor paste is untouched. The app shell coordinates typed clipboard and RefactorKit ports; it validates the target, capability-probes before one explicit clipboard read, requests a `targetDirectory` preview, presents complete provider evidence, and permits apply only for the exact ready/eligible/non-stale plan and matching workspace/selection generations. Unknown/high-risk provenance requires acknowledgement. Apply sends the approved `planId` rather than source or reconstructed edits, displays the returned opaque transaction, then refreshes and opens only backend-reported changed/primary files. Cancel, selection change, and workspace invalidation invoke `refactor.discard`. RefactorKit is the sole writer and rollback authority; the IDE performs no package inference or direct-write fallback and has no clipboard/source/plan/transaction route to Pi.

**CURRENT managed boundary:** Rust owns one `bin/refactorkit-daemon` NDJSON process for the authorized workspace generation. Compatibility is provider-version-neutral: the bridge validates API `0.2`, required methods and features, normalized language-kernel metadata, and exact safety fields; provider version is retained only for diagnostics. It opens the canonical workspace, normalizes rich preview output, applies the exact `planId`, discards pending plans, and rolls back by transaction ID. Malformed output, timeout, workspace switch, and application exit terminate the daemon. Protocol logs contain operation metadata but never source. Missing or incomplete providers remain unavailable before clipboard read; there is no force switch or target-package adaptation.

**Unsupported/refused cases:** missing or failed capability probing; no directory; stale workspace or selection; empty or oversized clipboard text; provider refusal/error/staleness; plan correlation mismatch; conflicts, blockers, or ineligible apply; unacknowledged unknown/high-risk provenance; approval/plan mismatch; apply failure; and cancellation. None authorizes a fallback write.

**Validation evidence:** the dated evidence ledger is centralized in [ARC42 section 10](ARC42.md#section-10-quality-requirements). The latest records include 719 passing frontend tests; 158 passing Rust unit tests plus integration results; real JDT LS lifecycle and semantic smokes; and real temporary RefactorKit preview/no-write, discard, exact-apply, and byte-for-byte rollback smokes against both 0.5 and 0.6 providers. The unlocked click-to-open GUI smoke remains pending because the graphical session locked; no GUI or browser visual/e2e result is claimed.

### XCOM 2 first-party feature status and roadmap

This capability is separate from, and does not reprioritize or replace, the Java/JDT LS/RefactorKit/IntelliJ roadmap above.

**CURRENT/AS-BUILT machine Settings contribution:**

- fixed first-party feature descriptor `ide.xcom2-wotc`; built-in, experimental, and plugin-shaped, not a generic plugin runtime or general permission grant;
- bounded read-only Steam monitor with conservative, redacted state; the pure dry-run plan remains separate and non-executable;
- concrete Prepare audit for vanilla SDK AppID `602410`, yielding exactly 15 reversible operations on the validated baseline: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game;
- machine-level write-ahead journals and content-addressed backups capturing the Steam build/manifest/root fingerprint and exact original bytes, hashes, modes, inventory, and symlink absence;
- exact complete-digest approval for one external-SDK Apply transaction, with path/hash/workspace/generation gates;
- Restore Vanilla SDK exact-baseline restoration, conflict refusal, reverse rollback/recovery, and rollback followed by Prepare Again;
- Settings transaction history, state, operations, full digest, approval, cancel, restore, and recovery controls;
- explicit browser setup unavailability without simulation; generic workspaces still have no XCOM activity entry or bottom tab.

Synthetic tests prove repeatable apply→rollback cycles and conflict-safe recovery. The live Prepare audit reported exactly 15 operations, executable, with no blockers; no live Apply was performed.

**FUTURE/TARGET external interactive setup:** Protontricks, Steam shortcut creation, Proton-prefix provisioning/copying, package-manager operations, and all interactive steps remain excluded and non-executable. General reusable external-root grants, production readiness verification beyond this concrete SDK transaction, and carefully approved live Apply validation also remain future work.

**FUTURE/TARGET project/module activation and workflows:** the same global-settings-versus-project-contributions rule applies to Java and XCOM. Explicit configuration or conservative evidence detection may activate an XCOM module. Candidate evidence includes `*.x2proj`, `*.XComMod`, `.scripts/build.ps1` together with X2ModBuildCommon, `Config/XComEngine.ini`, and `Src/<package>/Classes/*.uc`. Activation must expose confidence and reasons, combine weak evidence conservatively, and never activate merely because a path or workspace name contains `xcom`. Only activated modules receive contextual XCOM project UI, Build, Problems, Logs, and language contributions. Project modeling, UnrealScript language support, X2MBC build/cook execution, Highlander integration, launch, and logs remain unimplemented. A generic plugin runtime requires a separate security/API decision; the current module is not proof that arbitrary plugins can run.

See [XCOM 2 requirements and traceability](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md) and the [current/target C4 boundary](docs/c4/target-xcom2-setup.md).
