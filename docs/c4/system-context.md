# System Context Diagram (C1)

> **CURRENT/AS-BUILT VIEW.** The editor is Monaco-only and bundles its Java Monarch/basic language contribution locally. Desktop JDT LS diagnostics with a conditional project-scoped Problems contribution, completion, hover, signature help, document synchronization, cancellation, and stale-result guards are operational through provider-neutral, Tauri, and Rust boundaries. This does not imply Java module activation. **Paste Java Class from Clipboard** remains a separate managed RefactorKit transaction. See the [frozen unscheduled Java inventory](target-java-intelligence.md) and mixed-boundary [XCOM 2](target-xcom2-setup.md) views.

```text
Developer ──uses──> IDE Application
                       ├── Web App ──> Web Browser
                       │    └─ core Terminal only; no Java/XCOM polling
                       └── Desktop App ──> OS File System and bounded native tools
                            ├─ directory tree: Paste Java Class action + tree-scoped Ctrl/Cmd+V
                            │    └─ exact required-method gate → managed preview/apply/discard/rollback
                            ├─ Monaco-only editor + local Java syntax highlighting
                            │    └─ synchronized Java model → completion / hover / signature help
                            ├─ left sidebar: File Explorer + Workspace Explorer
                            ├─ core Terminal + AI Agent bottom tools
                            ├─ project Problems while ready Java context or projected items exist
                            └─ Settings: global Java tooling + XCOM machine health
                               + Prepare/Apply/Restore/rollback/recovery
```

## External Systems

| System                                  | Current interaction                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Browser**                         | Runs the SPA and browser storage. The XCOM setup adapter explicitly reports unavailable unless simulation is deliberately enabled; normal composition starts no XCOM polling, subscription, or simulated native state. Local JDT LS and RefactorKit are likewise unavailable without simulation.                                                                                                                                                            |
| **OS File System**                      | Stores authorized workspaces and service data. For Java clipboard paste, the IDE performs no direct write: only the current managed RefactorKit transaction may mutate files, and tree refresh/open uses backend-returned changed/primary paths.                                                                                                                                                                                                            |
| **OS Clipboard**                        | Read once for an explicit directory-tree paste only after RefactorKit advertises the required API and exact import/apply/discard/rollback method features. Missing or incomplete required methods remain unavailable with zero clipboard reads; other normalized metadata is retained evidence rather than blanket authorization.                                                                                                                           |
| **Full Java JDK**                       | External, non-bundled tooling capability-probed through `java` and `javac`; a JRE alone is insufficient.                                                                                                                                                                                                                                                                                                                                                    |
| **Eclipse JDT LS**                      | External, non-bundled language server managed over LSP/stdio. Desktop currently consumes provider-neutral diagnostic events, projects active-editor diagnostics and project Problems, and provides completion, hover, signature help, and cancellation for the exact synchronized Java document. This does not imply project activation or any capability in the frozen unscheduled inventory.                                                              |
| **RefactorKit Engine**                  | Current only for provider status/capability discovery and the validated managed Java-import transaction. Provider version is diagnostic; the advertised API and exact import/apply/discard/rollback method features gate the import. Language-kernel, runtime-limit, and safety metadata are retained evidence rather than blanket authorization. Rust owns one canonical-workspace/generation-scoped NDJSON daemon; RefactorKit is the sole import writer. |
| **Local Steam Installation Metadata**   | Desktop-only, bounded read-only evidence for monitor and setup. Prepare validates vanilla AppID `602410` and journals build, manifest, and SDK root fingerprint without exporting paths or proprietary content.                                                                                                                                                                                                                                             |
| **Installed WOTC Game and Vanilla SDK** | External installation audited by the concrete setup flow. Only the 15 reviewed reversible operations are eligible, including one allowlisted CookedPCConsole symlink to the installed game.                                                                                                                                                                                                                                                                 |
| **External SDK Write Approval**         | Grants Apply only for an exact reviewed digest and one transaction. It does not authorize optional provisioning or future transactions.                                                                                                                                                                                                                                                                                                                     |
| **OS Programs**                         | Receive bounded one-shot direct-argv execution; no shell or persistent PTY is implied.                                                                                                                                                                                                                                                                                                                                                                      |

## Paste Java Class from Clipboard — Current Delivery Boundary

- The directory tree offers a directory-only context action and tree-scoped `Ctrl/Cmd+V`. Normal Monaco/editor paste is not intercepted, and the feature does not copy raw Java.
- The coordinator validates the selected directory, then probes RefactorKit compatibility. Clipboard text is read explicitly only when the advertised API and exact `targetDirectory` import/apply/discard/rollback method features are accepted; incomplete providers stay unavailable before clipboard access, with no force path. Provider version is not an authorization input, and normalized safety metadata is evidence rather than a blanket gate.
- Rust starts one `bin/refactorkit-daemon` NDJSON process scoped to the canonical workspace and workspace generation. It validates the required import method features, retains other normalized metadata as evidence, normalizes rich preview evidence, applies only the exact approved `planId`, discards cancelled or invalidated plans, and rolls back by transaction ID.
- Cancellation and selection/workspace invalidation invoke `refactor.discard`. Malformed output, timeout, workspace switch, or app exit kills the daemon rather than continuing with uncertain state.
- Tree refresh/open uses only backend-authoritative changed/primary paths.
- The IDE never infers a package, constructs or writes a fallback patch, or forces an incomplete provider. Clipboard source is transient, is never logged, and has no path to Pi/AI Agent.

## Corrected Current Boundary

- **Desktop left sidebar:** **File Explorer** appears above **Workspace Explorer** as independently collapsible sections. Workspace Explorer lists registered workspaces and exposes switching, refresh, loading, and errors; the duplicate header select is removed.
- **Desktop BottomPanel:** a dynamic accessible tool-window host with icon, title, `core`/`project` scope, badge/count, disabled state, and Arrow/Home/End keyboard behavior. The desktop app contributes core **Terminal** and **AI Agent**, plus project-scoped **Problems** while a ready Java context or projected problem items exist. This visibility guard is not module activation.
- **Web BottomPanel:** the same host contract, currently with core **Terminal** only.
- **No global technology tabs:** neither Java nor XCOM is a global BottomPanel technology tab; current Problems is a guarded diagnostic projection rather than a Java technology tab.
- **Global Java Settings:** owns JDK/JDT LS lifecycle/status and RefactorKit availability/version/path/capability discovery. Interactive completion, hover, and signature help live in the exact synchronized Monaco Java model rather than Settings. Settings does not expose Java workspace scan, definition/references, symbols, results, navigation, or refactoring.
- **Global XCOM Settings:** owns the desktop machine monitor, explicit refresh/subscription, a separate descriptive non-executable plan, and concrete transaction history/state/operations/full digest plus Prepare, exact approval, Apply, Restore Vanilla SDK, rollback, recovery, and Prepare Again. It does not activate a workspace or module.
- **Current concrete setup:** stable Prepare validates vanilla AppID `602410` and emits exactly 15 reversible operations: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, eleven exact DLC_3 TLE quarantines, and one allowlisted CookedPCConsole symlink to the installed game.
- **Current transaction engine:** journals Steam build/manifest/root fingerprint and preserves original bytes, hashes, modes, directory inventory, and symlink absence in content-addressed backups. Apply requires exact-digest external approval scoped to one transaction. Restore returns to the exact captured baseline; conflicts never overwrite, and rollback precedes Prepare Again.
- **Future exclusion:** Protontricks, Steam shortcut, compatibility-prefix, package-manager, and interactive work remain FUTURE/TARGET and non-executable.
- **Generic web/workspace behavior:** no hidden Java/XCOM polling or project contribution. The browser setup adapter is explicitly unavailable without deliberate simulation.
- **No plugin runtime:** the fixed first-party XCOM contracts do not constitute extension installation/removal, third-party loading, or arbitrary plugin execution.

## Current Java IntelliSense Boundary

- Monaco is the only editor. Java syntax highlighting comes from a locally bundled Monarch/basic language contribution, with no network language assets or native fallback.
- The desktop app projects provider-neutral diagnostic events into active-editor diagnostics and `ProblemItem` entries, and contributes Problems while a ready Java context or retained projected items exist.
- Completion, hover, signature help, and cancellation cross provider-neutral contracts, typed Tauri adapters, and the Rust JDT LS transport. Managed JDT LS configuration enables `java.signatureHelp.enabled=true`.
- Providers register only for Java and activate only for the exact synchronized Monaco model. Workspace ID, session generation, path, URI, optimistic document version, request ID, and cancellation ID are checked across boundaries.
- Each edit advances the model version optimistically. A serialized full-text `didChange` flush completes before any semantic request, preventing requests from overtaking synchronization.
- Cancellation, workspace/session/model changes, mismatched response metadata, and disposed providers suppress stale or late results.
- Completion maps only the primary edit. Additional edits, cross-document/workspace edits, and commands are intentionally suppressed. Rendered Markdown is untrusted and HTML is disabled.

## Java Roadmap Freeze and XCOM Target Boundary

As of 2026-07-14, Java module activation, definition/references, symbols/hierarchy, code actions, formatting, rename, contextual Java tooling, general Java refactoring, and broader JDT LS expansion are **UNSCHEDULED TODO / FROZEN HISTORICAL INVENTORY**. They are not target architecture, active milestones, or implied commitments. Current diagnostics/Problems, completion, hover, signature help, synchronization, cancellation, and stale guards remain maintained as-built.

RefactorKit is current only for status/capability discovery and the validated Java import transaction. Parked TypeScript diagnostics and semantic navigation requirements are not active capabilities. Structural outline and identifier search remain provider foundations; TypeScript references and rename remain experimental provider operations; none is an IDE capability. Any reconsidered search integration requires a released strict typed bounded versioned machine-readable contract with structured errors, truncation, authorized locations, request/result correlation, and immutable real acceptance evidence. Human stdout is never parsed as an IDE protocol.

XCOM remains independently governed by its mixed current/target boundary. No XCOM project evaluator or activation coordinator exists current. XCOM names alone are never evidence. Concrete WOTC SDK setup is current, while optional provisioning and project tooling remain target-only.
