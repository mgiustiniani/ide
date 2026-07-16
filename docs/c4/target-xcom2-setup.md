# XCOM 2 Recognition, Machine Setup, and Future Project Tooling

> **MIXED CURRENT/TARGET BOUNDARY.** Workspace-local recognition and repeatable WOTC SDK setup are **CURRENT/AS-BUILT**. Explicit configuration, manual confirmation, external-root grants, contextual Build/Problems/Logs/language tooling, and optional provisioning remain **FUTURE/TARGET**. See [System Context](system-context.md), [Containers](containers.md), and [Components](components.md).

This architecture is independent of the [current Java boundary and frozen inventory](target-java-intelligence.md) and makes no IntelliJ-parity claim.

## Architectural Separation

| Responsibility                         | Scope                                              | Boundary                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace recognition                  | Current authorized desktop workspace               | **CURRENT:** one read-only metadata/name scan per workspace generation, pure evidence evaluation, and an accessible recognition-only activity. |
| Machine runtime lifecycle              | Settings visibility + workspace correlation        | **CURRENT:** open Settings exclusively owns monitor and transaction adapter lifecycles. Machine evidence cannot activate project recognition.  |
| Concrete WOTC SDK transaction          | Desktop Settings + Rust backend                    | **CURRENT:** stable Prepare, exact-digest approval, Apply, Restore Vanilla SDK, rollback, recovery, and Prepare Again.                         |
| Configured activation and confirmation | Project configuration and separately granted roots | **TARGET:** explicit configuration, persistence, manual confirmation, and external-root authority are outside recognition-only scope.          |
| Contextual project tools               | Separately authorized module                       | **TARGET:** Build, Problems, Logs, language support, actions, and XCOM tools require their own activation and tool authority.                  |
| Optional provisioning                  | External Steam/prefix/package tooling              | **TARGET:** Protontricks, Steam shortcut, compatibility-prefix, package-manager, and interactive work remain separate from SDK Apply.          |

A generic or one-kind workspace receives no XCOM project contribution. An active recognition decision adds only **XCOM 2 Project** to the desktop activity rail; it never adds a bottom tab or project action. The browser starts no project scan. Machine Settings remains independently available and cannot provide project evidence.

## Current Workspace Recognition

```text
Authorized workspace generation
  └─ XCOM Module Recognition Controller
       ├─ synchronously revoke the old recognition snapshot
       └─ issue one correlated request; never poll
                    │
                    ▼
XCOM Module Scanner Tauri Adapter
  ├─ exact DTO, enum, limits, and array validation
  ├─ exact workspace + scan correlation
  └─ canonical workspace-relative paths and deterministic ordering
                    │ strict invoke
                    ▼
Rust XCOM Module Filesystem Evidence Scanner
  ├─ current authorized root only
  ├─ bounded traversal of regular, non-symlink entries
  ├─ metadata and exact case-sensitive names only
  └─ no content parsing, writes, symlink following, or external roots
                    │ immutable observations + completeness/issues
                    ▼
Pure XCOM Module Recognition Evaluator
  └─ independently group each canonical module root
       ├─ no kind → inactive
       ├─ one distinct kind → needs-confirmation, no contribution
       └─ at least two distinct kinds → active recognition
                    │ exact current correlation only
                    ▼
Accessible `XCOM 2 Project` activity
  └─ roots + state + confidence + ordered evidence + completeness/issues
```

The scanner is dedicated to recognition and does not consume or extend FileTree DTOs. It recognizes exact regular-file or regular-directory conventions for `*.x2proj`, `*.XComMod`, the `.scripts/build.ps1` and `.scripts/X2ModBuildCommon` pair, `Config/XComEngine.ini`, and `Src/<package>/Classes/*.uc`. A directory, repository, workspace, or filename containing `xcom` is not evidence by itself.

The evaluator performs no platform access. It counts distinct evidence kinds at each exact inferred module root rather than matching files, preserves independent nested roots, and emits deterministic ordered reasons. Scan limitations remain visible; unvisited or unreadable regions never become evidence of absence.

The controller accepts a scanner or evaluator result only while workspace ID, workspace generation, scan ID, and scan generation all match the active request. A workspace transition clears the activity synchronously before native root activation. Late results, including results from overlapping switches, cannot recreate stale recognition. A failed transition may restore only the prior workspace's correlated snapshot.

The recognition panel is read-only. It displays recognized roots, state, confidence, ordered evidence, completeness, and scan issues. It has no Build, Problems, Logs, language support, actions, or bottom contribution.

## Current Machine Settings and SDK Transaction

Machine setup is not a recognition input. Open Settings owns its monitor and transaction adapter lifecycles; closed Settings performs no monitor/history/detail reads, polling, or subscriptions. Workspace authorization and recognition do not start or extend those lifecycles.

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

## Future Recognition Extensions and Project Tools

The current recognition-only path does not implement:

- `.ide/xcom2.json` or another explicit project configuration;
- manual confirmation or confirmation persistence;
- separately granted external roots;
- content parsing or proprietary compatibility checks;
- Build, Problems, Logs, language support, project actions, or bottom contributions; or
- a generic plugin runtime or arbitrary execution authority.

Future configured activation or confirmation must preserve current root authority, exact correlation, deterministic evidence, and synchronous deactivation. External roots require an explicit grant model rather than reusing SDK write approval. Contextual tools require separate bounded adapters, approved tool identities, cancellation/timeouts, normalized results, and provenance.

Optional Steam shortcut, compatibility-prefix, package-manager, Protontricks, and interactive provisioning work remains independently designed and authorized. It must not be included implicitly in project recognition, Prepare, or Apply.

## Browser Boundary

The browser XCOM setup adapter reports unavailable unless deliberate simulation is enabled. Normal browser composition starts no machine polling, transaction activity, simulated native state, or project recognition scan.
