# Current WOTC SDK Setup and FUTURE/TARGET XCOM 2 Activation

> **MIXED CURRENT/TARGET BOUNDARY.** Repeatable concrete WOTC SDK native setup is **CURRENT/AS-BUILT**. XCOM project activation, language/build contributions, Protontricks, Steam shortcut and compatibility-prefix work, package-manager actions, and interactive provisioning remain **FUTURE/TARGET** and non-executable. See [System Context](system-context.md), [Containers](containers.md), and [Components](components.md).

This roadmap is independent of the [current Java boundary and frozen unscheduled inventory](target-java-intelligence.md) and makes no IntelliJ-parity claim.

## Architectural Separation

| Responsibility                         | Scope                                    | Status and behavior                                                                                                                                               |
| -------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine runtime lifecycle              | Settings visibility + workspace identity | **CURRENT:** open Settings exclusively owns one monitor and one transaction adapter lifecycle; transaction authority remains workspace-correlated.                |
| Machine health and descriptive dry run | Desktop Settings                         | **CURRENT:** conservative monitor plus pure export-safe, non-executable dry run.                                                                                  |
| Concrete WOTC SDK transaction          | Desktop Settings + Rust backend          | **CURRENT:** stable Prepare, exact-digest one-transaction approval, Apply, Restore Vanilla SDK, rollback, recovery, and Prepare Again.                            |
| Optional provisioning                  | External Steam/prefix/package tooling    | **TARGET/NON-EXECUTABLE:** Protontricks, Steam shortcut, compatibility prefix, package-manager, and interactive work are excluded from current Prepare and Apply. |
| Project/module activation and tooling  | Opened project/module                    | **TARGET:** evidence-based or explicit activation gates contextual Problems, Build, Tests, Logs, and XCOM tools.                                                  |

A generic workspace remains generic: no XCOM scanner, activity entry, bottom tab, Problems/Build/Tests/Logs/XCOM contribution, language contribution, project/module state, or activation. With Settings closed, cold start and workspace switching perform no XCOM monitor snapshot/refresh, transaction history/detail, poll, or subscription work. Machine setup remains in Settings and does not require XCOM project activation.

## AS-BUILT Concrete Native Setup

Prepare validates a vanilla WOTC SDK installation identified by Steam AppID `602410` and produces exactly 15 reversible operations:

1. two Day0 INI removals;
2. one bounded SourceControl/GameAssetDatabase INI patch;
3. eleven exact DLC_3 TLE quarantines; and
4. one allowlisted CookedPCConsole symlink to the installed WOTC game.

No absolute installation paths or proprietary file contents belong in C4 artifacts or exported transaction records.

```text
Read-only machine evidence
  ├─ Steam build and manifest identity
  ├─ vanilla SDK root fingerprint
  └─ exact operation preconditions
                    │
                    ▼
Stable Prepare
  └─ exactly 15 reviewed, reversible operations + 64-character digest
                    │ exact match, one transaction only
                    ▼
External SDK write approval ──> Apply
                    │
                    ▼
Durable journal and content-addressed backups
  ├─ original bytes + hashes + modes
  ├─ original directory inventory
  └─ original symlink absence
```

Apply is unavailable without an external SDK write grant matching the reviewed digest exactly and scoped to that single transaction. The engine does not broaden that grant to other paths, operations, or future transactions.

**Restore Vanilla SDK** restores the captured exact baseline. Conflicts never overwrite externally changed content. Recovery or rollback must resolve the transaction before **Prepare Again** creates a fresh audit and digest. This keeps repeated prepare/apply/restore cycles explicit and reversible.

## Target Activation Decision

This entire activation path is FUTURE/TARGET: no current scanner, evaluator, project/module state, activity entry, bottom contribution, or contextual tool is created by workspace loading or machine Settings.

The future activation evaluator returns a structured decision rather than a name-based boolean:

```text
XcomActivationDecision
  ├─ state: active | inactive | needs-confirmation
  ├─ confidence: explicit | high | medium | low | none
  ├─ reasons: ordered evidence and rejection explanations
  └─ matchedModules: project/module roots to which contributions apply
```

Candidate evidence includes explicit configuration, `*.x2proj`, `*.XComMod`, `.scripts/build.ps1` together with `X2ModBuildCommon`, `Config/XComEngine.ini`, and credible `Src/<package>/Classes/*.uc` layouts. Names containing `xcom` are never evidence. Ambiguity yields inactive or needs-confirmation, not automatic activation.

Only activated modules may receive contextual Problems, Build, Tests, Logs, XCOM tools, and language contributions. Closing, removing, or invalidating a module removes them.

## Current and Future Component Boundaries

### Current Settings-owned lifecycle

Machine setup transaction authority is correlated to the current workspace and generation, but workspace authorization/loading does not own or independently start XCOM runtime work. Open Settings creates exactly one monitor-adapter lifecycle and one transaction-adapter lifecycle, each with its own subscription and poll timer. Close revokes request authority, unsubscribes both, and clears both timers; reopen creates one fresh lifecycle of each. A workspace switch restarts them only if Settings remains open.

### Current transaction engine

The native engine owns stable plan validation, allowlisted operations, durable write-ahead journals, content-addressed backups, exact approval, freshness and authorization gates, cancellation, reverse rollback, conflict reporting, and recovery. The concrete operation builder is constrained to the 15-operation vanilla SDK plan above.

IDE-owned rollback state remains bounded to 16 MiB per backup, 64 retained removable transactions, and 256 events. Exports omit paths and content.

### Future project tool bridges

Language and build adapters remain future. They require activated module roots, approved tool identities, bounded direct invocation, cancellation/timeouts, normalized diagnostics/results, and provenance. They grant no arbitrary execution.

### Future optional provisioning

Protontricks, Steam shortcut creation, compatibility-prefix setup, package-manager actions, and any interactive work are placeholders only. They are not operation types in the current plan, are not covered by SDK approval, and must not be invoked by Prepare or Apply.

### Browser boundary

The browser XCOM setup adapter reports unavailable unless deliberate simulation is enabled. Normal browser composition starts no hidden polling, transaction activity, or simulated native state.

## Target Capability Boundaries

FUTURE/TARGET capabilities remain subject to these architectural constraints:

- project activation uses bounded explicit/evidence-based decisions, fails closed on ambiguous or false-positive signals, and scopes contribution creation/removal to module lifetime;
- language/build bridges use separately approved bounded tools with cancellation, diagnostics, and provenance;
- any optional provisioning is independently designed, reviewed, and authorized rather than being smuggled into SDK Apply; and
- browser behavior remains honest unless a separately approved architecture is implemented.

The fixed first-party feature is not a general plugin runtime. Current setup approval grants no extension loading or arbitrary command authority.
