# ARC42 — IDE Architecture Documentation

## Section 1: Introduction & Goals

### 1.1 Requirements Overview

The IDE is a three-panel Integrated Development Environment:

1. **Left sidebar** — accordion navigation with File Explorer above Workspace Explorer; both sections expand and collapse independently.
2. **Right/center area** — Monaco-only editor for opening and editing files.
3. **Bottom panel** — a dynamic accessible tool-window host. Desktop contributes core Terminal and AI Agent tools plus a conditional project-scoped Problems tab for the current Java context/diagnostics; web contributes core Terminal only.

It runs as a **Tauri 2.x desktop application** and is reusable as a **standalone webapp** with no Tauri dependency.

Workspace Explorer lists every registered workspace and owns workspace switching, refresh, loading, and error feedback. The former duplicate workspace selector in the header has been removed. File Explorer compacts package-only namespace chains only beneath recognized Java source roots. It preserves the deepest real node/path, distinguishes production `src` and test folders, gives `pom.xml` a dedicated Maven icon, and leaves unrecognized directory hierarchies unchanged.

Monaco Editor 0.52.2 is the only file editor. It is bundled locally with same-origin workers, one model per file, and a Java Monarch/basic language contribution. Lazy activation waits for a visible, renderable, positive-area active-file host before mount and timeout; layout reruns after visibility returns. No-file state is a Kate-style create flow. Loading uses an inert source-free placeholder, and import/runtime failure offers Retry Monaco with no native fallback. No CDN or CSP expansion is required.

The implemented Java baseline has two desktop foundations. **Settings > Java** exposes only global full-JDK/JDT LS lifecycle/status and RefactorKit availability/version/path. Managed JDT LS now provides provider-neutral lifecycle, versioned document-sync, diagnostics, completion, hover, signature-help, and cancellation contracts; typed Tauri adapters; fixed no-shell Rust/LSP transport with isolated per-workspace data; and guarded Monaco providers. Fixed native RefactorKit scan/query/navigation handlers exist, but their project actions remain unexposed globally. Browser mode has no Java technology tab or hidden Java polling.

Interactive Phase 2 diagnostics, completion, hover, signature help, and cancellation operate only for the exact synchronized Java model. Workspace/session/path/URI/version/request/cancel guards, optimistic versions, serialized full-text `didChange` flush-before-request, and stale/late suppression protect the flow. Current diagnostics feed Monaco and a conditional project-scoped Problems tab; that visibility guard is not Java module activation. Completion maps only its primary edit; additional/workspace edits and commands are suppressed. Documentation is untrusted Markdown with HTML disabled, and managed configuration sets `java.signatureHelp.enabled=true`. No Java module detector, activation coordinator, full activated-module contribution runtime, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, or general refactoring integration exists yet.

One bounded IDE workflow is implemented separately: **Paste Java Class from Clipboard** is available from a selected directory's context menu or `Ctrl/Cmd+V` while the directory tree owns focus; editor paste is not intercepted. Its coordinator capability-probes before an explicit clipboard read, presents backend placement/diff/risk/diagnostic/provenance/conflict/staleness evidence, applies only the exact approved ready plan under workspace/selection generation guards, displays the backend transaction, and refreshes/opens backend-reported paths. Rust manages one canonical-workspace, generation-scoped `bin/refactorkit-daemon` NDJSON process and supports preview, exact-plan apply, discard, and transaction rollback. Compatibility is provider-version-neutral: API compatibility, required method capabilities, normalized language-kernel metadata, and exact safety fields authorize the boundary; provider version is diagnostic only. The IDE never parses or copies raw Java in presentation code, infers a package, writes files directly, falls back to target-package, logs source, or sends source/plan/transaction data to Pi. Missing or incomplete providers remain unavailable before clipboard read. See [docs/JAVA_INTELLISENSE_PLAN.md](docs/JAVA_INTELLISENSE_PLAN.md); the broader target direction does not claim IntelliJ IDEA Ultimate parity.

The desktop also contains the AS-BUILT built-in, experimental, plugin-shaped XCOM 2 WOTC feature `ide.xcom2-wotc`. Its **Settings contribution** presents the bounded read-only Steam monitor, a separate pure non-executable dry-run planner, and the concrete repeatable SDK setup transaction. Prepare audits vanilla SDK AppID `602410`; the validated baseline produces exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game. Machine-level journals and content-addressed backups preserve the Steam build/manifest/root fingerprint and exact original bytes, hashes, modes, inventory, and symlink absence.

Apply requires the complete digest approval for that single external-SDK transaction. Restore Vanilla SDK restores the captured baseline exactly, refuses conflicting overwrites, and permits rollback followed by Prepare Again. A live Prepare audit found exactly 15 executable operations and no blockers; no live Apply occurred. Protontricks, Steam shortcut, Proton-prefix, package-manager, and interactive setup remain FUTURE/TARGET, excluded and non-executable. The browser setup adapter reports unavailable without simulation, generic workspaces have no XCOM activity entry or bottom tab, and no generic plugin runtime exists. Evidence-activated Java/XCOM project contributions remain target work. See [docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md).

#### Evidence and status rule

This ARC42 document is the **central integrated architecture narrative** and the mutable source for implementation status. A statement is **CURRENT/AS-BUILT** only when supported by the repository's source, tests, configuration, or dated validation evidence. Unimplemented work is labeled **FUTURE/TARGET** or **PLANNED**. Validation results are dated observations, not permanent capability guarantees.

Detailed specialist narratives remain bounded satellites and are linked rather than duplicated here:

- [IDE extension plan](docs/IDE_EXTENSION_PLAN.md);
- [IntelliJ Ultimate capability roadmap](docs/INTELLIJ_ULTIMATE_ROADMAP.md);
- [Java IntelliSense plan](docs/JAVA_INTELLISENSE_PLAN.md);
- [XCOM 2 requirements](docs/XCOM2_MODDING_PLUGIN_REQUIREMENTS.md); and
- [C4 structural views](docs/c4/system-context.md), whose descriptions contain stable architecture facts rather than mutable test counts.

#### DDD roadmap status

**CURRENT/AS-BUILT:** `apps/desktop/src/App.tsx` is a 672-line composition-only root. It wires the seven extracted Editor, Java Language, RefactorKit Import, Workspace, AI Agent, XCOM Setup, and RefactorKit Status application controllers plus six extracted shell/document/editor controllers: Settings, Terminal, File Explorer, Document Navigation, Editor Command, and Desktop Shell. The RefactorKit Status controller is provider-neutral and diagnostic-only; it coordinates normalized status and capability discovery and grants no mutation authority. The separate RefactorKit Import controller may request preview/apply/discard only when the injected port advertises the required capability contract.

The Rust Java Language boundary is a 123-line Tauri facade over application, contract, path-policy, protocol, semantic, toolchain, and support modules. The RefactorKit daemon boundary is a 63-line Tauri facade over application, capability-policy, contract, path-policy, and transport modules. Public Tauri commands remain inbound facades; process ownership, orchestration, normalization, authorization policy, and transport live behind them.

**PLANNED:** executable requirements/specifications and a real unlocked click-to-open smoke test. The GUI smoke remains pending because the graphical session locked; no click-to-open result is claimed. These outstanding items mean full DDD completion is not claimed.

### 1.2 Quality Goals

| Quality Goal    | Description                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **Reusability** | UI and core logic shared between desktop and web targets                                        |
| **Portability** | Future runtimes should remain isolated behind app shells and adapters                           |
| **Testability** | Ports enable mocking; adapters are isolated; UI is platform-agnostic                            |
| **Performance** | Monaco is lazy and model-per-file; xterm.js is virtualised; panel resizing remains smooth       |
| **Resilience**  | Monaco retries fail visibly; source is not duplicated into a fallback editor or loading surface |

### 1.3 Stakeholders

- **End users** — developers using the IDE for coding, file browsing, and terminal access.
- **Developers** — team building and maintaining the codebase; benefit from clear package boundaries.
- **Platform maintainers** — those adding or updating desktop/web adapter implementations.

---

## Section 2: Constraints

### 2.1 Technical Constraints

- **pnpm workspace** — all packages live under a single monorepo.
- **Vite** — both `apps/web` and `apps/desktop` use Vite as the build tool.
- **Tauri 2.x** — desktop target requires Rust and Tauri CLI.
- **No Tauri imports in shared packages** — `packages/ui/`, `packages/web-core/`, `packages/contracts/` must not import `@tauri-apps/api`.
- **External Java import authority** — only a capability-advertising managed RefactorKit may preview, apply, and roll back a `targetDirectory` import. The IDE must not infer support from version, convert a directory to target-package, or write a fallback patch.
- **Clipboard privacy** — capability probing precedes clipboard access; the clipboard is read only for an explicit directory-tree action and is never routed to Pi. Normal editor paste remains independent.

### 2.2 Business / Organizational Constraints

- The webapp must build and run independently for demos and automated validation.
- The desktop app must work offline with workspace-scoped file-system access.

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

| Actor                                      | Description                                                                       | Interaction                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **User (developer)**                       | Interacts with the IDE via keyboard and mouse                                     | Opens files, navigates tree, types commands                                                                              |
| **File System**                            | Workspace-scoped OS file system                                                   | Read/write files, list directories                                                                                       |
| **OS Programs** (desktop only)             | Non-interactive executables available from `PATH`                                 | Run bounded one-shot commands                                                                                            |
| **Full JDK** (desktop only)                | Externally installed, separately licensed Java runtime/toolchain                  | Launches the managed JDT LS process                                                                                      |
| **Eclipse JDT LS** (desktop only)          | Checksum-installed external EPL-2.0 language server; not bundled or redistributed | Managed per-workspace lifecycle and future semantic LSP service                                                          |
| **RefactorKit** (desktop only)             | External capability source behind provider-neutral IDE ports                      | Diagnostic status/capability discovery and, only when explicitly advertised, the separate import transaction protocol    |
| **Steam manifest metadata** (desktop only) | Local bounded installation evidence, not an IDE-controlled transaction            | Read-only allowlisted evidence for AppIDs 268500, 602410, and optional 299990; provenance is redacted                    |
| **Web Browser** (webapp only)              | Runtime environment                                                               | Provides browser APIs and `localStorage`; reports local Java and XCOM native capabilities unavailable without simulation |

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

| Package                      | Responsibility                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web/`                  | Standalone webapp entry point; composes browser adapters                                         |
| `apps/desktop/`              | Tauri desktop app entry point; composes Tauri adapters and Rust backend                          |
| `packages/contracts/`        | Shared TypeScript types, including provider-neutral language session and document-sync contracts |
| `packages/web-core/`         | Port interfaces, Zustand stores, view models — no UI                                             |
| `packages/ui/`               | Reusable React UI components — no platform imports                                               |
| `packages/browser-adapters/` | Browser implementations of ports                                                                 |
| `packages/tauri-adapters/`   | Tauri implementations of ports                                                                   |

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

The seven extracted application controllers are C3 components composed by `apps/desktop/src/App.tsx`; they depend on injected ports and collaborators rather than importing native implementations.

| Controller             | Current responsibility and boundary                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor**             | Coordinates guarded file open/create, tab activation/close, deferred persisted-session restore, workspace reset, and presentation-safe diagnostics. A document is ready only when its tab and loaded buffer agree.                     |
| **Java Language**      | Owns workspace language lifecycle, versioned Java document sync, diagnostic events and Problems projection, guarded completion/hover/signature help, cancellation, and stale identity checks.                                          |
| **RefactorKit Import** | Owns the separate capability-gated clipboard import flow, including selection/workspace freshness, preview, exact displayed-plan apply, invalidation/discard, result refresh, and backend-reported file opening.                       |
| **Workspace**          | Owns registry metadata, the authorized active root, loading/switching state, and the shared `WorkspaceGeneration` authority. It coordinates collaborator invalidation, activation, loading, restoration, and stale-result suppression. |
| **AI Agent**           | Owns configuration/status plus workspace-keyed commands, session messages, activities, prompt state, and stale-request suppression. Only the explicit trimmed panel prompt crosses its port.                                           |
| **XCOM Setup**         | Owns workspace-scoped read-only monitoring, pure dry-run planning, native transaction/history actions, authoritative event re-reads, and failed-transition settlement/restoration.                                                     |
| **RefactorKit Status** | Owns provider-neutral, diagnostic-only daemon status and capability discovery. Status and capability outcomes settle independently; stale requests/generations are dropped. It has no preview/apply/rollback or mutation authority.    |

`WorkspaceGeneration` initializes at 1, remains positive, and advances monotonically for each user-initiated workspace-switch attempt; exhaustion fails closed. RefactorKit Import also initializes its local generation at 1 when no shared authority is supplied and consumes the Workspace controller's generation in desktop composition.

The Workspace controller coordinates lifecycle order but does not absorb feature behavior. The RefactorKit Import controller remains distinct from the diagnostic RefactorKit Status controller, and editor readiness is the input gate for Java document synchronization.

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

- `java_language.rs` is a 123-line Tauri facade. Application, contract, path-policy, protocol, semantic, toolchain, and support modules own the implementation behind it.
- `refactorkit_daemon.rs` is a 63-line Tauri facade. Application, capability-policy, contract, path-policy, and transport modules own the implementation behind it.

These line counts are dated structural evidence, not size budgets or architectural guarantees.

### 5.3 Current and Target Java Intelligence Boundary

Java IntelliSense extends the existing hexagonal flow rather than bypassing it:

```text
CURRENT Settings > Java
  → LanguageSessionPort → Tauri adapter → Rust managed lifecycle → external JDT LS
  → RefactorKit availability/version/path only
  → browser: no Java surface or hidden polling

CURRENT native foundation (not globally exposed)
  → fixed RefactorKit project-action handlers

FUTURE evidence-based Java module activation
  → contextual Problems/Build/Tests/Logs/Java tools
  → DocumentSyncPort + semantic ports → Tauri adapter/Rust bridge → managed JDT LS
  → controlled RefactorKit project workflows
```

The UI does not speak LSP or spawn tools. **Current/as-built:** provider-neutral lifecycle/document/diagnostic/semantic contracts, typed Tauri adapters, Rust managed JDT LS transport, and guarded Monaco providers implement initialization, versioned open/change/save/close, diagnostics, completion, hover, signature help, cancellation, and stale suppression. Diagnostics project into Monaco and the conditional Problems tab without claiming module activation. Fixed RefactorKit operations remain a separate native foundation with no global project-action UI; its clipboard import is operational only when the complete capability contract is advertised. **Future/target:** evidence-based Java activation, the full activated-module Problems/Build/Tests/Logs/Java-tools lifecycle, definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, and general refactoring policy. The browser reports both local providers unavailable.

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
2. **App component** (`App.tsx`) initializes stores and composes seven application controllers plus six extracted shell/document/editor controllers. Workspace-scoped controller auto-loads are deferred.
3. **Workspace authorization transition** starts at positive generation 1. The Workspace controller awaits `ensureCurrentWorkspace`; no registry read or dependent native workspace read may overtake it.
4. **Registry promotion** lists the registry after authorization and promotes the ensured workspace over a stale or empty snapshot.
5. **Dependent activation** begins only after the authorized root and promoted registry are current: editor restore, file-tree load, Java attach/status load, workspace-keyed AI activation/commands, RefactorKit diagnostic discovery, and XCOM monitor/transaction loading run under the shared generation.
6. **Panel layout** renders three regions using CSS Grid. BottomPanel descriptors carry icon/title/scope/badge/disabled/active metadata and accessible tab/tabpanel keyboard behavior.
7. **Sidebar navigation** renders independently collapsible File Explorer and Workspace Explorer sections; Workspace Explorer lists registered workspaces and handles switching/refresh/errors, while File Explorer derives Java-aware presentation only below recognized source roots.
8. **Editor** renders a no-file create state or source-free loading placeholder; only a visible, renderable positive-area active-file host may start Monaco import/mount and timeout, followed by layout when visibility returns. Failure offers Retry Monaco.
9. **Terminal** setup is workspace independent and may proceed during root authorization; web shows a simulated session and desktop executes submitted commands one at a time.

If initial authorization fails, dependent workspace activation does not run, loading settles, and presentation receives a sanitized error. A later user switch invalidates an older cold-start attempt and advances the generation before collaborator reset/detach.

### 6.2 Workspace Switch Flow

1. Advance `WorkspaceGeneration` before asynchronous detach or native switch work.
2. Reset Editor and RefactorKit Import state; invalidate Java, RefactorKit Status, AI Agent, and XCOM work through narrow collaborator interfaces.
3. Detach the old Java session, then invoke the serialized native workspace switch only if the generation is still current.
4. Attach/activate the returned authorized workspace, clear shell previews/terminal state, and reload registry, file tree, Java, AI Agent, RefactorKit diagnostics, and XCOM state.
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

### 6.4 RefactorKit Native Foundation and Managed Daemon Flow

Fixed Rust handlers validate explicit Java selectors and authorized workspace-relative locations. The 63-line `refactorkit_daemon.rs` Tauri facade delegates transactional import to application, capability-policy, contract, path-policy, and transport modules. The transport launches `bin/refactorkit-daemon` directly without a shell and owns one NDJSON process per workspace generation. The application service validates the advertised API/capability/safety contract without authorizing from provider version, opens the canonical workspace, correlates requests, normalizes rich preview output, applies only the exact `planId`, invokes `refactor.discard` on cancellation/invalidation, and rolls back by transaction ID. Malformed protocol output, timeout, workspace switch, and application exit kill the process; bounded logs exclude source text. These handlers are **not currently exposed as global scan/query/navigation actions**. A future Java activation coordinator may expose those broader operations as project-scoped tools only for an evidence-activated Java module.

### 6.5 Paste Java Class from Clipboard Flow

1. The developer selects a directory and invokes its context action or presses `Ctrl/Cmd+V` while the tree owns focus. Editor paste is not intercepted.
2. The coordinator validates workspace/directory selection and probes `java.importExternalClass`; failed, absent, target-package-only, or incomplete capability stops with no clipboard read or write.
3. Only a provider advertising the full `targetDirectory`, preview, apply, discard, rollback, and safety contract triggers one explicit clipboard read. Empty/oversized text is refused; source remains transient and never reaches Pi or logs.
4. RefactorKit alone produces the complete correlated plan. Refused/error/stale plans retain backend evidence for review but cannot apply. Conflicts, blockers, ineligibility, changed workspace/selection, or required provenance acknowledgement disable apply; cancel/invalidation calls `refactor.discard`.
5. Approval binds the exact displayed `planId` and current generations. Apply sends that identity; the IDE neither infers a package, reconstructs edits, nor writes directly.
6. A successful backend result supplies the opaque transaction, changed files, and primary file used for display, tree refresh, and opening. Rollback is by transaction ID through RefactorKit.

Steps 3–6 are operational only for a provider satisfying the API, required capability, normalized language-kernel, and exact safety contract. Real temporary fixtures passed against both 0.5 and 0.6 providers, proving provider-version-neutral preview/no-write, discard invalidation, exact apply, and byte-for-byte rollback. Missing or incomplete providers remain refused without force or fallback.

### 6.6 Managed Java Session Flow

**Current/as-built:** the desktop starts an authorized workspace session through the Tauri adapter. The 123-line `java_language.rs` Tauri facade delegates to application, contract, path-policy, protocol, semantic, toolchain, and support modules. Behind that facade, Rust discovers a full JDK and valid external JDT LS, launches the fixed isolated process without a shell, initializes it, and transports versioned open/change/save/close plus completion/hover/signature/cancellation. The coordinator increments versions optimistically, serializes full-text changes, flushes them before requests, and suppresses stale/late results. Exact-model Monaco guards and safe presentation policies prevent cross-model rendering or implicit side effects. RefactorKit runs independently for its generation-scoped external-import transaction and fixed allowlisted operations.

**Future/target:** definition/references and Monaco gestures, code actions, formatting, rename, hierarchy, evidence-based project activation and the full activation-scoped project tool lifecycle, cache policy, and generalized structured multi-file preview/apply.

### 6.7 Resize Flow

```
User drags panel divider
  → ResizeHandler component dispatches resize action
  → Zustand panel store updates panel sizes
  → PanelLayout re-renders with new CSS Grid fractions
  → Monaco Editor and xterm.js resize via API calls
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
- External Java clipboard import: target validation and authoritative capability probing occur before clipboard access. Unsupported, stale, refused, blocked, mismatched, or failed work stops without fallback. Clipboard source is transient, goes only to RefactorKit preview after support is proven, and never reaches Pi. Exact-plan approval, backend-owned mutation/rollback, and backend-authoritative refresh/open paths prevent the IDE from manufacturing writes.
- JDT LS and the full JDK are external, non-bundled tools under separate licenses. The pinned JDT LS release is installed/verified with `pnpm tools:install-jdtls` and `pnpm tools:verify-jdtls`.
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

| Requirement     | Scenario                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reusability** | Webapp builds with `pnpm build` from `apps/web/` without any Tauri dependency                                                                       |
| **Portability** | A future runtime should be isolated behind a new app shell and adapter package                                                                      |
| **Testability** | Ports can be mocked in unit tests; adapters tested in isolation per platform                                                                        |
| **Performance** | Monaco loads only for a visible, renderable positive-area active-file host, keeps one model per file, and xterm.js uses virtual rendering           |
| **Resilience**  | Hidden/zero-area layout defers Monaco; loading is source-free; import/runtime failure offers explicit retry; visibility restoration triggers layout |

### 10.1 Dated Validation Evidence

| Evidence dated 2026-07-13             | Result                                                              | Scope and limits                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend suite**                    | 719 tests passed across 60 files                                    | Covers the extracted controller slice and existing frontend behavior. TypeScript, lint, formatting, package boundaries, and web/desktop builds passed in the recorded frontend validation.                                             |
| **Rust default suites**               | 158 unit tests passed; 6 ignored. Integration: 1 passed; 1 ignored. | Formatting, locked check, and strict Clippy passed. Ignored external/live tests are not implied by the default count.                                                                                                                  |
| **Real JDT LS lifecycle smoke**       | Passed                                                              | Covered discovery, initialization, capability normalization, event polling, workspace-data isolation, and graceful shutdown against the installed external JDK/JDT LS.                                                                 |
| **Real JDT LS semantic smoke**        | Passed                                                              | Covered repeated completion containing `repeat`, helper hover, signature help containing `substring(int beginIndex)`, cancellation, `didClose`, and managed stop.                                                                      |
| **Real temporary RefactorKit smokes** | Passed against discovered 0.5 and packaged 0.6 providers            | Both providers were evaluated by the same API/capability/safety decision. Preview performed no write; discard invalidated the plan; exact-plan apply succeeded; rollback restored bytes exactly. Provider version was diagnostic only. |
| **Unlocked click-to-open GUI smoke**  | **PENDING**                                                         | The graphical session locked before this smoke could be completed. No click-to-open, GUI, or browser visual/e2e result is claimed.                                                                                                     |

This documentation follow-up rechecked Markdown formatting, relative link targets, controller/C4 structural alignment, and Structurizr validation on **2026-07-13**. It did not rerun the application suites. Structurizr passed with only the validator's non-fatal cloud-theme end-of-life warnings.

---

## Section 11: Glossary

| Term                      | Definition                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port**                  | TypeScript interface defining a platform-agnostic contract for a capability (file tree, editor, terminal)                                                                                                                                                                                                              |
| **Adapter**               | Platform-specific implementation of a port (browser or Tauri)                                                                                                                                                                                                                                                          |
| **View Model**            | Logic layer that coordinates ports, stores, and UI state — no rendering                                                                                                                                                                                                                                                |
| **Panel**                 | A layout region (left sidebar, editor area, bottom panel) that hosts one or more components                                                                                                                                                                                                                            |
| **pnpm workspace**        | Monorepo structure where multiple packages share a root `node_modules`                                                                                                                                                                                                                                                 |
| **JDT LS**                | External EPL-2.0 Eclipse Java language server; managed lifecycle, exact-model document sync, completion, hover, signature help, and cancellation are implemented; remaining Java slices are explicit targets                                                                                                           |
| **RefactorKit**           | External capability source behind provider-neutral IDE ports. RefactorKit Status is diagnostic-only; the separate import flow receives mutation authority only when the required preview/apply/discard/rollback capability contract is advertised. Settings exposes diagnostic availability/version/path/capabilities. |
| **Monaco model**          | Per-file editor text model retained across active tabs; it is an editing primitive, not proof of Java semantic language-service support                                                                                                                                                                                |
| **Plugin-shaped feature** | Built-in first-party module with descriptor/contribution-shaped contracts; it is not a generic plugin loader, sandbox, permission grant, or arbitrary code-execution mechanism                                                                                                                                         |
| **Setup transaction**     | Native, durable, exact-digest-approved sequence of allowlisted reversible operations. The AS-BUILT concrete SDK transaction has 15 operations and exact-baseline restore; external interactive setup remains FUTURE/TARGET.                                                                                            |

---
