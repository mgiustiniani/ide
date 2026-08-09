# Container Diagram (C2)

> **CURRENT/AS-BUILT VIEW.** The Desktop App supplies non-owning docked and detached Pi renderers with current generation/sequence guards, while the Rust Backend derives native caller authority and owns workspace-scoped portable PTYs. The editor is Monaco-only with a locally bundled Java language contribution. Guarded Java semantics cross typed application/Tauri/Rust boundaries without Java module activation. **Paste Java Class from Clipboard** remains a separate managed RefactorKit transaction. Desktop XCOM 2 activation evaluates native-issued facts and acknowledges opaque handles while Rust owns accepted-root authority. The matching activity can review and approve one metadata-only Default Build recipe, but no container has a recipe execution consumer. Focused native evidence covers the exact accessible missing-Steam state through the normal Desktop App/Tauri/Rust path from isolated empty directories; the broader machine Settings lifecycle evidence remains harness-only.

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
  ├─ Files activity: File Explorer above Workspace Explorer
  │    ├─ independent collapse + registry/switch/refresh/error states
  │    └─ collapsed whole sidebar retains an Expand control in the activity rail
  ├─ Agent activity: native Pi TUI + read-only accessory views
  │    ├─ current full session detail + rootless retained-session summaries
  │    └─ docked/detached xterm renderers attach without process ownership
  ├─ dynamic BottomPanel: core Terminal
  │    ├─ project Problems while ready Java context or projected items exist
  │    └─ status bar retains the bottom-panel visibility toggle
  ├─ dynamic activity rail: `XCOM 2 Project` after configured or recognized activation
  │    └─ recognition only; mirrors the complete warning only if recognition survives
  ├─ global New XCOM 2 Project dialog
  │    └─ selection API → authoritative native render → validated digest-bound plan
  ├─ Settings / Workspace / Current workspace
  │    └─ neutral refresh checking or one complete atomic configuration warning
  ├─ Settings / Java: JDK + JDT LS lifecycle/status,
  │                   RefactorKit availability/version/path
  └─ Settings / XCOM machine
       ├─ exact accessible missing-Steam monitor state through the native path
       ├─ separate dry run + Prepare/Apply/Restore/Prepare Again
       ├─ open only: one monitor + one transaction adapter lifecycle
       └─ close: invalidate, unsubscribe, and clear both poll timers

Desktop Agent screen ──strict typed Tauri boundary──> Rust Backend
  ├─ actual `main` / `pi-agent` WebView label derives one fixed view ID
  │    ├─ main → current Workspace Registry ID + canonical-root recheck
  │    └─ detached → immutable pin; post-attach access → attachment recheck
  └─ one backend-owned portable PTY process per registered workspace
       ├─ fixed `pi --session-id ide-{workspaceId}` in the canonical root
       ├─ raw input, ANSI output, paste, modified Enter, and guarded resize
       ├─ output/status use targeted `emit_to` for authorized attachments only
       ├─ current detail + rootless summaries; one-MiB transport tail
       ├─ renderer close/switch/detach changes attachments only
       └─ separately confirmed Stop Pi terminates one workspace process
            └─ Pi owns chat/history/tools/models/commands/extensions/trust/retry

Rust Backend ──managed NDJSON──> compatible RefactorKit provider
  └─ provider-version-neutral API + exact import-method gate
     normalized metadata retained as evidence, not blanket authorization
     one canonical-workspace/generation daemon
     project-content-safe preview → exact planId apply → discard
     rollback remains a backend authority; no user-facing import action

Desktop App ──provider-neutral Tauri calls──> Rust Backend ──LSP/stdio──> JDT LS
  └─ didOpen/didChange/didSave/didClose + completion/hover/signature/cancel
     workspace/session/path/URI/version/request/cancel guards drop stale work

Desktop App ──strict native evidence adapter──> Rust Backend
  ├─ begin binds fixed `.ide/xcom2.json` + bounded Option A facts to opaque handles
  ├─ trusted TypeScript applies the unchanged evaluators
  ├─ acknowledgment returns only the attempt receipt + selected opaque handles
  ├─ Rust accepts exactly the complete active-root set and revalidates identities
  └─ refresh, switch, failure, newer generation, exit, or cached restoration revokes

Desktop App ──token-free recipe inspection adapter──> Rust Backend
  ├─ exact request remains `{ workspaceId, generation, moduleRoot }`
  ├─ one positive JS-safe inspection generation is reserved per native attempt
  │    ├─ accepted authority retains it across repeated inspections
  │    └─ failed reservation is consumed; later authority advances; exhaustion refuses
  ├─ exact accepted-root match gates contained no-follow metadata reads
  │    ├─ unchanged reads return identical candidate facts
  │    └─ changed script/notice/convention facts retain generation but change the digest
  ├─ post-read workspace and exact-authority stale checks fail closed
  ├─ `.scripts/build.ps1` stays untrusted and is never executed
  ├─ accessible review renders complete escaped notice text separately from identity
  │    └─ unsafe empty/hostile/path/control/oversize notices refuse
  ├─ TypeScript owns closed review, digest custody, and volatile one-shot approval
  ├─ async consumption-decision seam revokes before fresh exact reinspection
  │    └─ no production caller; unchanged facts authorize once, all drift refuses
  └─ no process, network, write, SDK, game, prefix, Deploy, Cook, or Launch authority

Desktop App ──strict Foundry TypeScript boundary──> Rust Backend
  ├─ selection API seam and bounded provider-neutral contracts
  ├─ ephemeral source, destination-parent, and preview-operation grants
  ├─ shared in-process git2 renderer is the sole output authority
  ├─ Preview returns the complete plan body and retains native output bytes
  ├─ TypeScript consumes frontend authority before one immutable Apply call
  └─ Rust consumes native authority before destination validation
       ├─ present destination → bounded terminal refusal, no writes or residue
       └─ absent destination → re-render, stage, journal, verify, and publish
            └─ pre-commit failure → bounded cleanup status after owned-artifact checks

Rust Backend ──> authorized files, JDK, JDT LS, RefactorKit,
                 Steam evidence + installed game/SDK + rollback state
```

## Runtime Containers

| Container        | Technology                    | Responsibility                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web App**      | React + Vite SPA              | Browser editing and persistence. Native activation, build-recipe inspection, and workspace Pi PTY access stay outside normal browser composition.                                                                                                                                                                                                              |
| **Desktop App**  | React + Vite in Tauri WebView | Hosts non-owning docked and workspace-pinned detached Pi renderers, validates closed attachment/event shapes, accepts only current generation/sequence state, and gates resize on current attachment authority. It also applies trusted XCOM review policies and composes Project Foundry without taking native output authority.                              |
| **Rust Backend** | Rust + Tauri commands         | Derives Pi caller authority from actual WebView identity, rechecks registry or pin plus attachment, owns one portable PTY process per workspace, returns rootless retained summaries, and targets authorized events. It separately owns XCOM accepted-root authority, contained inspection, transaction services, and native Project Foundry output authority. |

Pi, JDK, JDT LS, RefactorKit, OS programs, and Steam metadata are external systems rather than IDE containers.

The decision seam is provider-neutral policy, not a caller, executor, or consumer. It makes authority unavailable synchronously before awaiting fresh inspection and refuses any changed bound fact, invalid/error, concurrent, or replay case. There is no watcher or polling: unseen filesystem drift is detected only when this requested decision reinspects. Refresh and context changes still revoke synchronously.

For `destination-present`, the Desktop App renders the fixed atomic conflict presentation. Separately, only the exact `failed` / `pre-commit` / `stage-write-failed` / `verified-complete` result renders the fixed **Project creation stopped safely** presentation. Both outcomes clear grant memory, complete `revokeAll`, disable selection, Preview, retry, and Create, and leave only Cancel with equivalent Escape dismissal. Every other result uses one fixed non-interpolating fallback, and no mapping discloses paths, cleanup internals, native identities, commands, or raw causes.

Every pre-commit failure requires `cleanupStatus` with the closed values `verified-complete` and `not-verified`. The Rust Backend emits the positive value only after a stage-write failure when the operation-owned stage identity and tracked topology are revalidated, tracked entries are removed, the journal identity is revalidated and removed, stage, journal, and destination are observed absent without following links, and the same revalidated selected parent is synchronized. Any unmet condition emits `not-verified`; unverified state is preserved, malformed or invalid results fail closed, and no verified-cleanup wording is authorized. A reused consumed request has no authority.

Current atomic publication is Linux-only. The C2 model claims no native chooser or WebKit/native E2E behavior, other fault point or conflict/failure/cleanup/recovery matrices, Windows support, or package, build, deploy, launch, auto-open, and product-publication capability. Local filesystem publication remains separate from XCOM module extraction and license/notice approval. Foundry remains separate from Workspace Settings, XCOM machine Settings, activation, and SDK setup.

## Workspace-native Pi Runtime Boundary

The Desktop App contributes **Agent** as a primary activity rather than a BottomPanel chat tab. Its shared screen contains the raw xterm renderer and bounded **Changes**, IDE **Activity**, **Resources**, and process **Sessions** accessories. Selecting a changed file still delegates to the established Desktop Editor Controller.

The Rust Backend derives renderer authority from the invoking WebView rather than trusting a request claim. The actual `main` label maps only to `docked:main`; the actual `pi-agent` label maps only to `detached:pi-agent`. Main commands recheck the current Workspace Registry ID and canonical root. Detached commands recheck the immutable pinned workspace and, after attach, the fixed attachment. An unrelated label or mismatched view ID is denied. Stale main detach is deliberately limited to removing its own derived attachment after a workspace switch.

The backend owns one portable PTY process per workspace, launches fixed Pi argv in the canonical registered root, and retains deterministic `ide-{workspaceId}` identity across restarts. The one-MiB tail is in-memory terminal transport continuity for reattachment, not a mirror of Pi conversation or session history. The full session snapshot belongs only to the authorized caller; the retained process list crosses the container boundary as an exact rootless summary that excludes roots, process/error details, activities, and terminal data.

Output and status are delivered through targeted `emit_to` calls only for fixed views that remain both authorized and attached. The Desktop App validates the closed event and summary DTOs, then accepts terminal state only for the current workspace, process generation, and increasing sequence. Resize is enabled only after the current attachment succeeds, advances only through accepted generation/sequence state, and is invalidated by replacement or cleanup; late geometry and error completions are suppressed.

Docked and detached WebViews remain non-owning attachments. The detached window stays pinned to the workspace that opened it; subsequent detach requests focus that binding rather than retargeting it. Closing either renderer sends no EOF or process signal. Only a separately confirmed **Stop Pi** command terminates the selected workspace process during normal application operation.

The legacy RPC chat projection is not part of desktop shell composition. Bounded package and command discovery remains read-only accessory metadata. Pi alone owns chat, history, tool calls, commands, extensions, models, trust, compaction, retry, and session behavior. Controlled tests may substitute a deterministic `pi` executable only at the internal fixed-argv launch seam; the external container relationship continues to mean the real Pi runtime.

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

Rust opens the canonical workspace and scopes one NDJSON daemon to its generation. Preview/no-write means no imported target or other project-content write before Apply; provider `project.open` may create `.refactorkit/workspace.lock`, so this is not a complete hidden-metadata byte-tree guarantee. Malformed output, timeout, workspace switch, and app exit terminate the daemon. Selection/workspace invalidation and cancellation invoke `refactor.discard`. Rollback exists behind contracts, adapters, Rust, and provider authority, but the current import UI exposes no rollback action. There is no package inference, target-package fallback, direct file-tree mutation, editor paste interception, raw Java copy, source logging, or workspace Pi Agent disclosure.

## Internal Package Boundaries

| Package                     | Role                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@ide/contracts`**        | Defines caller-authorized Pi session detail, exact rootless retained-session summaries, raw PTY events, and read-only accessories without chat, tool, model, or history DTOs. |
| **`@ide/web-core`**         | Defines the non-owning Pi attachment port for raw bytes, resize, current detail, rootless summaries, accessories, detached binding, and confirmed stop.                       |
| **`@ide/browser-adapters`** | Keeps native Pi PTY, XCOM activation, and recipe inspection outside normal browser composition without fabricating native state or success.                                   |
| **`@ide/tauri-adapters`**   | Strictly validates Pi caller snapshots, exact rootless summaries, targeted events, accessories, and detached binding, plus the separate XCOM and Foundry boundaries.          |
| **`@ide/ui`**               | Supplies the raw xterm Pi screen, current-authority generation/sequence and resize guards, read-only accessories, controlled shell, XCOM presentation, and Foundry dialog.    |

## Global Settings versus Project Contributions

| Concern                        | CURRENT/AS-BUILT                                                                                                                                                                                                                                                                        | Non-current boundary                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Java global tooling**        | Settings: JDK/JDT LS lifecycle/status and RefactorKit availability/version/path/capability discovery.                                                                                                                                                                                   | Project search, navigation, refactoring, and activation actions are absent.                                                                                                                |
| **Java editor semantics**      | The exact synchronized Monaco Java model receives diagnostics, completion, hover, signature help, and cancellation with version/request guards and stale suppression.                                                                                                                   | Definition/references, symbols/hierarchy, code actions, formatting, rename, and broader JDT LS expansion are **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY**, not target architecture.  |
| **Java project tooling**       | No project/module detection or activation. Guarded diagnostics are projected into project-scoped Problems only while a ready Java context or retained items exist.                                                                                                                      | Activation-scoped Problems lifecycle, Build, Tests, Logs, Java tools, and contribution lifetime are frozen unscheduled inventory.                                                          |
| **RefactorKit integration**    | Status/capability discovery, the managed Java import transaction, and saved-snapshot TypeScript/JavaScript diagnostics. The source-built-provider exception is capability-specific.                                                                                                     | Saved-snapshot semantic navigation is separately approved; provider foundations, experimental references/rename, and general refactoring are not authorized by either capability boundary. |
| **XCOM machine runtime**       | Transaction authority stays correlated to the current workspace/generation, but only open XCOM machine Settings owns one monitor and one transaction adapter lifecycle. Close invalidates requests, unsubscribes both, and clears both timers; reopen owns one fresh lifecycle of each. | Closed machine Settings performs no XCOM monitor, history, detail, poll, or subscription work across cold start or workspace switching.                                                    |
| **XCOM workspace diagnostic**  | **Settings > Workspace > Current workspace** shows neutral checking during explicit full refresh or one complete atomic alert selected by the exhaustive eight-code safe mapper. It grants no activity, process, tool, action, write, external-root, or mutation authority.             | Browser behavior is unchanged. The diagnostic is not machine Settings, a project contribution, or an authorization input.                                                                  |
| **XCOM concrete SDK setup**    | Stable native Prepare audits vanilla AppID 602410 and emits exactly 15 reversible operations. Apply needs exact-digest external approval for one transaction; Restore preserves conflicts and returns the captured baseline.                                                            | Remains current and separate from target project tooling and optional provisioning.                                                                                                        |
| **XCOM optional provisioning** | No Protontricks, Steam shortcut, compatibility-prefix, package-manager, or interactive action is executable.                                                                                                                                                                            | Separately design and authorize any such capability; never include it implicitly in SDK Apply.                                                                                             |
| **XCOM project activation**    | Native begin returns safe configuration/scan facts with opaque attempt and root handles. Trusted TypeScript acknowledges only the exact active handles; Rust retains accepted roots and revokes them synchronously. `.ide/xcom2.json` v1 remains unchanged.                             | Manual confirmation, external roots, content parsing, operational Build, Problems, Logs, language support, actions, and bottom contributions remain separate.                              |
| **XCOM build recipe review**   | For one accepted root, the Desktop App renders complete bounded notice text separately from identity and supports review, exact approval, and discard. Its uncalled async decision seam revokes before fresh exact inspection and authorizes unchanged metadata once.                   | Browser review and approval, production consumption callers, process/network/write authority, machine prerequisites, and Consume/Execute/Build/Deploy/Cook/Launch controls are absent.     |
| **Workspace-native Pi Agent**  | The Agent activity attaches xterm to one backend-owned PTY per registered workspace. Docked and pinned detached views do not own lifetime; accessory metadata is read-only, and only confirmed Stop Pi terminates a workspace process.                                                  | Pi conversation, history, tools, models, commands, extensions, trust, compaction, and retry remain Pi-owned rather than projected into IDE state.                                          |

Transaction rollback storage is IDE-owned local state. Each backup is limited to 16 MiB; retention is bounded to 64 removable transactions and 256 events. Export payloads omit paths and content.

`DocumentSyncPort` is implemented by the Tauri language adapter. The application advances document versions optimistically and serializes full-text `didChange` before semantic calls. The guarded conditional Problems contribution is current. Definition/references, symbols/hierarchy, code actions, formatting, rename, Java module activation, contextual tooling, general Java refactoring, and broader JDT LS expansion have no active schedule and remain frozen historical inventory.

Any reconsidered search integration requires a released strict typed bounded versioned machine-readable JSON contract, or equivalent daemon DTO, with structured errors, truncation, authorized locations, request/result correlation, and immutable real acceptance evidence. Human-oriented stdout is never an IDE protocol.
