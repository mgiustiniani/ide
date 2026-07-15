# ARC42 — IDE Architecture Documentation

## Section 1: Introduction & Goals

### 1.1 Requirements Overview

The IDE is a three-panel Integrated Development Environment:

1. **Left sidebar** — accordion navigation with File Explorer above Workspace Explorer; both sections expand and collapse independently.
2. **Right/center area** — Monaco-only editor for opening and editing files.
3. **Bottom panel** — a dynamic accessible tool-window host. Desktop contributes core Terminal and AI Agent tools plus a conditional project-scoped Problems tab for the current Java context/diagnostics; web contributes core Terminal only.

**CURRENT/AS-BUILT — 2026-07-15:** within application content, the activity rail and left sidebar span the full available height; the bottom shell/tool-window host belongs only to the narrower editor-side column and does not extend beneath navigation. Top-level chrome/status remains separate and stable through panel changes. The optional right sidebar remains inside the editor row and is responsively bounded. Keyboard resizing and accessible separator semantics remain available for the left and bottom panel boundaries. The web declaration is `@implemented-and-validated`; the desktop declaration is `@implemented-not-e2e-validated` because its deterministic harness is not native GUI/E2E or packaged-app evidence.

It runs as a **Tauri 2.x desktop application** and is reusable as a **standalone webapp** with no Tauri dependency.

Workspace Explorer lists every registered workspace and owns workspace switching, refresh, loading, and error feedback. The former duplicate workspace selector in the header has been removed. File Explorer compacts package-only namespace chains only beneath recognized Java source roots. It preserves the deepest real node/path, distinguishes production `src` and test folders, gives `pom.xml` a dedicated Maven icon, and leaves unrecognized directory hierarchies unchanged.

Monaco Editor 0.52.2 is the only file editor. It is bundled locally with same-origin workers, one model per file, and a Java Monarch/basic language contribution. Lazy activation waits for a visible, renderable, positive-area active-file host before mount and timeout; layout reruns after visibility returns. No-file state is a Kate-style create flow. Loading uses an inert source-free placeholder, and import/runtime failure offers Retry Monaco with no native fallback. No CDN or CSP expansion is required.

The implemented Java baseline has two desktop foundations. **Settings > Java** exposes only global full-JDK/JDT LS lifecycle/status and RefactorKit availability/version/path/capability discovery. Managed JDT LS now provides provider-neutral lifecycle, versioned document-sync, diagnostics, completion, hover, signature-help, and cancellation contracts; typed Tauri adapters; fixed no-shell Rust/LSP transport with isolated per-workspace data; and guarded Monaco providers. Fixed native RefactorKit Java scan/query/navigation handlers exist, but their project actions remain unexposed globally. Browser mode has no Java technology tab or hidden Java polling.

Interactive diagnostics, completion, hover, signature help, and cancellation operate only for the exact synchronized Java model. Workspace/session/path/URI/version/request/cancel guards, optimistic versions, serialized full-text `didChange` flush-before-request, and stale/late suppression protect the flow. Current diagnostics feed Monaco and a conditional project-scoped Problems tab; that visibility guard is not Java module activation. Completion maps only its primary edit; additional/workspace edits and commands are suppressed. Documentation is untrusted Markdown with HTML disabled, and managed configuration sets `java.signatureHelp.enabled=true`.

**2026-07-14 roadmap policy:** preserve and maintain this as-built lifecycle, synchronized-document flow, diagnostics/Problems projection, completion, hover, signature help, cancellation, and stale guards. Further IntelliSense or JDT LS expansion is removed from the active roadmap until a relevant released RefactorKit capability passes immutable real acceptance validation. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, the full contextual Problems/Build/Tests/Logs lifecycle, general Java refactoring, and other contextual Java tooling are **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY**, not milestones or target architecture. Unsupported or unintegrated capabilities are never simulated.

One bounded IDE workflow is implemented separately: **Paste Java Class from Clipboard** is available from a selected directory's context menu or `Ctrl/Cmd+V` while the directory tree owns focus; editor paste is not intercepted. Its coordinator capability-probes before an explicit clipboard read, presents backend placement/diff/risk/diagnostic/provenance/conflict/staleness evidence, applies only the exact approved ready plan under workspace/selection generation guards, displays the backend transaction, and refreshes/opens backend-reported paths. Rust manages one canonical-workspace, generation-scoped `bin/refactorkit-daemon` NDJSON process and supports preview, exact-plan apply, discard, and transaction rollback. Compatibility is provider-version-neutral: API 0.2 plus the required import/apply/discard/rollback method features authorize the current Java-import boundary; provider version is diagnostic only. Language-kernel and top-level safety metadata are strictly normalized and retained when advertised, but the four safety booleans may be absent and do not all gate current Java-import authorization. The IDE never parses or copies raw Java in presentation code, infers a package, writes files directly, falls back to target-package, logs source, or sends source/plan/transaction data to Pi. Missing or incomplete required method capability remains unavailable before clipboard read. See the [current Java boundary and frozen inventory](docs/JAVA_INTELLISENSE_PLAN.md); the retained research does not claim IntelliJ IDEA Ultimate parity.

A separate **IMPLEMENTATION-INFORMED supporting sub-slice** now carries RefactorKit schema-v1 adapter and per-operation metadata through strict Rust and TypeScript normalization into contracts and the Language Lab. Rust canonicalizes adapters by language ID, operations by operation name, and extensions lexically; the UI therefore receives exact validated metadata in deterministic canonical order rather than provider-supplied order and renders each operation as operation, stability, evidence, mutation authority, backend, runtime, then extensions. A pure TypeScript diagnostics readiness policy validates exact workspace, generation, semantic session, snapshot hash, provider version, operation evidence, backend, runtime, and extensions and emits an immutable qualified request. This policy and its Spec are not a callable diagnostics integration.

[`REQ-REFACTORKIT-TS-001`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-TS-001) remains declared `@not-implemented`. Its desktop/Tauri fixture reaches a meaningful RED at the invocation boundary: after five passing steps, `run_refactorkit_diagnostics` receives no request fields and the remaining steps cannot establish structured diagnostics, authority correlation, current-snapshot identity, or existing-surface rendering. There is no native GUI or full Story GREEN. The immutable packaged `v0.6.2` daemon passed isolated packaging/import smoke evidence, while the global installed runtime and launcher checksum still report `0.5.0-SNAPSHOT`; these are distinct evidence sources. Option A is selected until further notice: the reversible temporary product status is `WAIT_FOR_UPSTREAM_PROTOCOL_FIX`, so the IDE will neither implement a Problems-only saved-disk fallback nor fabricate approximate Monaco line markers.

[`REQ-REFACTORKIT-TS-002`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-TS-002) is a separate saved-snapshot TypeScript/JavaScript symbol-navigation slice and also remains declared `@not-implemented`. Contracts, browser refusal, typed Tauri adapters, the Rust semantic-session backend, the desktop controller/composition, generic Search UI, exact provider-point reveal, dirty/never-saved guards, transient identity, stale-authority refusal, and cleanup are implementation-informed. Its deterministic desktop fixture passed 1 scenario and 18/18 steps. Independent immutable `v0.6.2` evidence nevertheless failed the scenario's no-workspace-write clause: `project.open` added `.refactorkit/workspace.lock` even though the provider advertises `writesWorkspace:false`. Current evidence therefore supports at most partial behavior. The user selected option A: wait for upstream and do not authorize this metadata write. Work may resume only when read-only `project.open` and semantic navigation do not write the workspace, or when the provider capability/contract is corrected and that changed contract is separately approved. The deterministic `desktop/tauri-harness` aggregate selects the separate layout scenario declared `@implemented-not-e2e-validated`; a separate Linux `desktop/tauri-webdriver` route selects the native file-open scenario declared `@implemented-and-validated`. Both routes still exclude the parked RefactorKit scenarios and provide no RefactorKit no-write evidence. The diagnostics option-A decision above is unchanged.

The desktop also contains the AS-BUILT built-in, experimental, plugin-shaped XCOM 2 WOTC feature `ide.xcom2-wotc`. Its **Settings contribution** presents the bounded read-only Steam monitor, a separate pure non-executable dry-run planner, and the concrete repeatable SDK setup transaction. Prepare audits vanilla SDK AppID `602410`; the validated baseline produces exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game. Machine-level journals and content-addressed backups preserve the Steam build/manifest/root fingerprint and exact original bytes, hashes, modes, inventory, and symlink absence.

Apply requires the complete digest approval for that single external-SDK transaction. Restore Vanilla SDK restores the captured baseline exactly, refuses conflicting overwrites, and permits rollback followed by Prepare Again. A live Prepare audit found exactly 15 executable operations and no blockers; no live Apply occurred. Protontricks, Steam shortcut, Proton-prefix, package-manager, and interactive setup remain FUTURE/TARGET, excluded and non-executable. The browser setup adapter reports unavailable without simulation, generic workspaces have no XCOM activity entry or bottom tab, and no generic plugin runtime exists. Evidence-activated XCOM project contributions remain target work; Java project contributions are separately frozen as unscheduled historical inventory. See [docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md).

#### Evidence and status rule

**IMPLEMENTATION-INFORMED migration status:** [`REQ-WEB-001`](docs/arc42/appendix-requirements.adoc#REQ-WEB-001) and [`REQ-LAYOUT-WEB-001`](docs/arc42/appendix-requirements.adoc#REQ-LAYOUT-WEB-001) exercise the standalone web application in real headless Chromium and are declared `@implemented-and-validated`. [`REQ-LAYOUT-DESKTOP-001`](docs/arc42/appendix-requirements.adoc#REQ-LAYOUT-DESKTOP-001) is declared `@implemented-not-e2e-validated` and passes through the deterministic non-GUI `desktop/tauri-harness`; no native GUI, E2E, or packaged-app result is claimed for layout. [`REQ-DESKTOP-FILE-OPEN-001`](docs/arc42/appendix-requirements.adoc#REQ-DESKTOP-FILE-OPEN-001) is declared `@implemented-and-validated` and passed its real Linux X11/Xvfb Tauri WebKitWebDriver release/no-bundle Story. [`REQ-REFACTORKIT-TS-001`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-TS-001) and [`REQ-REFACTORKIT-TS-002`](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-TS-002) remain declared `@not-implemented` under their frozen option-A policies. The canonical aggregate now routes two web scenarios, one desktop-harness scenario, and one native GUI scenario. Feature declarations, implementation evidence, deterministic Story evidence, real-provider evidence, aggregate support, release/no-bundle GUI evidence, and package evidence remain separate.

This ARC42 document is the **central integrated architecture narrative** and the mutable source for implementation status. A statement is **CURRENT/AS-BUILT** only when supported by the repository's source, tests, configuration, or dated validation evidence. Unimplemented work is labeled **UNSCHEDULED TODO**, **FROZEN HISTORICAL INVENTORY**, **FUTURE/TARGET**, or **PLANNED** according to its governing product policy; the frozen Java inventory has no active sequencing. Validation results are dated observations, not permanent capability guarantees.

Detailed specialist narratives remain bounded satellites and are linked rather than duplicated here:

- [IDE extension plan](docs/IDE_EXTENSION_PLAN.md);
- [IntelliJ Ultimate capability roadmap](docs/INTELLIJ_ULTIMATE_ROADMAP.md);
- [Java IntelliSense plan](docs/JAVA_INTELLISENSE_PLAN.md);
- [XCOM 2 requirements](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md);
- [executable requirements traceability](docs/arc42/appendix-requirements.adoc); and
- [C4 structural views](docs/c4/system-context.md), whose descriptions contain stable architecture facts rather than mutable test counts.

#### DDD roadmap status

**CURRENT/AS-BUILT:** `apps/desktop/src/App.tsx` remains a composition-only root. It wires the eight extracted Editor, Java Language, RefactorKit Import, RefactorKit Symbol Navigation, Workspace, AI Agent, XCOM Setup, and RefactorKit Status application controllers plus six extracted shell/document/editor controllers: Settings, Terminal, File Explorer, Document Navigation, Editor Command, and Desktop Shell. The RefactorKit Status controller is provider-neutral and diagnostic-only; it coordinates normalized status and capability discovery and grants no mutation authority. The separate RefactorKit Import controller may request preview/apply/discard only when the injected port advertises the required capability contract. RefactorKit Symbol Navigation support is implementation-informed and designed to bind read-only search/definition work to an authorized generation, semantic session, and saved snapshot, but the real provider violates the no-workspace-write requirement; the capability therefore remains parked.

The Rust Java Language and RefactorKit daemon boundaries remain inbound Tauri facades over application, contract, capability-policy, path-policy, protocol, semantic, toolchain, transport, and support modules. The saved-snapshot semantic module owns the bounded native navigation lifecycle. Process ownership, orchestration, normalization, authorization policy, and transport remain behind the facades.

**CURRENT/AS-BUILT layout:** shared PanelLayout composition keeps navigation full-height beside an editor-side content column whose editor row contains the main editor and optional right sidebar and whose lower region contains the resize boundary and bottom tool host. Status and desktop top-level chrome remain outside application content. Shared behavior preserves collapse/resize topology, keyboard resize, separator accessibility, and responsive right-sidebar bounds.

**IMPLEMENTATION-INFORMED migration status:** the canonical aggregate passes two web scenarios in real Playwright Chromium, one `@implemented-not-e2e-validated` desktop layout scenario through the deterministic `desktop/tauri-harness`, and one `@implemented-and-validated` native file-open scenario through Linux X11/Xvfb Tauri WebKitWebDriver. The latter freshly builds and directly launches a release/no-bundle executable; it does not upgrade the layout harness or establish package evidence. RefactorKit diagnostics support remains independently green below its expected qualified-request Story RED. RefactorKit symbol-navigation implementation and deterministic 18/18 Story remain GREEN while immutable `v0.6.2` fails the no-workspace-write clause. Both TypeScript/JavaScript RefactorKit requirements remain parked under frozen option-A policies. Canonical strict migration passed after this documentation reconciliation, but CachyOS/Synapse packaging and broader executable requirements remain release/maturity gaps. Full DDD completion is not claimed.

### 1.2 Quality Goals

| Quality Goal         | Description                                                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reusability**      | UI and core logic shared between desktop and web targets                                                                                                                                                                                                                   |
| **Portability**      | Future runtimes should remain isolated behind app shells and adapters                                                                                                                                                                                                      |
| **Testability**      | Ports enable mocking; adapters are isolated; UI is platform-agnostic                                                                                                                                                                                                       |
| **Performance**      | Monaco is lazy and model-per-file; xterm.js is virtualised; panel resizing remains smooth                                                                                                                                                                                  |
| **Resilience**       | Monaco retries fail visibly; source is not duplicated into a fallback editor or loading surface                                                                                                                                                                            |
| **Layout integrity** | CURRENT/AS-BUILT: activity rail and left sidebar span application-content height; bottom tools remain in the editor-side column; chrome/status remains separate; the optional right sidebar stays bounded; keyboard resizing and separator accessibility remain available. |

### 1.3 Stakeholders

- **End users** — developers using the IDE for coding, file browsing, and terminal access.
- **Developers** — team building and maintaining the codebase; benefit from clear package boundaries.
- **Platform maintainers** — those adding or updating desktop/web adapter implementations.

### 1.4 Confirmation Status

**CONFIRMED — 2026-07-14; implementation reconciled 2026-07-15:** the user-confirmed goals, quality goals, and stakeholder descriptions remain confirmed. The sole layout amendment remains CURRENT/AS-BUILT with separately declared and observed web/desktop evidence. Adding dated native file-open status does not materially change those confirmed goals. The release/no-bundle native result is not package evidence; CachyOS/Synapse packaging and broader executable requirements remain release/maturity gaps.

---

## Section 2: Constraints

### 2.1 Technical Constraints

- **pnpm workspace** — all packages live under a single monorepo.
- **Vite** — both `apps/web` and `apps/desktop` use Vite as the build tool.
- **Tauri 2.x** — desktop target requires Rust and Tauri CLI.
- **No Tauri imports in shared packages** — `packages/ui/`, `packages/web-core/`, `packages/contracts/` must not import `@tauri-apps/api`.
- **External Java import authority** — only a managed RefactorKit advertising API 0.2 and the required import/apply/discard/rollback method features may preview, apply, and roll back a `targetDirectory` import. The IDE must not infer support from version, top-level safety metadata, or language-kernel discovery; convert a directory to target-package; or write a fallback patch.
- **Clipboard privacy** — capability probing precedes clipboard access; the clipboard is read only for an explicit directory-tree action and is never routed to Pi. Normal editor paste remains independent.
- **Read-only semantic navigation** — saved-snapshot search/definition must execute no project script and produce no workspace change, including hidden provider metadata. Advertised `writesWorkspace:false` is evidence to verify, not permission to tolerate a contradictory lock write.

### 2.2 Business / Organizational Constraints

- The webapp must build and run independently for demos and automated validation.
- The desktop app must work offline with workspace-scoped file-system access.
- `synapse-ide-desktop` packaging is postponed until the full-build milestone. That package must use repository-only runtime dependencies; a direct Tauri release/no-bundle run is not CachyOS/Synapse package evidence.

---

## Section 3: System Context & External Actors

### 3.1 System Context Diagram

```
┌──────────────────────────────────────────────┐
│                   IDE System                  │
│                                              │
│  ┌─────────┐ ┌──────────────┐ ┌──────────┐  │
│  │ File    │ │ Code Editor   │ │ Terminal │  │
│  │ Tree    │ │ (Monaco)      │ │ (xterm)  │  │
│  └─────────┘ └──────────────┘ └──────────┘  │
│                                              │
└──────────┬────────────────────────┬──────────┘
           │                        │
           ▼                        ▼
     User (developer)         File System
```

### 3.2 External Actors

| Actor                                      | Description                                                                       | Interaction                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User (developer)**                       | Interacts with the IDE via keyboard and mouse                                     | Opens files, navigates tree, types commands                                                                                                                                                                             |
| **File System**                            | Workspace-scoped OS file system                                                   | Read/write files, list directories                                                                                                                                                                                      |
| **OS Programs** (desktop only)             | Non-interactive executables available from `PATH`                                 | Run bounded one-shot commands                                                                                                                                                                                           |
| **Full JDK** (desktop only)                | Externally installed, separately licensed Java runtime/toolchain                  | Launches the managed JDT LS process                                                                                                                                                                                     |
| **Eclipse JDT LS** (desktop only)          | Checksum-installed external EPL-2.0 language server; not bundled or redistributed | Current managed per-workspace lifecycle, document sync, diagnostics, completion, hover, signature help, and cancellation; no further active expansion roadmap                                                           |
| **RefactorKit** (desktop only)             | External capability source behind provider-neutral IDE ports                      | Diagnostic status/capability discovery, a separately gated import transaction, a blocked target diagnostics protocol, and saved-snapshot semantic navigation whose real `v0.6.2` no-write evidence is currently failing |
| **Steam manifest metadata** (desktop only) | Local bounded installation evidence, not an IDE-controlled transaction            | Read-only allowlisted evidence for AppIDs 268500, 602410, and optional 299990; provenance is redacted                                                                                                                   |
| **Web Browser** (webapp only)              | Runtime environment                                                               | Provides browser APIs and `localStorage`; reports local Java and XCOM native capabilities unavailable without simulation                                                                                                |

---

## Section 4: Building Block View — Level 1 (Package Overview)

### 4.1 Package Dependency Diagram

```
apps/web ───────────┐
apps/desktop ───────┤
                    │
packages/ui ────────┤──── packages/contracts
packages/web-core ──┤
                    │
packages/browser-adapters ──┐
packages/tauri-adapters ────┘    (implement ports from web-core)
```

### 4.2 Package Responsibilities

| Package                      | Responsibility                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/`                  | Standalone webapp entry point; composes browser adapters                                                                                                                   |
| `apps/desktop/`              | Tauri desktop app entry point; composes Tauri adapters and Rust backend                                                                                                    |
| `packages/contracts/`        | Shared TypeScript types, including provider-neutral language sessions, document sync, RefactorKit operation metadata, and the pure TypeScript diagnostics readiness policy |
| `packages/web-core/`         | Port interfaces, Zustand stores, view models — no UI                                                                                                                       |
| `packages/ui/`               | Reusable React UI components — no platform imports                                                                                                                         |
| `packages/browser-adapters/` | Browser implementations of ports                                                                                                                                           |
| `packages/tauri-adapters/`   | Tauri implementations of ports                                                                                                                                             |

---

## Section 5: Building Block View — Level 2 (Runtime View)

### 5.1 Component Diagram (Hexagonal Architecture)

```
┌────────────────────────────────────────────────────┐
│                    UI Layer                         │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐           │
│  │FileTree │  │ Editor   │  │Terminal │  (others)  │
│  │Component│  │Component │  │Component│           │
│  └────┬────┘  └────┬─────┘  └────┬────┘           │
│       │            │              │                 │
│       │ props      │ props       │ props            │
└───────┴────────────┴──────────────┴────────────────┘
        │            │              │
        ▼            ▼              ▼
┌────────────────────────────────────────────────────┐
│              View Model / State Layer              │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐           │
│  │ FileTree│  │ Editor   │  │Terminal │           │
│  │ ViewModel│ │ViewModel │  │ViewModel│           │
│  └─────────┘  └──────────┘  └─────────┘           │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │            Zustand Stores                    │  │
│  │  activeFile · panels · terminalSession      │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────┐
│                 Adapter Layer                      │
│  ┌──────────────────┐   ┌──────────────────┐       │
│  │ browser-adapters │   │ tauri-adapters   │       │
│  │ (web platform)   │   │ (desktop)        │       │
│  └──────────────────┘   └──────────────────┘       │
└────────────────────────────────────────────────────┘
```

### 5.2 Current Desktop Application Controllers

The eight extracted application controllers are C3 components composed by `apps/desktop/src/App.tsx`; they depend on injected ports and collaborators rather than importing native implementations.

| Controller                                 | Current responsibility and boundary                                                                                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor**                                 | Coordinates guarded file open/create, tab activation/close, deferred persisted-session restore, workspace reset, and presentation-safe diagnostics. A document is ready only when its tab and loaded buffer agree.                     |
| **Java Language**                          | Owns workspace language lifecycle, versioned Java document sync, diagnostic events and Problems projection, guarded completion/hover/signature help, cancellation, and stale identity checks.                                          |
| **RefactorKit Import**                     | Owns the separate capability-gated clipboard import flow, including selection/workspace freshness, preview, exact displayed-plan apply, invalidation/discard, result refresh, and backend-reported file opening.                       |
| **RefactorKit Symbol Navigation (parked)** | Implementation-informed controller/support boundary for saved-snapshot search and definition orchestration. The real provider violates the required no-workspace-write contract, so this is not a current IDE capability.              |
| **Workspace**                              | Owns registry metadata, the authorized active root, loading/switching state, and the shared `WorkspaceGeneration` authority. It coordinates collaborator invalidation, activation, loading, restoration, and stale-result suppression. |
| **AI Agent**                               | Owns configuration/status plus workspace-keyed commands, session messages, activities, prompt state, and stale-request suppression. Only the explicit trimmed panel prompt crosses its port.                                           |
| **XCOM Setup**                             | Owns workspace-scoped read-only monitoring, pure dry-run planning, native transaction/history actions, authoritative event re-reads, and failed-transition settlement/restoration.                                                     |
| **RefactorKit Status**                     | Owns provider-neutral, diagnostic-only daemon status and capability discovery. Status and capability outcomes settle independently; stale requests/generations are dropped. It has no preview/apply/rollback or mutation authority.    |

`WorkspaceGeneration` initializes at 1, remains positive, and advances monotonically for each user-initiated workspace-switch attempt; exhaustion fails closed. RefactorKit Import also initializes its local generation at 1 when no shared authority is supplied and consumes the Workspace controller's generation in desktop composition.

The Workspace controller coordinates lifecycle order but does not absorb feature behavior. RefactorKit Import, parked RefactorKit Symbol Navigation support, and diagnostic RefactorKit Status remain distinct controllers with separate authority; editor readiness is the input gate for Java document synchronization.

`App.tsx` retains composition only: singleton/store/view-model/adapter creation, controller wiring, collaborator assembly, presentation descriptors, and rendering. Six additional controllers own the extracted coordination:

| Controller              | Current responsibility                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| **Settings**            | Settings visibility and refresh coordination across independently owned feature controllers          |
| **Terminal**            | Session lifecycle, command/input handling, output clearing, and workspace-reset presentation cleanup |
| **File Explorer**       | Folder expansion and file creation through file-tree and guarded editor boundaries                   |
| **Document Navigation** | Preview visibility and diagnostic navigation through guarded file open followed by reveal            |
| **Editor Command**      | Buffer change/save and tab activation/close ordering with Java document synchronization              |
| **Desktop Shell**       | Panel commands, bottom-tab state, AI command loading on activation, and guarded Problems policy      |

The native boundaries follow the same facade discipline:

- `java_language.rs` is a Tauri facade. Application, contract, path-policy, protocol, semantic, toolchain, and support modules own the implementation behind it.
- `refactorkit_daemon.rs` is a Tauri facade. Application, capability-policy, contract, path-policy, transport, and saved-snapshot semantic modules own the implementation behind it.

### 5.3 Current Java Intelligence and Frozen Inventory Boundary

Java intelligence follows the existing hexagonal flow rather than bypassing it:

```text
CURRENT Settings > Java
  → LanguageSessionPort → Tauri adapter → Rust managed lifecycle → external JDT LS
  → RefactorKit availability/version/path/capability discovery
  → browser: no Java surface, hidden polling, or simulated native capability

CURRENT exact synchronized Java model
  → versioned document sync + diagnostics/Problems
  → completion + hover + signature help + cancellation
  → workspace/session/path/URI/version/request/cancel stale guards

CURRENT RefactorKit IDE capability
  → capability discovery
  → separately gated and validated Java external-class import

UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY
  → definition/references, symbols/hierarchy, actions, formatting, rename
  → Java module activation and contextual Problems/Build/Tests/Logs/Java tools
  → general Java refactoring and broader JDT LS expansion
```

The UI does not speak LSP or spawn tools. Provider-neutral lifecycle/document/diagnostic/semantic contracts, typed Tauri adapters, Rust managed JDT LS transport, and guarded Monaco providers implement initialization, versioned open/change/save/close, diagnostics, completion, hover, signature help, cancellation, and stale suppression. Diagnostics project into Monaco and the conditional Problems tab without claiming module activation. RefactorKit status/capability discovery and the validated clipboard import are the current RefactorKit IDE bucket. Fixed operations, provider foundations, support code, or advertised capabilities do not create a current IDE action. The remaining inventory is unscheduled and carries no target date, order, or commitment. The browser reports both local providers unavailable without simulation.

#### 5.3.1 RefactorKit v0.6.2 TypeScript/JavaScript evidence boundary

**Diagnostics supporting implementation only:** strict schema-v1 normalization retains all seven per-operation fields and canonicalizes adapter, operation, and extension order before presentation. The Language Lab displays the exact normalized order and explicitly distinguishes packaged/discovered metadata from current workspace/toolchain/session readiness. The diagnostics readiness policy is a pure fail-closed decision function; it creates no daemon session and invokes no tool. Option A remains `WAIT_FOR_UPSTREAM_PROTOCOL_FIX` for `REQ-REFACTORKIT-TS-001`.

**Symbol-navigation implementation-informed:** the generic Search surface, application controller, adapters, native saved-snapshot semantic lifecycle, and browser refusal are implemented for `REQ-REFACTORKIT-TS-002`. Deterministic desktop Story evidence is GREEN, but real immutable `v0.6.2` evidence is not: `project.open` creates `.refactorkit/workspace.lock` despite `writesWorkspace:false`. Option A parks this requirement pending upstream; the metadata write is not authorized. Resume only when read-only `project.open` and semantic navigation do not write the workspace, or when the provider capability/contract is corrected and separately approved. Thus the workflow is not documented as implemented or packaged-GUI/E2E validated.

RefactorKit TypeScript/JavaScript operations are not universally stable. In `v0.6.2`, structural outline and identifier search are working provider foundations; semantic definition, references, workspace symbols, and diagnostics are experimental provider foundations; semantic rename is experimental proposal-only. Format, move, organize imports, change signature, extract, and inline remain unsupported for TypeScript/JavaScript. None is thereby an IDE capability. Structural outline/identifier-search integration, TypeScript references/rename integration, and general Java refactoring beyond validated import remain unscheduled TODO.

The user has directed that RefactorKit will add multiple search operations with optional JSON output. Those operations remain TODO until a released capability exposes strict, typed, bounded, versioned machine-readable JSON or an equivalent daemon DTO with structured readiness/refusal/errors, explicit truncation and result bounds, authorized locations, workspace/generation/session/snapshot/operation request-result correlation, and immutable real acceptance evidence for the exact integrated operation. Human-oriented stdout must never be parsed as an IDE protocol.

### 5.4 Current and Target XCOM 2 Boundary

```text
CURRENT/AS-BUILT
  Desktop Settings → read-only monitor + separate non-executable dry-run planner
                   → concrete 15-operation Prepare review
                   → exact-digest one-transaction Apply approval
                   → Restore Vanilla SDK / Prepare Again
  Tauri adapter → durable native journal/backups + gated allowlisted SDK operations
  Generic workspace → no XCOM activity entry or bottom tab
  Web → setup unavailable without simulation; no hidden polling

FUTURE/TARGET
  Protontricks / Steam shortcut / prefix / package-manager / interactive setup
  general reusable external-root grant model
  explicit configuration or credible module evidence → activation decision with confidence/reasons
  activated module only → contextual project UI + XCOM Build/Problems/Logs/language adapters
```

Candidate activation evidence includes `*.x2proj`, `*.XComMod`, `.scripts/build.ps1` together with X2ModBuildCommon, `Config/XComEngine.ini`, and `Src/<package>/Classes/*.uc`. Evidence must be evaluated conservatively at module scope; directory/workspace name matching alone must never activate XCOM. The current fixed descriptor is a first-party composition mechanism, not a plugin loader or general permission grant. Exact-digest approval authorizes only the reviewed concrete SDK transaction. See [docs/c4/target-xcom2-setup.md](docs/c4/target-xcom2-setup.md).

### 5.5 Data Flow (Example)

```
User clicks file in FileTree
  → FileTree component calls an app-shell callback
  → Desktop Editor Controller publishes guarded opening state
  → FileTreeViewModel updates selected-file state in Zustand
  → EditorViewModel loads through EditorPort
  → Browser adapter reads localStorage; Tauri adapter invokes Rust file commands
  → Controller accepts only the current intent with a matching loaded tab/buffer
  → Editor displays content
```

---

## Section 6: Runtime Architecture

### 6.1 Startup Sequence

1. **Entry point** (`main.tsx`) mounts the React root and the app shell instantiates its runtime adapters.
2. **App component** (`App.tsx`) initializes stores and composes eight application controllers plus six extracted shell/document/editor controllers. Workspace-scoped controller auto-loads are deferred.
3. **Workspace authorization transition** starts at positive generation 1. The Workspace controller awaits `ensureCurrentWorkspace`; no registry read or dependent native workspace read may overtake it.
4. **Registry promotion** lists the registry after authorization and promotes the ensured workspace over a stale or empty snapshot.
5. **Dependent activation** begins only after the authorized root and promoted registry are current: editor restore, file-tree load, Java attach/status load, workspace-keyed AI activation/commands, RefactorKit status/capability discovery, and XCOM monitor/transaction loading run under the shared generation.
6. **Panel layout** renders full-height activity/sidebar navigation beside an editor-side flex column. The editor row owns the main editor and optional responsively bounded right sidebar; the lower column owns the bottom resize boundary and tool host. Status and desktop top-level chrome remain outside application content. BottomPanel descriptors retain icon/title/scope/badge/disabled/active metadata and accessible tab/tabpanel keyboard behavior.
7. **Sidebar navigation** renders independently collapsible File Explorer and Workspace Explorer sections; Workspace Explorer lists registered workspaces and handles switching/refresh/errors, while File Explorer derives Java-aware presentation only below recognized source roots.
8. **Editor** renders a no-file create state or source-free loading placeholder; only a visible, renderable positive-area active-file host may start Monaco import/mount and timeout, followed by layout when visibility returns. Failure offers Retry Monaco.
9. **Terminal** setup is workspace independent and may proceed during root authorization; web shows a simulated session and desktop executes submitted commands one at a time.

If initial authorization fails, dependent workspace activation does not run, loading settles, and presentation receives a sanitized error. A later user switch invalidates an older cold-start attempt and advances the generation before collaborator reset/detach.

### 6.2 Workspace Switch Flow

1. Advance `WorkspaceGeneration` before asynchronous detach or native switch work.
2. Reset Editor and RefactorKit Import state; stop/invalidate RefactorKit Symbol Navigation; invalidate Java, RefactorKit Status, AI Agent, and XCOM work through narrow collaborator interfaces.
3. Detach the old Java session, then invoke the serialized native workspace switch only if the generation is still current.
4. Attach/activate the returned authorized workspace, clear shell previews/terminal state, and reload registry, file tree, Java, AI Agent, RefactorKit status/capabilities, and XCOM state.
5. Suppress any completion whose generation/request/workspace identity is stale. On current failure, restore only the bounded collaborators that define restoration behavior.

### 6.3 Terminal Runtime Flow

```
User types command in Terminal component
  → TerminalPort.executeCommand(command)
  → TerminalAdapter executes for the active runtime
    → Desktop: Tauri invokes Rust `execute_command`, which parses argv and starts a program directly
    → Web: browser adapter emits simulated output
  → Output is emitted via TerminalPort.onOutput()
  → Terminal component renders output in xterm.js
```

### 6.3.1 Native Desktop File-Open Flow

1. The selected native profile first executes `pnpm --filter @ide/desktop tauri build --no-bundle --ci`, verifies the fixed release executable, and records its SHA-256; an environment override cannot substitute an older binary.
2. The runner creates one temporary sandbox and redirects `HOME`, all configured XDG state roots, `IDE_HOME`, the authorized workspace, and temporary roots beneath it. It removes inherited display/session variables, then starts an isolated D-Bus session and X11 Xvfb display.
3. `tauri-driver` starts `/usr/bin/WebKitWebDriver`, which launches the real Tauri WebView and freshly built release/no-bundle ELF. The accessible File Explorer exposes the deterministic root item.
4. After click, one shared 15-second deadline covers exact selected path, exact selected accessible tab, and exact Monaco logical content. Opening/failure placeholders and file-open alerts must be absent; a separate bounded browser probe establishes responsiveness.
5. Closing the native window must remove the observed executable process within five seconds. Cleanup deletes the WebDriver session, stops the owned driver/application processes, and the Story verifies expected workspace metadata/content plus canonical containment of redirected state roots.

The first real run exposed a production state-publication defect: `TauriEditorAdapter.getOpenFiles()` returned its mutable adapter-owned array by alias, so startup restore and consumer mutation prevented the first tab from being published. Commit `9b4af2a` returns defensive array/object snapshots from get/open/close and adds the native-like controller regression. The subsequent real native Story passed 16/16. This flow proves one Linux X11/Xvfb direct file open only; it does not prove package installation, Wayland/other-OS behavior, arbitrary host-filesystem non-mutation, or other editor workflows.

### 6.4 RefactorKit Native Foundation and Managed Daemon Flow

Fixed Rust handlers validate explicit Java selectors and authorized workspace-relative locations. The `refactorkit_daemon.rs` Tauri facade delegates transactional import to application, capability-policy, contract, path-policy, and transport modules. The transport launches `bin/refactorkit-daemon` directly without a shell and owns one NDJSON process per workspace generation. The application service validates API 0.2 and required import/apply/discard/rollback method features without authorizing from provider version, opens the canonical workspace, correlates requests, normalizes rich preview output, applies only the exact `planId`, invokes `refactor.discard` on cancellation/invalidation, and rolls back by transaction ID. It also normalizes and retains language-kernel and safety metadata when advertised; the top-level safety booleans are evidence, not a complete Java-import authorization gate. Malformed protocol output, timeout, workspace switch, and application exit kill the process; bounded logs exclude source text.

The separate saved-snapshot semantic module is implementation-informed support for a parked TypeScript/JavaScript requirement: it can start a capability-gated session with explicitly approved external tools, search workspace symbols, resolve a selected opaque identity to a provider point, and stop under exact workspace/generation/session/snapshot authority. Desktop composition contains a generic Search integration, but the immutable real provider contradicts the required no-write behavior during `project.open`; deterministic protocol success must not hide that defect or promote the workflow to a current IDE capability. Broader fixed RefactorKit project actions remain unintegrated. Any announced search stdout is non-contractual and must not be parsed.

### 6.5 Paste Java Class from Clipboard Flow

1. The developer selects a directory and invokes its context action or presses `Ctrl/Cmd+V` while the tree owns focus. Editor paste is not intercepted.
2. The coordinator validates workspace/directory selection and probes `java.importExternalClass`; failed, absent, target-package-only, or incomplete required method capability stops with no clipboard read or write.
3. Only a provider advertising API 0.2 plus `targetDirectory`, preview, apply, discard, and rollback method features triggers one explicit clipboard read. Top-level language-kernel and safety fields are retained when present but do not independently authorize this read. Empty/oversized text is refused; source remains transient and never reaches Pi or logs.
4. RefactorKit alone produces the complete correlated plan. Refused/error/stale plans retain backend evidence for review but cannot apply. Conflicts, blockers, ineligibility, changed workspace/selection, or required provenance acknowledgement disable apply; cancel/invalidation calls `refactor.discard`.
5. Approval binds the exact displayed `planId` and current generations. Apply sends that identity; the IDE neither infers a package, reconstructs edits, nor writes directly.
6. A successful backend result supplies the opaque transaction, changed files, and primary file used for display, tree refresh, and opening. Rollback is by transaction ID through RefactorKit.

Steps 3–6 are operational only for a provider satisfying API 0.2 and the required transaction method features. Real temporary fixtures passed against the global `0.5.0-SNAPSHOT` runtime and an isolated immutable packaged `v0.6.2` daemon, proving provider-version-neutral preview/no-write, discard invalidation, exact apply, and byte-for-byte rollback for those fixtures. The global runtime was not upgraded by the isolated run. Missing or incomplete required method capability remains refused without force or fallback.

### 6.6 Managed Java Session Flow

**Current/as-built:** the desktop starts an authorized workspace session through the Tauri adapter. The 123-line `java_language.rs` Tauri facade delegates to application, contract, path-policy, protocol, semantic, toolchain, and support modules. Behind that facade, Rust discovers a full JDK and valid external JDT LS, launches the fixed isolated process without a shell, initializes it, and transports versioned open/change/save/close plus completion/hover/signature/cancellation. The coordinator increments versions optimistically, serializes full-text changes, flushes them before requests, and suppresses stale/late results. Exact-model Monaco guards and safe presentation policies prevent cross-model rendering or implicit side effects. RefactorKit runs independently for its generation-scoped external-import transaction and fixed allowlisted operations.

**Unscheduled TODO / frozen historical inventory:** definition/references and Monaco gestures, symbols/hierarchy, code actions, formatting, rename, evidence-based Java project/module activation, the full contextual project-tool lifecycle, generalized structured multi-file preview/apply, and broader JDT LS expansion. This inventory has no order, milestone, target date, or implied commitment. Reconsideration requires a relevant released RefactorKit capability and immutable real acceptance evidence while preserving all current guards.

#### 6.6.1 Blocked RefactorKit TypeScript diagnostics flow

1. Capability discovery can expose validated canonical TypeScript/JavaScript operation metadata to RefactorKit Status and the Language Lab.
2. The pure readiness policy can decide whether exact fixture evidence would authorize an immutable request bound to language, workspace, generation, session, snapshot hash, provider version, and backend.
3. The current Tauri `diagnostics()` adapter still invokes `run_refactorkit_diagnostics` with no request. The desktop Story therefore stops at a meaningful RED before a qualified native call.
4. Even after request wiring, immutable upstream `v0.6.2` is not sufficient for the full Story: its diagnostics response loses start-character/end-range data; carries no request/result authority correlation or compiler attestation; does not define saved/unsaved snapshot semantics; can encode readiness or tool failure as ordinary diagnostics; and advertises backend/runtime and timeout/output bounds that conflict with the exact compiler bridge.
5. While `WAIT_FOR_UPSTREAM_PROTOCOL_FIX` remains active, the IDE will not implement a Problems-only saved-disk fallback and will not fabricate approximate Monaco line markers. Integration may resume only after upstream supplies exact bounded UTF-16 ranges or explicit enforceable precision, authority correlation, compiler attestation, saved/unsaved snapshot semantics, structured readiness/refusal/failure outcomes, and compatible runtime/response bounds, or after an explicit product revision. No TypeScript-specific panel may be introduced.

#### 6.6.2 Partially evidenced RefactorKit symbol-navigation flow

1. Generic Search may start only from an authorized desktop workspace whose participating TypeScript/JavaScript buffers match saved files and whose external Node, TypeScript language server, and TypeScript paths were explicitly approved.
2. The controller starts one saved-snapshot semantic session, searches under its workspace/generation/session/snapshot authority, and passes any selected opaque symbol identity transiently into definition resolution.
3. Document Navigation opens the provider-reported definition and reveals its exact point only while all authority and saved-buffer guards remain current; dirty/never-saved input, stale evidence, unavailable semantic evidence, and browser mode fail closed.
4. Cancellation, replacement, workspace transition, and settlement stop the semantic session. The IDE does not discover tools through `PATH` or workspace files, execute project scripts, persist opaque identities, or fall back to structural identifiers.
5. The deterministic desktop fixture proves this orchestration and passed 18/18 steps. It does not prove a packaged GUI or real-provider no-write behavior.
6. In the independent immutable `v0.6.2` run, start→search→definition→stop returned the expected semantic result, but `project.open` added `.refactorkit/workspace.lock`. Because `project.open` advertises `writesWorkspace:false` and the Story forbids workspace writes, the end-to-end behavior remains blocked. Under the selected option A, no metadata write is authorized. Resume only when read-only `project.open` and semantic navigation do not write the workspace, or when the provider capability/contract is corrected and separately approved.

### 6.7 Resize Flow

```
User drags a panel divider or focuses it and presses its supported arrow key
  → PanelLayout dispatches the bounded resize callback
  → Zustand panel store updates panel dimensions
  → PanelLayout re-renders the navigation/editor-column flex topology
  → separator ARIA values update; Monaco Editor and xterm.js resize via API calls
```

### 6.8 XCOM 2 Machine Monitor, Dry Run, and Transaction Runtime

```text
Desktop Settings → bounded read-only monitor → redacted generation-tagged snapshot
                 → separate pure dry run (always non-executable)
                 → transaction history/review/full digest/controls
                                      │
                                      ▼
Native engine: write intent → backup by content hash → atomic mutation → verify
                                      │
                           reverse rollback / recover
```

Approval binds the transaction, workspace, monitor generation, ordered operations, and preconditions. Before mutation, the engine rejects stale hashes/generations, path escapes, workspace mismatches, duplicate targets, and invalid journal digests. Every checkpoint is durable; rollback traverses applied steps in reverse and refuses to overwrite conflicting post-apply changes. Recovery can verify a journal, resume interrupted rollback, or retry conflict-safe rollback when observable state permits.

For the concrete SDK flow, Prepare fingerprints the stable Steam game/SDK roots, captures exact baseline evidence, and constructs the fixed 15-operation set. Apply revalidates that evidence and requires the exact complete digest for one transaction. Restore Vanilla SDK traverses applied steps in reverse, restores exact bytes/modes/inventory or original symlink absence, and refuses conflicting overwrites. A successful restore permits Prepare Again.

Synthetic fixtures prove repeat apply→rollback cycles, restart recovery, and conflict-safe retry. The live Prepare audit reported 15 operations, executable, and no blockers; no live Apply occurred. Protontricks, Steam shortcut, prefix, package-manager, and interactive setup remain FUTURE/TARGET and cannot enter this transaction.

---

## Section 7: Design Decisions

All design decisions are recorded in [ADR.md](ADR.md) as Architecture Decision Records.

| Decision                                                             | ADR      |
| -------------------------------------------------------------------- | -------- |
| Web-first reusable frontend                                          | ADR 0001 |
| Ports & adapters (hexagonal)                                         | ADR 0002 |
| Three-panel layout with dynamic accessible bottom tool-window host   | ADR 0003 |
| Package isolation boundaries                                         | ADR 0004 |
| Hybrid Java intelligence with JDT LS and RefactorKit                 | ADR 0005 |
| Lazy local Monaco-only editor                                        | ADR 0006 |
| Machine Settings and evidence-activated XCOM project contributions   | ADR 0007 |
| Global tooling Settings and evidence-activated project contributions | ADR 0008 |
| Durable digest-approved XCOM setup transactions                      | ADR 0009 |

---

## Section 8: Cross-Cutting Concepts

### 8.1 State Management

- **Zustand** stores in `packages/web-core/state/`.
- Each panel has its own store slice (file tree, editor, terminal, panel layout).
- Stores are platform-agnostic; adapters update store values asynchronously.

### 8.2 Styling

- **Tailwind CSS** utility classes for layout and theming.
- Shared Tailwind configuration lives in `packages/ui/tailwind.config.ts` and is consumed by app builds.
- Light/dark colors are defined with CSS variables; the app currently renders with the dark class.

### 8.3 Error Handling

- Adapters catch platform errors and map them to user-facing error messages or typed adapter errors.
- View models expose loading and error state for UI handling where implemented.

### 8.4 Security

- Desktop: Tauri uses the default capability and a Content Security Policy; Rust commands constrain file paths to the workspace and reject shell chaining, raw shells, executable paths, long-running commands, and oversized output.
- Monaco and all editor workers are local same-origin assets; the editor adds no CDN dependency and requires no CSP expansion.
- Webapp: runs in the browser sandbox and stores simulated workspace data in `localStorage`.
- Managed JDT LS: Rust authorizes workspace paths, discovers known external tools, starts JDT LS without a shell, isolates per-workspace state, and bounds messages/events/restarts/cleanup. Exact-model workspace/session/path/URI/version/request/cancel guards and flush-before-request ordering prevent stale or cross-model results. Completion suppresses additional/workspace edits and commands; Markdown is untrusted with HTML disabled. Browser adapters report Java providers unavailable rather than simulating results; a remote provider would require explicit opt-in and a separate ADR.
- External Java clipboard import: target validation and authoritative API/method-feature probing occur before clipboard access. Language-kernel and top-level safety metadata are validated and retained when advertised but are not all authorization gates. Unsupported, stale, refused, blocked, mismatched, or failed work stops without fallback. Clipboard source is transient, goes only to RefactorKit preview after support is proven, and never reaches Pi. Exact-plan approval, backend-owned mutation/rollback, and backend-authoritative refresh/open paths prevent the IDE from manufacturing writes.
- RefactorKit TypeScript diagnostics: discovery metadata and a pure readiness decision do not authorize native invocation or rendering. Until the protocol carries exact authority/correlation, compiler attestation, complete ranges, and current editor-snapshot identity, exact Monaco markers and full existing-surface projection fail closed.
- RefactorKit TypeScript/JavaScript symbol navigation: capability evidence, explicit external-tool paths, saved-buffer checks, authority correlation, transient opaque identity, and exact point validation fail closed. A full hidden-file byte-tree audit is required because immutable `v0.6.2` writes `.refactorkit/workspace.lock` during nominally read-only `project.open`; advertised `writesWorkspace:false` does not override observed mutation or authorize it. Option A parks the slice until read-only `project.open` and semantic navigation do not write the workspace, or until the provider capability/contract is corrected and separately approved.
- JDT LS and the full JDK are external, non-bundled tools under separate licenses. The pinned JDT LS release is installed/verified with `pnpm tools:install-jdtls` and `pnpm tools:verify-jdtls`.
- Native file-open Story: the runner forces a fresh release/no-bundle build; isolates D-Bus/X11 and all declared HOME/XDG/IDE/temp roots beneath a run sandbox; validates canonical containment; uses an authorized root file; and owns WebDriver/application cleanup. This is bounded test isolation, not a claim that every host filesystem location was audited.
- XCOM 2 Settings: native monitor reads are bounded to fixed Steam AppIDs. The concrete SDK transaction is constrained by the captured Steam/root fingerprint, exact-digest one-transaction approval, local machine journals/backups, path/hash/workspace/generation gates, and atomic allowlisted primitives. Export payloads omit paths/content. Browser setup is unavailable without simulation. General external-root grants and external interactive setup remain deferred.

---

## Section 9: Architectural Decisions

See [ADR.md](ADR.md) for the full list of Architecture Decision Records.

- **ADR 0001** — Web-First Reusable Frontend Architecture
- **ADR 0002** — Ports & Adapters Pattern (Hexagonal Architecture)
- **ADR 0003** — Three-Panel Layout with Extensible Bottom Panel
- **ADR 0004** — Package Isolation Boundaries (pnpm Workspace)
- **ADR 0005** — Hybrid Java Intelligence with JDT LS and RefactorKit
- **ADR 0006** — Lazy Local Monaco-Only Editor
- **ADR 0007** — Machine Settings and Evidence-Activated XCOM Project Contributions
- **ADR 0008** — Global Tooling Settings and Evidence-Activated Project Contributions
- **ADR 0009** — Durable Digest-Approved XCOM Setup Transactions

---

## Section 10: Quality Requirements

| Requirement                             | Scenario                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reusability**                         | Webapp builds with `pnpm build` from `apps/web/` without any Tauri dependency                                                                                                                                                                                                                                                           |
| **Portability**                         | A future runtime should be isolated behind a new app shell and adapter package                                                                                                                                                                                                                                                          |
| **Testability**                         | Ports can be mocked in unit tests; adapters tested in isolation per platform                                                                                                                                                                                                                                                            |
| **Performance**                         | Monaco loads only for a visible, renderable positive-area active-file host, keeps one model per file, and xterm.js uses virtual rendering                                                                                                                                                                                               |
| **Resilience**                          | Hidden/zero-area layout defers Monaco; loading is source-free; import/runtime failure offers explicit retry; visibility restoration triggers layout                                                                                                                                                                                     |
| **Layout integrity (CURRENT/AS-BUILT)** | After sidebar/bottom expansion, collapse, and resizing, activity rail and visible sidebar match application-content height; bottom tools begin after navigation and occupy only editor-side width; chrome/status geometry stays separate and stable; both resize separators remain keyboard operable with current accessible semantics. |
| **Native file-open resilience**         | From one accessible root-file click, selected path, selected tab, and exact Monaco content must become observable within one shared 15-second deadline; close must terminate the release executable and leave declared user-state roots sandbox-confined.                                                                               |

### 10.1 Dated Validation Evidence

| Evidence (latest reconciliation dated 2026-07-15)        | Result                                                         | Scope and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current frontend suite**                               | 857/857 tests passed across 66 files                           | Covers existing frontend behavior plus current PanelLayout topology and responsive real-Chromium checks. The canonical migration gate also passed its 120/120 Spec tests, TypeScript Story checks, strict documentation check, legacy baseline, scaffolding/profile checks, and declared Story aggregate. This evidence is not packaged desktop GUI/E2E or real-provider no-write evidence.                                                                                                                                                                             |
| **RefactorKit metadata slice**                           | 113/113 focused tests passed                                   | Contract, UI, and Tauri-adapter tests prove strict seven-field operation metadata preservation/rejection, canonical runtime-before-extensions presentation, nested immutability, and honest unknown readiness. This is metadata/support evidence, not diagnostics execution.                                                                                                                                                                                                                                                                                            |
| **TypeScript diagnostics readiness Spec**                | 27/27 cases passed                                             | The pure policy authorizes one immutable exact fixture request and refuses stale, ambiguous, incomplete, mismatched, or unqualified evidence before invocation. No tool is called and no UI result is rendered by this Spec.                                                                                                                                                                                                                                                                                                                                            |
| **REQ-REFACTORKIT-TS-001 desktop Story**                 | **EXPECTED RED**: 1 failed scenario; 5 steps passed; 6 skipped | The scenario reaches `run_refactorkit_diagnostics`, but the current adapter sends no qualified request (`{}`). The result is meaningful RED evidence for the missing integration boundary, not a partial GREEN, native GUI result, or authorization to render Problems/Monaco diagnostics. Option A remains unchanged. See the [requirements appendix](docs/arc42/appendix-requirements.adoc#REQ-REFACTORKIT-TS-001).                                                                                                                                                   |
| **REQ-REFACTORKIT-TS-002 implementation evidence**       | Passed                                                         | Contracts, browser/Tauri adapters, Rust backend, generic Search UI, application controller/composition, exact point navigation, dirty/never-saved and stale refusal, transient identity, compatibility disclosure, and lifecycle cleanup are implemented and covered by focused and full suites. This does not override the declared status or real-provider failure.                                                                                                                                                                                                   |
| **REQ-REFACTORKIT-TS-002 deterministic desktop Story**   | 1 scenario and 18/18 steps passed                              | The focused Tauri-invoke fixture composes the real desktop controller and Search surface over deterministic exact `v0.6.2` DTOs. It proves bounded orchestration, not a packaged Tauri WebView or actual daemon filesystem behavior. The aggregate harness does not currently select it because its declared status remains `@not-implemented`.                                                                                                                                                                                                                         |
| **Rust default suites**                                  | 171 tests passed; 8 ignored                                    | Locked tests, formatting, strict Clippy, and the Tauri no-bundle build passed. Ignored external/live tests are not implied by the default count.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Real JDT LS lifecycle and semantic smokes**            | Passed                                                         | Covered discovery, initialization, capability normalization, event polling, workspace-data isolation, repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop.                                                                                                                                                                                                                                                                                                         |
| **Global RefactorKit runtime**                           | `0.5.0-SNAPSHOT`                                               | The installed launcher and packaged-library checksum remain on the global 0.5 development runtime; no global `v0.6.2` promotion is claimed.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Isolated immutable RefactorKit `v0.6.2` import smoke** | Passed                                                         | All 424 source blobs matched immutable tag commit `110b605` with zero mismatches. The isolated packaged daemon passed Java preview/no-write, discard, exact apply, and byte-for-byte rollback under OpenJDK 21. This does not close either TypeScript requirement or upgrade the global runtime.                                                                                                                                                                                                                                                                        |
| **Immutable `v0.6.2` symbol-navigation audit**           | **FAILED; option A waits for upstream**                        | With JDK 21.0.11, Node 22.23.0, TypeScript language server 5.1.3, and TypeScript 5.9.3, start→search→definition→stop returned the expected semantic result and executed no detected project/PATH/workspace tool marker. A before/after hidden-file byte-tree audit nevertheless found added `.refactorkit/workspace.lock`; `DaemonSession.projectOpen` invokes recovery despite advertised `writesWorkspace:false`. No metadata write is authorized.                                                                                                                    |
| **REQ-WEB-001 web Story**                                | 1 scenario and 7/7 steps passed in headless Chromium           | The explicit web/Playwright profile drove the standalone app and observed Terminal-only core tooling with no Java- or XCOM-named tool tabs. Declared status remains separate from this target-specific result.                                                                                                                                                                                                                                                                                                                                                          |
| **REQ-LAYOUT-WEB-001 web Story**                         | 1 scenario and 9/9 steps passed in real Playwright Chromium    | At 1280 x 720, the standalone app retained full-height navigation, editor-column-only bottom tools, stable separate chrome/status geometry, and keyboard resize/accessibility semantics through expanded, resized, and collapsed states. Its declaration is `@implemented-and-validated`; this result is web-only.                                                                                                                                                                                                                                                      |
| **REQ-LAYOUT-DESKTOP-001 desktop harness Story**         | 1 scenario and 9/9 steps passed                                | The deterministic `desktop/tauri-harness` exercised the real shared PanelLayout contract at 1280 x 720, including separate desktop top-level chrome. Evidence metadata is `nativeGui: false`, `e2e: false`, and `packagedApplication: false`; no native GUI/E2E/packaged-app result is claimed. The declaration is `@implemented-not-e2e-validated`.                                                                                                                                                                                                                    |
| **REQ-DESKTOP-FILE-OPEN-001 native GUI Story**           | 1 scenario and 16/16 steps passed in 4.220 seconds             | On 2026-07-15 at HEAD `48dab05`, the canonical migration run used isolated D-Bus plus Linux X11 Xvfb (1440 x 900 x 24), `tauri-driver` 2.0.6, `/usr/bin/WebKitWebDriver`, and the real Tauri WebView. Before launch the runner freshly built a 15,113,992-byte release/no-bundle ELF and recorded SHA-256 `e19af16c60712631caab7c934d88f8750c54e46f5a1456fcad9d08d68119a8a6`. This is native GUI/E2E but explicitly `packagedApplication: false`.                                                                                                                       |
| **Native exactness, confinement, and cleanup**           | Passed                                                         | Sandbox `/home/paperboy/workspace/ide/test-results/native-desktop-story/run-xr6Amo` redirected and canonically contained declared HOME/XDG/IDE/workspace/temp roots. The selected path was exactly its `workspace/native-open-proof.ts`, the selected accessible tab was `native-open-proof.ts`, and Monaco exactly matched `export const nativeOpenProof = "REQ-DESKTOP-FILE-OPEN-001";` under one shared 15-second post-click bound. Close, executable disappearance within five seconds, zero runner exit, and no residual driver/WebDriver/app/Xvfb process passed. |
| **Native first-tab production regression**               | Found by real Story; fixed in `9b4af2a`                        | `TauriEditorAdapter.getOpenFiles()` exposed a mutable adapter-owned alias, so first-file publication after empty startup restore was lost. Defensive array/object snapshots on get/open/close plus a native-like controller regression restored first-tab publication; the real Story then passed.                                                                                                                                                                                                                                                                      |
| **Responsive right-sidebar browser evidence**            | 4/4 real Chromium checks passed at 1280, 700, and 480 widths   | At 1280, requested 420- and 320-pixel right-sidebar widths were retained when room existed. At 700 and 480, editor and right sidebar stayed positive, the sidebar right edge stayed within the editor row, and editor-row/workspace/document horizontal overflow remained bounded. This is shared UI implementation evidence, not packaged desktop GUI/E2E.                                                                                                                                                                                                             |
| **Declared implemented Story aggregate**                 | **PASS: 2 web; 1 desktop harness; 1 native GUI scenario**      | The canonical migration gate validates declared routing, runs two `@implemented-and-validated @web` scenarios through Playwright Chromium, one `@implemented-not-e2e-validated @desktop` scenario through the deterministic harness, and one `@implemented-and-validated @desktop @native-gui` scenario through the fresh-build release/no-bundle WebDriver route. The two parked RefactorKit scenarios remain excluded.                                                                                                                                                |
| **CachyOS/Synapse package evidence**                     | **ABSENT / POSTPONED**                                         | The native result launches an unbundled release ELF directly; it is not `synapse-ide-desktop`, installer, upgrade, CachyOS, or other package evidence. Packaging is postponed until the full-build milestone and must use repository-only runtime dependencies. Layout and RefactorKit also retain their stated non-package evidence limits.                                                                                                                                                                                                                            |

The 2026-07-15 late reconciliation rechecked all five configured feature paths and six scenarios, stable IDs, classifications, declared status versus observed target evidence, Markdown/AsciiDoc formatting, relative link targets, strict documentation validation, canonical migration (including its fresh native build/run), and the final owned-doc diff. Native aggregate status is 2 web, 1 harness, and 1 native validated. The exact native evidence is bounded to the observed Linux X11/Xvfb release/no-bundle run: sandbox checks cover declared state roots and expected workspace contents, not an arbitrary host-filesystem audit; no CachyOS/Synapse package was built or exercised. The confirmed layout evidence and frozen Java/IntelliSense and RefactorKit policies remain unchanged; no ADR or C4 amendment was needed for this implementation-status reconciliation.

---

## Section 11: Risks and Technical Debt

| ID                   | Status                                | Risk / debt                                                                                                                                                                                                                                                                                                                                                               | Mitigation, owner, and review point                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-BDD-02**         | open                                  | Target-specific evidence can be conflated: both web Stories are real-browser GREEN; desktop layout is deterministic-harness GREEN only; native file opening is release/no-bundle Linux GUI GREEN; diagnostics is meaningfully RED; symbol navigation is deterministic-fixture GREEN but real-provider no-write RED; and no scenario has CachyOS/Synapse package evidence. | Architecture and quality owners keep declared status, implementation tests, focused Story results, real-provider audits, aggregate profiles, native GUI evidence, and package evidence separate. Review before any further desktop validation or package claim.                          |
| **R-BDD-03**         | controlled                            | A Gherkin status tag could be mistaken for independently observed evidence.                                                                                                                                                                                                                                                                                               | Architecture owner maintains separate declared-status and observed-validation fields in the [requirements appendix](docs/arc42/appendix-requirements.adoc); reconcile after every slice.                                                                                                 |
| **R-BDD-04**         | controlled target boundaries          | Deterministic `desktop/tauri-harness` routing covers layout only and remains non-native/non-E2E. Linux `desktop/tauri-webdriver` covers one validated file-open scenario against a fresh release/no-bundle ELF but is not packaged-app evidence and cannot validate layout or RefactorKit behavior.                                                                       | The canonical migration gate routes 2 web, 1 harness, and 1 native GUI scenario separately. Architecture and quality owners preserve target metadata and prohibit transfer of native file-open evidence to layout, provider, Wayland/other-OS, or package claims.                        |
| **R-DESKTOP-PKG-01** | postponed to full-build milestone     | A direct release/no-bundle GUI GREEN could be mistaken for CachyOS/Synapse installation, dependency, or upgrade evidence.                                                                                                                                                                                                                                                 | Release owner postpones `synapse-ide-desktop` packaging until the full-build milestone and permits repository-only runtime dependencies. Architecture owner keeps `packagedApplication: false` visible until a real package gate exists.                                                 |
| **R-RK-COMP-01**     | open upstream bug                     | Immutable RefactorKit `v0.6.2` daemon diagnostics serialize file and line but drop start character and end range, so exact source spans cannot cross the protocol.                                                                                                                                                                                                        | Upstream RefactorKit owner must add exact bounded UTF-16 ranges or explicit enforceable precision. IDE owner must not derive approximate ranges and revalidates malformed/range cases before marker use.                                                                                 |
| **R-RK-COMP-02**     | open upstream bug                     | Diagnostics responses lack request/result workspace, generation, session, and snapshot authority correlation plus explicit exact-compiler attestation. Readiness/tool failures can arrive as diagnostics.                                                                                                                                                                 | Upstream owner adds typed readiness, success, refusal, and failure outcomes with authority correlation and compiler provenance. IDE owner rejects ambiguous payloads before invocation or rendering.                                                                                     |
| **R-RK-COMP-03**     | open compatibility risk               | The daemon scans disk and its diagnostics method cannot receive the unsaved Monaco snapshot, so the returned result cannot be proven current for an edited buffer.                                                                                                                                                                                                        | Upstream owner defines saved/unsaved snapshot semantics and a hash-bound overlay/snapshot request. Under the temporary decision, the IDE does not implement a Problems-only saved-disk fallback.                                                                                         |
| **R-RK-COMP-04**     | open upstream bug                     | The diagnostics capability advertises the TypeScript LSP backend/runtime, while exact diagnostics actually use the separate `typescript-compiler-exact-v1` process.                                                                                                                                                                                                       | Upstream owner advertises per-operation compiler backend/runtime and attests the selected toolchain in the result. IDE owner compares exact advertised and observed evidence before invocation/rendering.                                                                                |
| **R-RK-COMP-05**     | open upstream bug                     | Advertised LSP limits conflict with compiler execution: 10-second/64 MiB operation metadata versus the exact compiler bridge's 30-second/8 MiB bounds.                                                                                                                                                                                                                    | Upstream owner publishes compatible authoritative runtime, timeout, output, and response-bound contracts. IDE owner refuses mismatches and revalidates timeout and oversized-response cases.                                                                                             |
| **R-RK-COMP-06**     | controlled by roadmap freeze          | RefactorKit `v0.6.2` TypeScript/JavaScript capabilities are not universally stable, and format/move/organize imports/change signature/extract/inline are unsupported.                                                                                                                                                                                                     | Keep provider foundations and unsupported operations in unscheduled TODO inventory. Integrate only an exact released capability after immutable real provider and IDE acceptance evidence; never simulate support.                                                                       |
| **R-RK-COMP-07**     | parked — option A (wait for upstream) | Immutable `v0.6.2` `project.open` invokes workspace recovery and adds `.refactorkit/workspace.lock` while advertising `writesWorkspace:false`; this violates `REQ-REFACTORKIT-TS-002` even when subsequent semantic operations are read-only.                                                                                                                             | No metadata-write exception is authorized. Resume only when read-only `project.open` and semantic navigation do not write the workspace, or when the provider capability/contract is corrected and separately approved; then rerun the hidden-file byte-tree audit before any promotion. |
| **R-RK-DEC-01**      | `WAIT_FOR_UPSTREAM_PROTOCOL_FIX`      | Option A is selected until further notice for `REQ-REFACTORKIT-TS-001`; implementing a narrowed fallback could create misleading saved-disk Problems or approximate Monaco markers.                                                                                                                                                                                       | IDE owners implement neither fallback. Resume after all six upstream protocol conditions below are met, or explicit product revision. This temporary reversible decision is not a permanent ADR.                                                                                         |
| **R-RK-POL-01**      | controlled by machine-contract gate   | Announced RefactorKit search operations with optional JSON could tempt the IDE to parse human stdout or accept unbounded, uncorrelated payloads as a protocol.                                                                                                                                                                                                            | Keep all such operations TODO until a released strict typed bounded versioned JSON contract or equivalent daemon DTO carries errors, truncation, authorized locations, and request/result correlation and passes immutable real acceptance evidence. Human stdout is forbidden.          |

> **Resolved temporary diagnostics decision — `WAIT_FOR_UPSTREAM_PROTOCOL_FIX`:** the IDE will not implement a Problems-only saved-disk fallback and will not fabricate approximate Monaco line markers. Resumption requires upstream (1) exact bounded UTF-16 ranges or explicit enforceable precision, (2) request/result authority correlation, (3) exact compiler attestation, (4) explicit saved/unsaved snapshot semantics, (5) structured readiness/refusal/failure outcomes, and (6) compatible advertised/observed runtime and response bounds. The user may explicitly revise this reversible option-A decision; it is not recorded as a permanent ADR.

> **Resolved temporary symbol-navigation decision — option A, wait for upstream:** `REQ-REFACTORKIT-TS-002` remains declared `@not-implemented` and blocked despite deterministic 18/18 Story evidence. No `.refactorkit/workspace.lock` or other metadata write is authorized. Resume only when read-only `project.open` and semantic navigation do not write the workspace, or when the provider capability/contract is corrected and separately approved.

Both TypeScript/JavaScript RefactorKit requirements remain parked outside the active roadmap. Structural outline and identifier search remain provider foundations; TypeScript references/rename and general Java refactoring remain provider-foundation or IDE TODO according to observed support, not simulated product capabilities. Chapter 1 goals remain confirmed, and the layout amendment remains CURRENT/AS-BUILT. Canonical strict migration passed after this reconciliation with two web scenarios, one deterministic desktop-harness scenario, and one fresh-build Linux native GUI scenario. Migration maturity remains incomplete because CachyOS/Synapse packaging and broader executable requirements are still gaps. Native file-open completion does not change layout evidence, frozen IntelliSense/JDT LS inventory, either RefactorKit option-A decision, full desktop diagnostics, or the real-provider no-write failure.

---

## Section 12: Glossary

| Term                                  | Definition                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port**                              | TypeScript interface defining a platform-agnostic contract for a capability (file tree, editor, terminal)                                                                                                                                                                                                                               |
| **Adapter**                           | Platform-specific implementation of a port (browser or Tauri)                                                                                                                                                                                                                                                                           |
| **View Model**                        | Logic layer that coordinates ports, stores, and UI state — no rendering                                                                                                                                                                                                                                                                 |
| **Panel**                             | A layout region (left sidebar, editor area, bottom panel) that hosts one or more components                                                                                                                                                                                                                                             |
| **pnpm workspace**                    | Monorepo structure where multiple packages share a root `node_modules`                                                                                                                                                                                                                                                                  |
| **JDT LS**                            | External EPL-2.0 Eclipse Java language server; managed lifecycle, exact-model document sync, diagnostics, completion, hover, signature help, and cancellation are implemented. Broader expansion is frozen as unscheduled TODO, not an active target.                                                                                   |
| **RefactorKit**                       | External capability source behind provider-neutral IDE ports. Current IDE capability is limited to status/capability discovery and the separately validated Java import transaction. Provider foundations, experimental operations, support code, and optional human output are not IDE capabilities; human stdout is never a protocol. |
| **Canonical metadata**                | Strictly validated schema-v1 data sorted deterministically by the IDE boundary (language ID, operation, and extension where applicable). It is not provider-supplied ordering and does not imply runtime readiness.                                                                                                                     |
| **Readiness policy**                  | Pure fail-closed decision that may construct an immutable authority-bound request from exact evidence. It neither starts a tool nor proves that the downstream protocol can carry or satisfy that request.                                                                                                                              |
| **Meaningful RED**                    | Expected failing Story evidence at the intended missing behavior boundary after prior steps pass. It demonstrates an honest gap and must not be reported as implementation success.                                                                                                                                                     |
| **Monaco model**                      | Per-file editor text model retained across active tabs; it is an editing primitive, not proof of Java semantic language-service support                                                                                                                                                                                                 |
| **Plugin-shaped feature**             | Built-in first-party module with descriptor/contribution-shaped contracts; it is not a generic plugin loader, sandbox, permission grant, or arbitrary code-execution mechanism                                                                                                                                                          |
| **Setup transaction**                 | Native, durable, exact-digest-approved sequence of allowlisted reversible operations. The AS-BUILT concrete SDK transaction has 15 operations and exact-baseline restore; external interactive setup remains FUTURE/TARGET.                                                                                                             |
| **Declared status**                   | The single effective status tag authored on a Gherkin scenario, such as `@implemented-and-validated`; it is not inferred from test discovery or execution.                                                                                                                                                                              |
| **Observed validation**               | Dated evidence from an actual validation mode and target. It remains separate from declared status and is bounded by the environment and assertions that ran.                                                                                                                                                                           |
| **No-workspace-write**                | A requirement that the complete operation lifecycle—including provider open/recovery and hidden metadata—leave the authorized workspace byte tree unchanged. An advertised `writesWorkspace:false` flag is evidence to audit, not a waiver for observed mutation.                                                                       |
| **Deterministic desktop Story**       | A desktop-tagged Story run over controlled Tauri-invoke/protocol fixtures. It can prove desktop composition and orchestration but is not packaged Tauri GUI/E2E or real-daemon filesystem evidence.                                                                                                                                     |
| **Desktop Tauri harness aggregate**   | Deterministic aggregate route for scenarios declared `@implemented-not-e2e-validated @desktop`. It carries explicit `nativeGui: false` and `e2e: false` evidence metadata and cannot support `@implemented-and-validated @desktop`.                                                                                                     |
| **Desktop Tauri WebDriver aggregate** | Linux native GUI/E2E route for scenarios declared `@implemented-and-validated @desktop @native-gui`. It freshly builds and launches a release/no-bundle executable and records its SHA-256; `packagedApplication: false` means it supplies no CachyOS/Synapse package evidence.                                                         |

---
