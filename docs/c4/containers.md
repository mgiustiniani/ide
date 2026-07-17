# Container Diagram (C2)

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only with a locally bundled Java language contribution. Guarded Java semantics cross typed application/Tauri/Rust boundaries without Java module activation. **Paste Java Class from Clipboard** remains a separate managed RefactorKit transaction. Desktop XCOM 2 activation combines a fixed read-only project configuration with independent convention recognition and produces only a workspace-scoped activity. This structural view does not establish native-GUI, live-provider, or packaged-application execution evidence.

```text
Web App ──> Web Browser
  └─ dynamic BottomPanel: core Terminal only
     no Java/XCOM startup polling

Desktop App ──typed Tauri boundary──> Rust Backend
  ├─ Directory tree: directory context action + tree-scoped Ctrl/Cmd+V
  │    └─ exact required-method probe first; incomplete providers stop before clipboard read
  ├─ guarded import: preview → conditional acknowledgement → exact-plan apply
  │    └─ discard stale/cancelled plans; refresh/open from backend results
  ├─ Monaco-only editor + locally bundled Java syntax highlighting
  │    └─ exact synchronized Java model: completion / hover / signature help
  │       optimistic version → serialized didChange flush → guarded request
  ├─ Left Sidebar: File Explorer above Workspace Explorer
  │    ├─ independent collapse + registry/switch/refresh/error states
  │    └─ collapsed whole sidebar retains an Expand control in the activity rail
  ├─ dynamic BottomPanel: core Terminal + AI Agent
  │    ├─ project Problems while ready Java context or projected items exist
  │    └─ status bar retains the bottom-panel visibility toggle
  ├─ dynamic activity rail: `XCOM 2 Project` after configured or recognized activation
  │    └─ recognition only; mirrors the complete warning only if recognition survives
  ├─ Settings / Workspace / Current workspace
  │    └─ neutral refresh checking or one complete atomic configuration warning
  ├─ Settings / Java: JDK + JDT LS lifecycle/status,
  │                   RefactorKit availability/version/path
  └─ Settings / XCOM machine: health + separate dry run
                               + Prepare/Apply/Restore/Prepare Again
       ├─ open only: one monitor + one transaction adapter lifecycle
       └─ close: invalidate, unsubscribe, and clear both poll timers

Rust Backend ──managed NDJSON──> compatible RefactorKit provider
  └─ provider-version-neutral API + exact import-method gate
     normalized metadata retained as evidence, not blanket authorization
     one canonical-workspace/generation daemon
     project-content-safe preview → exact planId apply → discard
     rollback remains a backend authority; no user-facing import action

Desktop App ──provider-neutral Tauri calls──> Rust Backend ──LSP/stdio──> JDT LS
  └─ didOpen/didChange/didSave/didClose + completion/hover/signature/cancel
     workspace/session/path/URI/version/request/cancel guards drop stale work

Desktop App ──strict configuration/scanner adapters──> Rust Backend
  ├─ fixed `.ide/xcom2.json` read + contained-root validation; no input writes
  ├─ bounded read-only Option A metadata below the authorized workspace
  ├─ exactly eight safe codes map to fixed, non-interpolated complete warning copy
  └─ exact joint correlation rejects stale results; no configuration/evidence watcher or poll

Rust Backend ──> authorized files, JDK, JDT LS, RefactorKit,
                 Steam evidence + installed game/SDK + rollback state
```

## Runtime Containers

| Container        | Technology                    | Current responsibility                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web App**      | React + Vite SPA              | Browser editing and persistence. Its XCOM setup adapter explicitly reports unavailable unless deliberate simulation is enabled; normal composition starts no hidden XCOM polling or simulated native state.                                                                                                                                                               |
| **Desktop App**  | React + Vite in Tauri WebView | Owns jointly correlated configured and convention activation, synchronous revocation, neutral checking, exhaustive safe-code mapping, and shared atomic warning presentation under Workspace Settings. A diagnostic grants no activity; strong independent Option A recognition may preserve the activity and mirror the warning. XCOM machine Settings remains separate. |
| **Rust Backend** | Rust + Tauri commands         | Exposes a fixed read-only `.ide/xcom2.json` reader and Option A metadata scanner. They do not follow symlinks, write XCOM project inputs, accept external roots, parse module content, or disclose raw paths/content/errors. Normal application-owned `.ide/workspace.json` marker/registry writes are a separate workspace responsibility.                               |

JDK, JDT LS, RefactorKit, OS programs, and Steam metadata are external systems rather than IDE containers.

## Current Java Clipboard Paste Boundary

The IDE contracts, presentation, coordinator, Tauri adapters, and managed native daemon bridge form a provider-version-neutral compatibility boundary. Provider version is retained only for diagnostics. The advertised API and exact required import/apply/discard/rollback method features gate the current import transaction; normalized language-kernel, runtime-limit, and safety metadata are retained evidence rather than blanket authorization.

```text
selected directory + explicit tree action
  → require the advertised API and exact import/apply/discard/rollback method features
     └─ missing or incomplete required methods → unavailable (zero clipboard reads, no force)
  → one explicit clipboard read
  → java.importExternalClass(targetDirectory) rich project-content-safe preview
  → per-plan acknowledgement when license/provenance risk requires it
  → complete reviewed plan + exact approval
  → apply the exact planId → transaction + changedFiles + primaryFile
  → refresh/open from backend results; discard on cancel/invalidation
```

Rust opens the canonical workspace and scopes one NDJSON daemon to its generation. Preview/no-write means no imported target or other project-content write before Apply; provider `project.open` may create `.refactorkit/workspace.lock`, so this is not a complete hidden-metadata byte-tree guarantee. Malformed output, timeout, workspace switch, and app exit terminate the daemon. Selection/workspace invalidation and cancellation invoke `refactor.discard`. Rollback exists behind contracts, adapters, Rust, and provider authority, but the current import UI exposes no rollback action. There is no package inference, target-package fallback, direct file-tree mutation, editor paste interception, raw Java copy, source logging, or Pi/AI Agent disclosure.

## Internal Package Boundaries

| Package                     | Current role                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@ide/contracts`**        | Defines provider-neutral language, RefactorKit, XCOM setup, and XCOM project-activation DTOs, the exact configuration schema, eight safe diagnostic codes, fixed title/file-label types, and correlation. Native paths and implementation wire types do not leak through.              |
| **`@ide/web-core`**         | Defines configuration/scanner ports and pure evaluators. Its exhaustive diagnostic mapper converts only the eight safe codes to fixed, non-interpolated title, file label, summary, remediation, and support identifier copy. Configured authority and recognition remain independent. |
| **`@ide/browser-adapters`** | Keeps native integrations unavailable in browser mode without deliberate simulation; the web shell starts no project activation reads.                                                                                                                                                 |
| **`@ide/tauri-adapters`**   | Strictly validates configuration and scan unions, exact correlation, bounds, canonical relative paths, enums, and deterministic ordering. Native failures are sanitized; machine adapters remain separate.                                                                             |
| **`@ide/ui`**               | Supplies the controlled shell, the shared atomic diagnostic alert, and the read-only XCOM project activity. Workspace Settings hosts one complete warning; an independently preserved activity mirrors it without gaining actions or authority.                                        |

## Global Settings versus Project Contributions

| Concern                        | CURRENT/AS-BUILT                                                                                                                                                                                                                                                                                                                                                                     | Non-current boundary                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Java global tooling**        | Settings: JDK/JDT LS lifecycle/status and RefactorKit availability/version/path/capability discovery.                                                                                                                                                                                                                                                                                | Project search, navigation, refactoring, and activation actions are absent.                                                                                                                              |
| **Java editor semantics**      | The exact synchronized Monaco Java model receives diagnostics, completion, hover, signature help, and cancellation with version/request guards and stale suppression.                                                                                                                                                                                                                | Definition/references, symbols/hierarchy, code actions, formatting, rename, and broader JDT LS expansion are **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY**, not target architecture.                |
| **Java project tooling**       | No project/module detection or activation. Guarded diagnostics are projected into project-scoped Problems only while a ready Java context or retained items exist.                                                                                                                                                                                                                   | Activation-scoped Problems lifecycle, Build, Tests, Logs, Java tools, and contribution lifetime are frozen unscheduled inventory.                                                                        |
| **RefactorKit integration**    | Current only for status/capability discovery and the managed Java import transaction.                                                                                                                                                                                                                                                                                                | Production composes TypeScript/JavaScript Symbol Navigation support, but policy keeps it parked; provider foundations, experimental references/rename, and general refactoring are not IDE capabilities. |
| **XCOM machine runtime**       | Transaction authority stays correlated to the current workspace/generation, but only open XCOM machine Settings owns one monitor and one transaction adapter lifecycle. Close invalidates requests, unsubscribes both, and clears both timers; reopen owns one fresh lifecycle of each.                                                                                              | Closed machine Settings performs no XCOM monitor, history, detail, poll, or subscription work across cold start or workspace switching.                                                                  |
| **XCOM workspace diagnostic**  | **Settings > Workspace > Current workspace** shows neutral checking during explicit full refresh or one complete atomic alert selected by the exhaustive eight-code safe mapper. It grants no activity, process, tool, action, write, external-root, or mutation authority.                                                                                                          | Browser behavior is unchanged. The diagnostic is not machine Settings, a project contribution, or an authorization input.                                                                                |
| **XCOM concrete SDK setup**    | Stable native Prepare audits vanilla AppID 602410 and emits exactly 15 reversible operations. Apply needs exact-digest external approval for one transaction; Restore preserves conflicts and returns the captured baseline.                                                                                                                                                         | Remains current and separate from target project tooling and optional provisioning.                                                                                                                      |
| **XCOM optional provisioning** | No Protontricks, Steam shortcut, compatibility-prefix, package-manager, or interactive action is executable.                                                                                                                                                                                                                                                                         | Separately design and authorize any such capability; never include it implicitly in SDK Apply.                                                                                                           |
| **XCOM project activation**    | Project-owned `.ide/xcom2.json` v1 and independent Option A recognition feed one exactly correlated controller. Full Workspace Refresh synchronously clears diagnostics and authority before neutral checking; stale results restore nothing. Invalid configuration removes only configured authority, so strong Option A may preserve the activity and mirror the complete warning. | Manual confirmation, external roots, content parsing, Build, Problems, Logs, language support, actions, and bottom contributions remain FUTURE/TARGET.                                                   |

Transaction rollback storage is IDE-owned local state. Each backup is limited to 16 MiB; retention is bounded to 64 removable transactions and 256 events. Export payloads omit paths and content.

`DocumentSyncPort` is implemented by the Tauri language adapter. The application advances document versions optimistically and serializes full-text `didChange` before semantic calls. The guarded conditional Problems contribution is current. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, contextual tooling, general Java refactoring, and broader JDT LS expansion have no active schedule and remain frozen historical inventory.

Any reconsidered search integration requires a released strict typed bounded versioned machine-readable JSON contract, or equivalent daemon DTO, with structured errors, truncation, authorized locations, request/result correlation, and immutable real acceptance evidence. Human-oriented stdout is never an IDE protocol.
