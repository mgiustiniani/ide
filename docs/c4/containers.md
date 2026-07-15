# Container Diagram (C2)

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only with a locally bundled Java Monarch/basic language contribution. Desktop JDT LS document sync, provider-neutral diagnostics with a conditional project-scoped Problems contribution, completion, hover, signature help, and cancellation cross typed, guarded application/Tauri/Rust boundaries. This does not imply Java module activation. **Paste Java Class from Clipboard** remains a separate managed RefactorKit transaction. This structural view does not establish native-GUI, live-provider, or packaged-application execution evidence.

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
  │    └─ independent collapse + registry/switch/refresh/error states
  ├─ dynamic BottomPanel: core Terminal + AI Agent
  │    └─ project Problems while ready Java context or projected items exist
  ├─ Settings / Java: JDK + JDT LS lifecycle/status,
  │                   RefactorKit availability/version/path
  └─ Settings / XCOM: machine health + separate dry run
                       + Prepare/Apply/Restore/Prepare Again

Rust Backend ──managed NDJSON──> compatible RefactorKit provider
  └─ provider-version-neutral API + exact import-method gate
     normalized metadata retained as evidence, not blanket authorization
     one canonical-workspace/generation daemon
     project-content-safe preview → exact planId apply → discard
     rollback remains a backend authority; no user-facing import action

Desktop App ──provider-neutral Tauri calls──> Rust Backend ──LSP/stdio──> JDT LS
  └─ didOpen/didChange/didSave/didClose + completion/hover/signature/cancel
     workspace/session/path/URI/version/request/cancel guards drop stale work

Rust Backend ──> authorized files, JDK, JDT LS, RefactorKit,
                 Steam evidence + installed game/SDK + rollback state
```

## Runtime Containers

| Container        | Technology                    | Current responsibility                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web App**      | React + Vite SPA              | Browser editing and persistence. Its XCOM setup adapter explicitly reports unavailable unless deliberate simulation is enabled; normal composition starts no hidden XCOM polling or simulated native state.                                                                                                                                                                                                                                         |
| **Desktop App**  | React + Vite in Tauri WebView | Hosts the Monaco-only editor and local Java syntax contribution. Its composition-only root wires seven current capability controllers, six extracted shell/document/editor controllers, and RefactorKit Symbol Navigation support behind its parked non-capability boundary. The Java and shell controllers jointly provide guarded diagnostics, Problems visibility, completion, hover, and signature help; this does not imply module activation. |
| **Rust Backend** | Rust + Tauri commands         | Exposes thin Tauri facades over modular Java Language and RefactorKit application services. Java contract/path, protocol/semantic/toolchain/support concerns and RefactorKit required-method/metadata, contract/path, and NDJSON transport concerns remain separated. It manages JDT LS and one canonical-workspace/generation-scoped RefactorKit daemon for capability discovery, Java import, discard, and provider-authoritative rollback.       |

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

| Package                     | Current role                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@ide/contracts`**        | Provider-neutral lifecycle, diagnostic events, document identity/version, completion, hover, signature-help, cancellation, RefactorKit status/import, and XCOM contracts; no JDT LS/LSP/Monaco wire types leak through.                                     |
| **`@ide/web-core`**         | Defines language/document/Java intelligence ports and coordinates bounded application flows without provider coupling. Its clipboard import coordinator probes capability before clipboard access, guards exact-plan Apply, and invalidates retained plans. |
| **`@ide/browser-adapters`** | Native JDT LS, RefactorKit, and clipboard integrations remain honestly unavailable in browser mode without deliberate simulation.                                                                                                                           |
| **`@ide/tauri-adapters`**   | Implements typed lifecycle/document sync plus Java completion/hover/signature/cancel normalization and separate RefactorKit/clipboard ports, including non-UI rollback contracts; malformed and mismatched payloads fail closed.                            |
| **`@ide/ui`**               | Supplies the Monaco-only editor, local Java language contribution, exact-model-guarded semantic providers, safe primary-edit mapping, untrusted Markdown rendering, and clipboard preview/acknowledgement/apply presentation without a rollback action.     |

## Global Settings versus Project Contributions

| Concern                        | CURRENT/AS-BUILT                                                                                                                                                                                                             | Non-current boundary                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Java global tooling**        | Settings: JDK/JDT LS lifecycle/status and RefactorKit availability/version/path/capability discovery.                                                                                                                        | Project search, navigation, refactoring, and activation actions are absent.                                                                                                                              |
| **Java editor semantics**      | The exact synchronized Monaco Java model receives diagnostics, completion, hover, signature help, and cancellation with version/request guards and stale suppression.                                                        | Definition/references, symbols/hierarchy, code actions, formatting, rename, and broader JDT LS expansion are **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY**, not target architecture.                |
| **Java project tooling**       | No project/module detection or activation. Guarded diagnostics are projected into project-scoped Problems only while a ready Java context or retained items exist.                                                           | Activation-scoped Problems lifecycle, Build, Tests, Logs, Java tools, and contribution lifetime are frozen unscheduled inventory.                                                                        |
| **RefactorKit integration**    | Current only for status/capability discovery and the managed Java import transaction.                                                                                                                                        | Production composes TypeScript/JavaScript Symbol Navigation support, but policy keeps it parked; provider foundations, experimental references/rename, and general refactoring are not IDE capabilities. |
| **XCOM concrete SDK setup**    | Stable native Prepare audits vanilla AppID 602410 and emits exactly 15 reversible operations. Apply needs exact-digest external approval for one transaction; Restore preserves conflicts and returns the captured baseline. | Remains current and separate from target project tooling and optional provisioning.                                                                                                                      |
| **XCOM optional provisioning** | No Protontricks, Steam shortcut, compatibility-prefix, package-manager, or interactive action is executable.                                                                                                                 | Separately design and authorize any such capability; never include it implicitly in SDK Apply.                                                                                                           |
| **XCOM project tooling**       | No project/module detection or activation and no workspace contribution.                                                                                                                                                     | Evidence-based or explicit XCOM activation gates contextual Problems, Build, Tests, Logs, and XCOM tools.                                                                                                |

Transaction rollback storage is IDE-owned local state. Each backup is limited to 16 MiB; retention is bounded to 64 removable transactions and 256 events. Export payloads omit paths and content.

`DocumentSyncPort` is implemented by the Tauri language adapter. The application advances document versions optimistically and serializes full-text `didChange` before semantic calls. The guarded conditional Problems contribution is current. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, contextual tooling, general Java refactoring, and broader JDT LS expansion have no active schedule and remain frozen historical inventory.

Any reconsidered search integration requires a released strict typed bounded versioned machine-readable JSON contract, or equivalent daemon DTO, with structured errors, truncation, authorized locations, request/result correlation, and immutable real acceptance evidence. Human-oriented stdout is never an IDE protocol.
