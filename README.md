# IDE — Three-Panel Integrated Development Environment

A **Tauri 2.x** desktop application and **standalone webapp** featuring a three-panel IDE layout:

- **Left sidebar** — accordion navigation with File Explorer above Workspace Explorer; each section expands and collapses independently
- **Right/center area** — Monaco-only code editor with tabs
- **Bottom panel** — dynamic, accessible tool-window host; desktop contributes core Terminal and AI Agent plus a conditional project-scoped Problems tab for the current Java context/diagnostics, while web contributes core Terminal only

Built with a **ports-and-adapters (hexagonal) architecture** to share UI and logic between desktop and web runtimes.

The desktop sidebar is an accordion with **File Explorer above Workspace Explorer**. Both sections expand and collapse independently. Workspace Explorer lists every registered workspace and owns switching, refresh, loading, and error feedback; the former duplicate workspace selector in the header has been removed. The file tree recognizes conventional Java source roots and compacts package-only namespace chains beneath them without changing the deepest real path used for expansion and file opening. Production source and test folders remain visually distinct, and `pom.xml` uses a dedicated Maven icon. Unrecognized folders retain their ordinary hierarchy.

[Monaco Editor 0.52.2](https://github.com/microsoft/monaco-editor) is the only editor. It is bundled locally for offline use with same-origin workers, one model per file, and a bundled Java Monarch/basic language contribution for syntax highlighting. Monaco mounts lazily only after an active file host is visible, renderable, and has positive area; the load timeout starts only then, and layout runs again after visibility returns. With no file open, the editor shows a Kate-style create-file state. While Monaco loads, it shows an inert source-free placeholder; import or runtime failure offers **Retry Monaco**, never a native editor fallback. No CDN or Content Security Policy expansion is required.

Java intelligence is desktop-only and presented according to scope. **Settings > Java** owns global tooling: full-JDK and external JDT LS discovery plus managed lifecycle/status, and RefactorKit availability/version/path. The managed JDT LS path now includes provider-neutral lifecycle, document-sync, completion, hover, signature-help, and cancellation contracts; typed Tauri adapters; fixed no-shell Rust transport with isolated per-workspace data; and guarded Monaco providers. Fixed native RefactorKit scan/query/navigation handlers remain unexposed globally pending evidence-based Java module activation. The browser reports native Java providers unavailable, shows no Java tab, and starts no hidden Java polling.

The completed interactive Phase 2 slice synchronizes versioned Java models and provides diagnostics, completion, hover, signature help, and cancellation only for the exact synchronized Monaco model. Workspace/session/path/URI/version/request/cancel guards, optimistic versions, serialized full-text `didChange` flushes before semantic requests, and stale/late-result suppression prevent cross-model or outdated rendering. Current diagnostics feed Monaco and a conditional project-scoped Problems tab; this visibility guard is not Java module activation. Completion applies only its primary edit; additional/workspace edits and commands are suppressed. Documentation is untrusted Markdown with HTML disabled. Managed configuration sets `java.signatureHelp.enabled=true`. Java module activation, the full activated-module Problems/Build/Tests/Logs lifecycle, definition/references with Monaco gestures, code actions, formatting, rename, and hierarchy remain future slices; see the [Java IntelliSense roadmap](docs/JAVA_INTELLISENSE_PLAN.md). This direction does not claim IntelliJ Ultimate parity.

### Paste Java Class from Clipboard

The desktop IDE has an **operational, capability-gated** directory-tree workflow for importing an external Java class. Select a directory, then use its **Paste Java Class from Clipboard** context action or press `Ctrl+V`/`Cmd+V` while the file tree owns focus. Normal editor paste is never intercepted, and there is no global paste listener.

The workflow validates the selected directory and probes RefactorKit capability **before** one explicit clipboard read. A supported provider must advertise `java.importExternalClass` with `targetDirectory`, preview, and apply; operational promotion also requires rollback. The preview dialog shows backend-produced placement, affected files, package changes, rendered and structured diffs, evidence, risk, warnings, diagnostics, provenance/license information, unresolved dependencies, conflicts, staleness, and apply blockers. Apply is enabled only for the exact ready, eligible, non-stale plan the user reviewed, with additional acknowledgement for unknown/high-risk provenance. The IDE sends only its approved plan ID, displays the returned opaque transaction, and refreshes the tree/opens the primary file only from backend-authoritative results. Cancel, workspace changes, and directory-selection invalidation discard the pending provider plan before local state is cleared. RefactorKit remains the sole writer and rollback authority: the IDE performs no package inference or fallback/direct writes and sends no clipboard source, plan, or transaction to Pi.

The workflow is operational only when `bin/refactorkit-daemon` advertises the required API, method capabilities, normalized language-kernel metadata, and exact safety contract. Provider version is diagnostic metadata, not an authorization gate. Rust owns one NDJSON daemon for the current workspace generation, opens the canonical workspace, normalizes the rich `targetDirectory` preview, applies only the exact `planId`, discards pending plans, and rolls back by transaction ID. Malformed output, timeout, workspace switch, and application exit terminate the process; source text is never logged. Missing, failed, or incomplete capability remains unavailable before clipboard access, with no force flag or compatibility fallback. Real temporary-workspace smoke runs passed against both RefactorKit 0.5 and 0.6 providers, proving preview/no-write, discard invalidation, exact apply, and byte-for-byte rollback under the same capability/API/safety policy. See [ADR 0005](ADR.md#adr-0005--hybrid-java-intelligence-with-jdt-ls-and-refactorkit) and the [current/target C4 view](docs/c4/target-java-intelligence.md).

The desktop also includes an **AS-BUILT XCOM 2 machine setup/download monitor and concrete repeatable SDK transaction** in **Settings** as the built-in, experimental first-party feature `ide.xcom2-wotc`. Its plugin-shaped descriptor and ports do not constitute a generic plugin runtime. Native monitoring remains bounded and read-only for Steam AppIDs `268500`, `602410`, and optional `299990`, with conservative state and redacted provenance. The pure dry-run planner remains separate and non-executable.

The native transaction engine now provides the concrete, repeatable **Make SDK Operational** transaction. Prepare audits the vanilla WOTC SDK (Steam AppID `602410`) and, for the validated baseline, produces exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack source quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game. Machine-level journals and content-addressed backups capture the Steam build/manifest/root fingerprint plus exact original bytes, hashes, modes, inventory, and symlink absence. Apply requires approval of the exact complete digest for this one external-SDK transaction. **Restore Vanilla SDK** restores the captured baseline exactly, never overwrites conflicts, and enables rollback followed by **Prepare Again** for repeat setup tests.

A live Prepare audit produced 15 operations, `executable=true`, and no blockers; **no live Apply has been performed**. Protontricks, Steam shortcut creation, Proton-prefix work, package-manager operations, and all interactive setup remain **FUTURE/TARGET**, explicitly excluded and non-executable. Generic workspaces still show no XCOM activity entry or bottom tab. The browser setup adapter reports unavailable without simulation and starts no hidden XCOM work. See the [XCOM 2 requirements](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md), [ADR 0009](ADR.md#adr-0009--durable-digest-approved-xcom-setup-transactions), and [current/target C4 views](docs/c4/target-xcom2-setup.md).

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

`apps/desktop/src/App.tsx` is now a 672-line composition-only root: it creates stores, view models, and adapters; wires controllers; derives presentation props; and renders the shell. Six extracted controllers own the remaining shell/document/editor coordination: **Settings**, **Terminal**, **File Explorer**, **Document Navigation**, **Editor Command**, and **Desktop Shell**.

The root also composes seven previously extracted application controllers. This is an implementation-informed current boundary, not a claim that the DDD roadmap is complete.

| Controller             | Current responsibility                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Editor**             | Guarded file open/create, tab lifecycle, deferred restore, workspace reset, and presentation-safe editor state                                               |
| **Java Language**      | Workspace-scoped language lifecycle, versioned document sync, diagnostics, guarded completion/hover/signature help, cancellation, and stale-result rejection |
| **RefactorKit Import** | Separate capability-gated clipboard import preview/apply flow with selection and workspace freshness checks                                                  |
| **Workspace**          | Authorized active-root transition, registry state, switching, and the shared workspace-generation boundary                                                   |
| **AI Agent**           | Configuration/status and workspace-isolated commands, messages, activities, prompts, and stale-request suppression                                           |
| **XCOM Setup**         | Read-only monitoring, pure planning, transaction orchestration, event re-reads, and workspace-transition settlement                                          |
| **RefactorKit Status** | Provider-neutral, diagnostic-only status and capability discovery; it has no mutation authority                                                              |

On cold start, the Workspace controller first completes `ensureCurrentWorkspace`, then lists/promotes registry metadata, and only then restores or loads workspace-scoped Editor, file-tree, Java, AI Agent, RefactorKit Status, and XCOM state. `WorkspaceGeneration` starts positive and increases monotonically for user-initiated workspace switches; dependent controllers use it to reject stale work. RefactorKit Import also starts with a positive generation when used independently and consumes the shared authority in desktop composition.

The native Java Language boundary is now a 123-line Tauri facade over application, contract, path-policy, protocol, semantic, toolchain, and support modules. The managed RefactorKit boundary is a 63-line Tauri facade over application, capability-policy, contract, path-policy, and transport modules. Public Tauri commands remain stable while process ownership, policy, protocol, and use-case orchestration stay behind the facades.

**Remaining planned roadmap work:** executable requirements/specifications and a real unlocked click-to-open smoke test. The GUI smoke is pending because the available graphical session locked; no click-to-open result is claimed. These outstanding items mean full DDD completion is not claimed. See [ARC42](ARC42.md#ddd-roadmap-status) for the central status narrative.

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

Synthetic transaction fixtures prove two complete apply→rollback cycles restore the exact original file states and SHA-256 hashes for atomic patch, quarantine, generated file, generated directory, and symlink operations. They also prove reverse rollback ordering, restart recovery, conflict refusal, and conflict-safe retry. The latest dated validation evidence is centralized in [ARC42 section 10](ARC42.md#section-10-quality-requirements): **719 frontend tests** passed across 60 files; the Rust run passed **158 unit tests** with 6 ignored plus integration results of 1 passed and 1 ignored; real JDT LS lifecycle and semantic smokes passed; and the real temporary RefactorKit preview/apply/rollback smoke passed against both 0.5 and 0.6 providers. The ignored live XCOM Prepare audit found exactly 15 executable operations with no blockers and performed no Apply. The real unlocked click-to-open GUI smoke remains pending because the graphical session locked; no GUI or browser visual/e2e result is claimed.

---

## Documentation

[ARC42.md](ARC42.md) is the central integrated architecture narrative and mutable implementation-status source. The specialist plans, requirements, and C4 pages below are bounded satellites: they retain their detailed domain narratives and are linked rather than copied into the central status summary. Current claims require source/test/config or dated validation evidence; planned work is labeled explicitly.

| Document                                                                               | Description                                                                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [PLAN.md](PLAN.md)                                                                     | Full architecture plan                                                                                                                     |
| [ADR.md](ADR.md)                                                                       | Architecture Decision Records                                                                                                              |
| [ARC42.md](ARC42.md)                                                                   | ARC42 architecture documentation                                                                                                           |
| [SKELETON.md](SKELETON.md)                                                             | Package layout skeleton guide                                                                                                              |
| [docs/IDE_EXTENSION_PLAN.md](docs/IDE_EXTENSION_PLAN.md)                               | Bounded IDE extension planning satellite                                                                                                   |
| [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md)                       | Bounded Java IntelliSense roadmap and implementation-boundary satellite                                                                    |
| [docs/INTELLIJ_ULTIMATE_ROADMAP.md](docs/INTELLIJ_ULTIMATE_ROADMAP.md)                 | Bounded IntelliJ capability-analysis satellite; a direction, not a parity claim                                                            |
| [docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md) | Requirements and traceability for the AS-BUILT concrete SDK transaction and FUTURE/TARGET external interactive setup and modding workflows |
| [docs/c4/system-context.md](docs/c4/system-context.md)                                 | CURRENT/AS-BUILT global Settings, core BottomPanel, and external-system boundary                                                           |
| [docs/c4/target-java-intelligence.md](docs/c4/target-java-intelligence.md)             | Mixed current/target Java view: delivered sync/semantics and remaining activation/navigation/action slices                                 |
| [docs/c4/target-xcom2-setup.md](docs/c4/target-xcom2-setup.md)                         | XCOM 2 AS-BUILT concrete SDK transaction versus FUTURE/TARGET external interactive setup, activation, language, and build architecture     |

---

## License

MIT
