# XCOM 2 Activation, Machine Setup, and Future Project Tooling

> **MIXED CURRENT/TARGET BOUNDARY.** Project-owned configured activation, convention recognition, and repeatable WOTC SDK setup are **CURRENT/AS-BUILT**. Manual confirmation, external-root grants, contextual Build/Problems/Logs/language tooling, and optional provisioning remain **FUTURE/TARGET**. See [System Context](system-context.md), [Containers](containers.md), and [Components](components.md).

This architecture is independent of the [current Java boundary and frozen inventory](target-java-intelligence.md) and makes no IntelliJ-parity claim. It also does not change the postponed packaged-application boundary.

## Architectural Separation

| Responsibility                  | Scope                                               | Boundary                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configured activation           | Current authorized desktop workspace                | **CURRENT:** read the project-owned `.ide/xcom2.json` v1 without mutation, validate contained module roots, and grant recognition-only explicit activation. |
| Convention recognition          | Current authorized desktop workspace                | **CURRENT:** bounded read-only metadata/name scan and pure Option A evaluation. Recognition confidence remains independent from configured activation.      |
| Activation lifecycle            | Workspace switch or explicit full Workspace Refresh | **CURRENT:** synchronously revoke prior state, jointly correlate configuration and recognition, and suppress stale results without a watcher or poller.     |
| Machine runtime lifecycle       | Settings visibility + workspace correlation         | **CURRENT:** open Settings exclusively owns monitor and transaction adapter lifecycles. Machine evidence cannot activate a project.                         |
| Concrete WOTC SDK transaction   | Desktop Settings + Rust backend                     | **CURRENT:** stable Prepare, exact-digest approval, Apply, Restore Vanilla SDK, rollback, recovery, and Prepare Again.                                      |
| Confirmation and external roots | Separately authorized project scope                 | **TARGET:** manual confirmation, persistence, and external-root authority require separate contracts.                                                       |
| Contextual project tools        | Separately authorized module                        | **TARGET:** Build, Problems, Logs, language support, actions, and XCOM tools require their own activation and tool authority.                               |
| Optional provisioning           | External Steam/prefix/package tooling               | **TARGET:** Protontricks, Steam shortcut, compatibility-prefix, package-manager, and interactive work remain separate from SDK Apply.                       |

A valid configured root or an active convention decision may add **XCOM 2 Project** to the desktop activity rail. The activity remains recognition-only and never adds a bottom tab or project action. The browser starts no project activation work. Machine Settings remains independently available and cannot provide project evidence.

## Current Project-owned Configured Activation

The native side owns the authorized workspace root and the fixed path `.ide/xcom2.json`; callers cannot provide either. The project owner owns the file, and the IDE only reads it. The activation-only v1 schema has exactly these fields:

```json
{
  "version": 1,
  "target": "wotc",
  "moduleRoots": ["mods/Example"]
}
```

The reader rejects duplicate or unknown fields, unsupported values, malformed or oversized input, and unsafe roots. `moduleRoots` is a non-empty bounded array of unique normalized workspace-relative paths. Each root must resolve as an existing exact-case regular directory whose components are non-symlink directories contained within the authorized workspace. `.` is valid; absolute, drive, URI, backslash, empty, dot-segment, parent-segment, control-bearing, missing, non-directory, case-mismatched, symlinked, and escaping roots are invalid.

A valid root receives state `active`, source `configured`, and activation confidence `explicit`. Recognition confidence is independently derived from convention evidence and may remain `none`; matching convention evidence changes the source to `configured-and-recognized` without converting recognition confidence into configuration authority.

Invalid configuration grants no configured authority. The boundary returns only presentation-safe typed diagnostics and does not expose raw paths, content, parser details, or native errors. An invalid file does not suppress an independently active Option A recognition decision.

The IDE never creates, writes, reformats, or deletes `.ide/xcom2.json`, never updates `.gitignore`, and performs no Git synchronization. External edits are observed only when the user invokes the full **Workspace Refresh** control. There is no configuration watcher or polling.

## Current Activation Lifecycle

```text
Workspace switch or explicit full Workspace Refresh
  └─ synchronously revoke prior project activation
                    │
                    ├─> read fixed `.ide/xcom2.json` through strict adapter
                    └─> scan bounded convention metadata through strict adapter
                                      │
                                      ▼
                       independent pure evaluators
                         ├─ configured intent
                         └─ Option A recognition
                                      │
                                      ▼
                        jointly correlated snapshot
                                      │
                                      ▼
                    accessible `XCOM 2 Project` activity
```

Configuration correlation includes workspace identity, workspace generation, activation generation, and configuration-read identity. Recognition retains workspace and scan identity/generation. The controller publishes only when all fields match current authority. A switch or full refresh invalidates older work before filesystem I/O, so late configuration or scan results cannot recreate stale activity.

The activity shows module roots, state, activation source, activation confidence, separate recognition confidence, ordered reasons, scan limitations, and safe configuration diagnostics. It grants no Build, Problems, Logs, language support, action, process execution, external-root authority, or bottom contribution.

## Current Convention Recognition

The convention scanner is dedicated to recognition and does not consume or extend FileTree DTOs. It reads only bounded entry metadata and exact case-sensitive names under the authorized workspace, does not parse module content, does not follow symlinks, and does not accept external roots.

The pure evaluator groups exact evidence by inferred module root, preserves independent nested roots, and emits deterministic ordered reasons. One evidence kind remains ambiguous; distinct corroborating kinds activate recognition. Scan limitations remain visible, and unreadable or unvisited locations never become evidence of absence. A directory, repository, workspace, or filename containing `xcom` is not evidence by itself.

Configured activation and convention recognition remain independent inputs. Removing or invalidating configuration revokes only its configured basis after explicit full Workspace Refresh; any independently active recognition result remains governed by Option A.

## Current Machine Settings and SDK Transaction

Machine setup is not an activation input. Open Settings owns its monitor and transaction adapter lifecycles; closed Settings performs no monitor/history/detail reads, polling, or subscriptions. Workspace authorization and project activation do not start or extend those lifecycles. Passive Settings refresh remains distinct from the explicit full Workspace Refresh operation.

Prepare validates a vanilla WOTC SDK installation identified by Steam AppID `602410` and produces a stable allowlisted set of reversible operations:

1. Day0 INI removals;
2. a bounded SourceControl/GameAssetDatabase INI patch;
3. exact DLC_3 TLE quarantines; and
4. an allowlisted CookedPCConsole symlink to the installed WOTC game.

No absolute installation paths or proprietary file contents belong in C4 artifacts or exported transaction records.

```text
Read-only machine evidence
  ├─ Steam build and manifest identity
  ├─ vanilla SDK root fingerprint
  └─ exact operation preconditions
                    │
                    ▼
Stable Prepare ──reviewed digest──> External SDK write approval
                    │ exact match; one transaction only
                    ▼
Apply ──> durable journal and content-addressed backups
          ├─ original bytes + hashes + modes
          ├─ original directory inventory
          └─ original symlink absence
```

Apply is unavailable without an external SDK write grant matching the reviewed digest and scoped to that transaction. **Restore Vanilla SDK** restores the captured baseline. Conflicts never overwrite externally changed content, and recovery or rollback resolves a transaction before **Prepare Again** creates a fresh audit.

## Future Activation Extensions and Project Tools

The current activation-only contract does not implement:

- manual confirmation or confirmation persistence;
- external-root grants or recognition;
- user, machine, SDK, game, Proton, dependency, or build defaults in activation v1;
- content parsing or proprietary compatibility checks;
- Build, Problems, Logs, language support, project actions, or bottom contributions; or
- a generic plugin runtime or arbitrary execution authority.

Future confirmation and external-root grants must preserve current correlation, safe diagnostics, synchronous revocation, and project-contained authority. Contextual tools require separate bounded adapters, approved tool identities, cancellation/timeouts, normalized results, and provenance.

Optional Steam shortcut, compatibility-prefix, package-manager, Protontricks, and interactive provisioning work remains independently designed and authorized. It must not be included implicitly in project activation, Prepare, or Apply.

## Browser Boundary

Browser behavior is unchanged. The browser XCOM setup adapter reports unavailable unless deliberate simulation is enabled. Normal browser composition starts no machine polling, transaction activity, simulated native state, configuration read, convention scan, or project activation lifecycle.
