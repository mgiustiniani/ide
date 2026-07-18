# XCOM 2 WOTC Modding Plugin — Product and Software Requirements

**Evidence status:** **IMPLEMENTATION-INFORMED — late-reconciled through `2ecbb29` on 2026-07-17.** ARC42 remains the mutable integrated status ledger; this specialist catalogue separates current machine Settings and activation-only project recognition/diagnostics from future project tooling. `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` is now `@implemented-and-validated` under its bounded native evidence and authority limits.

**Status:** Partially implemented; Settings-owned monitor/transaction runtime, concrete repeatable WOTC SDK transaction, convention recognition, and project-owned activation-only configuration v1 AS-BUILT; external interactive setup and contextual project tooling FUTURE/TARGET

**Implemented increment:** `REQ-XCOM2-MACHINE-SETTINGS-001` (`@implemented-not-e2e-validated`) plus `REQ-XCOM2-MODULE-ACTIVATION-001`, `REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001`, and `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` (`@implemented-and-validated`): first-party Steam monitor; separate non-executable dry run; concrete 15-operation Prepare/Apply/Restore Vanilla SDK transaction; exact-digest one-transaction approval; Settings transaction controls; bounded convention recognition; read-only configured activation from project-owned `.ide/xcom2.json` v1; and safe explicit-refresh diagnostics with independent Option A survival. No live Apply, manual confirmation/persistence, external-root recognition, Build, Problems, Logs, or language capability
**Target runtime:** Tauri desktop on Linux first; honest degraded web mode  
**Primary goal:** replace Visual Studio Code—not Unreal Editor—as the daily development environment for XCOM 2: War of the Chosen mods.

## 1. Purpose

The IDE shall provide a first-party XCOM 2 WOTC development capability that covers the workflow currently delegated to VS Code in the Linux modmaking guide:

- recognize and configure an XCOM 2 mod workspace;
- edit UnrealScript, INI, localization, PowerShell, XML and JSON project files;
- understand local mod sources, SDK sources and optional dependency sources;
- build, clean, debug-build and cook through X2ModBuildCommon;
- map compiler output to editor diagnostics and navigable source locations;
- integrate Community Highlander at compile time and runtime without silently modifying the SDK;
- launch the SDK editor and game through the configured Steam/Proton environment;
- inspect logs and redscreens during testing.

The plugin is not intended to reimplement the Unreal Editor, ModBuddy visual designers, Steam Workshop, Protontricks or the Alternate Mod Uploader in the MVP.

## 2. Source basis and traceability

| Source                                                            | Knowledge used by this specification                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[[sources/SRC-2026-07-11-013]]`                                  | WOTC SDK selection, `full_content`, required SDK fixes, source-control settings, EMPT and X2MBC recommendations.                                                       |
| `[[sources/SRC-2026-07-11-014]]`                                  | Linux architecture using Proton, VS Code replacement of ModBuddy, copied Proton prefix, X2MBC task adaptation, `CookedPCConsole`, editor launch and log/tool workflow. |
| `[[sources/SRC-2026-07-11-015]]`                                  | Building against another mod, script-package order, `ModEditPackages`, dependency source inclusion and hard-requirement risks.                                         |
| `[[sources/SRC-2026-07-11-016]]`                                  | When compiling against Highlander is required, traditional SDK source replacement and runtime hard-dependency semantics.                                               |
| `[[sources/SRC-2026-07-11-012]]`                                  | Official Highlander hook categories, typed event contracts, `XComLWTuple`, generated listeners and compile-test documentation.                                         |
| `[[analyses/xcom-2-wotc-sdk-on-linux-with-community-highlander]]` | Recommended Linux installation order and safer project-local Highlander integration.                                                                                   |

### 2.1 Implementation status and traceability (late-reconciled 2026-07-16)

Status labels in this specification are normative: **AS-BUILT** means implemented now; **PARTIAL** means only the explicitly listed slice exists; **FUTURE/TARGET** is not an implementation claim.

| Requirement area                                         | Status                                          | Current evidence / remaining boundary                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-X2ARCH-006 feature descriptor                         | **AS-BUILT**                                    | Fixed `ide.xcom2-wotc`; built-in, experimental, first-party, and plugin-shaped. No generic plugin runtime, extension install/remove lifecycle, third-party loading, or arbitrary plugin execution exists.                                                                                                                |
| FR-X2ENV-001 / 004 Steam health and gate                 | **PARTIAL / AS-BUILT Settings monitor**         | Desktop Settings reads only bounded allowlisted manifests for AppIDs `268500`, `602410`, and optional `299990`; derives conservative progress/staging/install/completeness/stability/blockers; exports redacted provenance. Broader tool/readiness checks remain target work.                                            |
| FR-X2ENV-005–012 setup workflow                          | **PARTIAL / concrete SDK transaction AS-BUILT** | Dry run remains separate/non-executable. Prepare audits vanilla SDK AppID `602410` and produces the fixed 15 reversible operations; exact-digest Apply approval, exact-baseline Restore Vanilla SDK, conflicts, recovery, and Prepare Again exist. External interactive steps remain FUTURE/TARGET.                      |
| FR-X2UI-000 / FR-X2ARCH-007 machine runtime boundary     | **AS-BUILT Settings lifecycle**                 | Closed Settings performs no monitor/history/detail/poll/subscription work. Open Settings owns one monitor and one transaction adapter lifecycle under workspace/generation authority; close invalidates and cancels both. `REQ-XCOM2-MACHINE-SETTINGS-001` is harness-only.                                              |
| FR-X2UI-000 / AT-X2-028 native missing-Steam UI          | **APPROVED FUTURE/TARGET**                      | `REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001` remains `@not-implemented` pending promotion. ADR 0007 approves only the bounded native UI acceptance target; its declaration and test support do not make it current or change aggregate/current evidence.                                                               |
| FR-X2CFG-001 / 003 activation v1                         | **AS-BUILT**                                    | `REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001` reads only project-owned `.ide/xcom2.json` v1 through a strict native boundary. Valid configuration contributes configured/explicit activation independently from convention recognition confidence; invalid configuration fails safely without suppressing Option A.    |
| FR-X2CFG-001 safe diagnostic UX / AT-X2-027              | **AS-BUILT**                                    | `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` is `@implemented-and-validated`. One atomic Settings > Workspace warning and neutral explicit-refresh checking use the exhaustive eight-code safe mapping; invalid configuration grants no activity, while strong Option A can survive and mirror the complete warning. |
| FR-X2UI-001 / 002 project contributions                  | **PARTIAL / recognition AS-BUILT**              | Convention and configured activation may contribute the accessible recognition-only `XCOM 2 Project` activity. Explicit full Workspace Refresh is the only configuration reread; it revokes synchronously and suppresses stale results. Bottom tabs, actions, language, Build, Problems, and Logs remain FUTURE/TARGET.  |
| FR-X2UI-005 browser boundary                             | **AS-BUILT unavailable and unchanged**          | Browser setup reports unavailable without simulation and starts no XCOM configuration reader, scanner, polling, transaction, or subscription work.                                                                                                                                                                       |
| FR-X2ARCH-004 external-root authorization                | **PARTIAL / narrow transaction grant AS-BUILT** | The full digest grants one reviewed external-SDK transaction only. No general reusable external-root grant exists; Proton/prefix/package-manager/interactive read/write/execute authorization remains FUTURE/TARGET.                                                                                                     |
| `FR-X2LANG-*`, `FR-X2BUILD-*`, `FR-X2HL-*`, `FR-X2RUN-*` | **FUTURE/TARGET**                               | No XCOM-specific language, build/cook, Highlander, launch, or log workflow is implemented by this increment.                                                                                                                                                                                                             |
| Java/JDT LS/RefactorKit/IntelliJ roadmap                 | **Separate and unchanged**                      | XCOM work neither replaces nor changes the IDE's core Java capability roadmap.                                                                                                                                                                                                                                           |

Architecture traceability: [ADR 0007](../ADR.md#adr-0007--machine-settings-and-evidence-activated-xcom-project-contributions), [ADR 0009](../ADR.md#adr-0009--durable-digest-approved-xcom-setup-transactions), [ARC42 current/target boundary](../ARC42.md#54-current-and-target-xcom-2-boundary), [C1](c4/system-context.md), [C2](c4/containers.md), [C3](c4/components.md), and [XCOM 2 target C4](c4/target-xcom2-setup.md).

### 2.2 Time-specific validation evidence

An intentionally ignored native test, `live_steam_snapshot_probe`, performs a read-only live integration probe and must be run explicitly on a suitably configured machine. One validation run observed game download/staging at **13.63%/14.58%**, WOTC SDK at **51.46%/50.68%**, optional vanilla SDK installed, aggregate state `staging`, and both plan/apply flags false. A later two-sample, five-second probe reported `materialChanged=false` and `canApplySetup=false`.

Synthetic fixtures prove repeated apply→rollback cycles restore exact original `FileState` and SHA-256 values for atomic patch, quarantine, generated file, generated directory, and symlink operations. They also prove reverse rollback order, restart recovery, conflict refusal, and conflict-safe retry. At implementation baseline `2ecbb29`, the full Vitest suite passed 1160/1160 tests with V8 coverage of 86.61% statements/lines, 82.96% branches, and 87.22% functions. The Spec suite reports 157 cases, and Rust defaults report 204 passed plus 8 ignored. The deterministic desktop-harness route passed 2 scenarios/49 steps. The focused configuration-diagnostic route passed 1 scenario/52 reported steps, and the native aggregate reports 6 scenarios/176 reported steps. A live ignored Prepare audit produced exactly 15 operations, executable, with no blockers. Live Apply, package/bundle/installer behavior, and machine-correctness evidence from any project Story remain unproven.

```bash
cd apps/desktop/src-tauri
cargo test --locked live_steam_snapshot_probe -- --ignored --nocapture
```

### 2.3 Current executable requirement boundary

`REQ-XCOM2-MACHINE-SETTINGS-001` is declared `@implemented-not-e2e-validated`. Its deterministic 27/27-step evidence drives the production desktop `App`, production controllers, and typed Tauri monitor/transaction adapters over a fake in-process command backend and fake clock:

- Settings closed through cold start and a generic-workspace switch performs zero snapshot/refresh, transaction history/detail, event-poll, or subscription work;
- opening or reopening owns exactly one monitor lifecycle and one transaction lifecycle, each with only its corresponding subscription and poll timer, and performs exactly one fresh snapshot plus one history load;
- one manual refresh performs exactly one monitor refresh and one additional history load without adding a lifecycle, timer, or subscription;
- close synchronously revokes request authority, unsubscribes both adapters, and clears their timers, so five further configured poll intervals change no native-call transcript; and
- open workspace switching, failed restoration, late events, and stale async responses remain workspace/generation/lifecycle guarded.

Machine setup transaction authority remains correlated to the current workspace/generation, but workspace authorization/loading does not own or start this runtime. Settings creates no project evidence, activity entry, bottom tab, or contextual contribution. Separate `REQ-XCOM2-MODULE-ACTIVATION-001` is current and native-validated only for recognition; Settings evidence cannot activate it. The Settings evidence makes no native Tauri GUI, real IPC, live Steam, real filesystem, package, bundle, or installer claim.

### 2.4 Current recognition-only executable boundary

`REQ-XCOM2-MODULE-ACTIVATION-001` is declared `@implemented-and-validated` for ADR 0007 Option A only:

- one generation-correlated controller request crosses the strict Tauri adapter into a dedicated read-only Rust metadata/name scanner over exactly the current authorized Linux workspace;
- exact-case regular entries may count, while symlinks are neither traversed nor evidence; `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`, and `.vite` are excluded;
- fixed depth 8 and 20,000 encountered-entry limits produce explicit partial completeness/issues rather than an unbounded scan;
- the five ordered kinds are `x2proj`, `xcommod`, `x2mbc-script-pair`, `engine-config`, and `unrealscript-layout`; a pure evaluator requires two distinct kinds under one inferred module root;
- workspace, directory, and file names alone, duplicate evidence of one kind, and one-kind workspaces never contribute UI;
- an active result contributes only the keyboard-accessible **XCOM 2 Project** recognition activity and panel; a committed switch removes them synchronously, and workspace/scan generation correlation suppresses stale restoration; and
- machine Settings monitoring, Steam/game/SDK state, completed setup, and transaction state are independent and cannot activate recognition.

On 2026-07-16 against promotion baseline `903cb1a`, the focused native route passed 1 scenario/26 reported steps (25 authored plus cleanup) against an actual scenario-owned sandbox filesystem and the production Linux X11 release/no-bundle Tauri WebKit DOM at 1440×900. This does not prove a package, Wayland or another OS/DPI, proprietary project compatibility, content parsing, external roots, explicit configuration, manual confirmation/persistence, machine correctness, Build, Problems, Logs, language support, project actions, or bottom contributions.

### 2.5 Current configured-activation executable boundary

`REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001` is declared `@implemented-and-validated` for activation-only `.ide/xcom2.json` v1:

- the native side owns the fixed project configuration path and reads at most 64 KiB of strict UTF-8 JSON with exactly `version`, `target`, and `moduleRoots`; duplicate keys, invalid UTF-8, trailing data, unsupported values, and missing or extra fields fail closed;
- `version` is numeric `1`, `target` is `wotc`, and 1–64 unique module roots are normalized exact-case workspace-relative existing directories (or `.`) whose components and canonical result are regular, non-symlink, and contained in the authorized workspace;
- the IDE treats the file as project-owned and read-only: it never creates, writes, reformats, deletes, or adds it to `.gitignore`, and it starts no watcher or poll;
- valid configuration contributes source `configured` and activation confidence `explicit`; convention recognition confidence remains a separate field, so configured-only activation may have recognition confidence `none`;
- invalid configuration exposes only safe typed diagnostics, grants no configured authority, and does not suppress an independent Option A recognition result;
- only explicit full **Workspace Refresh** rereads configuration, synchronously revokes prior activation authority, jointly correlates configuration and scan results, and suppresses stale completions; workspace switching uses the same synchronous revoke/stale-result discipline; and
- activation grants no external-root, process, mutation, Build, Problems, Logs, language, action, or bottom-contribution authority. Manual weak-evidence confirmation and a persistence record remain future work, as do external roots and contextual tooling. Machine Settings is independent; browser behavior is unchanged.

On 2026-07-17 at `34d5a5e`, the focused native route passed 1 scenario/37 reported steps against a freshly built production Linux X11 release/no-bundle Tauri WebKit DOM at 1440×900 and a scenario-owned sandbox filesystem. The configured fixture was exactly 63 UTF-8 bytes with SHA-256 `53d92f8cd91d90f49a98a133b5de3ef3862b5472805248780d561e2c9b765dfb`. The Story observed configured/explicit activation with recognition confidence `none`, no watcher effect before refresh, synchronous revoke and stale suppression after external removal plus refresh, exact restoration after external replacement plus refresh, unchanged final file bytes, and no XCOM tooling authority. This is direct evidence for that fixture and environment only—not package, Git synchronization, watcher, proprietary content, external roots, Wayland/other OS/DPI, or machine/tool correctness.

### 2.6 Current invalid-configuration diagnostic UX

`REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` is declared `@implemented-and-validated`. Its [native Story](../features/xcom2/module-configuration-diagnostics.feature) passed 1 scenario/52 reported steps against exact clean validation baseline `515122c`; promotion and implemented-route reconciliation completed at `2ecbb29`. The route used one scenario-owned sandbox filesystem and a freshly built production Linux X11 Tauri release/no-bundle WebKit DOM at an asserted 1440×900 viewport. The implemented aggregate is two web scenarios, two deterministic desktop-harness scenarios/49 steps, and six native GUI scenarios/176 reported steps.

The current exact wording is:

- **Canonical presentation:** Place the warning in **Settings > Workspace > Current workspace**, immediately below that section's heading/Workspace Refresh control. Present one amber, non-color-only, atomic accessible `role="alert"` whose title is exactly **XCOM 2 project configuration needs attention**. The primary content is the human summary and remediation, always using the fixed project-file label `.ide/xcom2.json`; the exact stable typed code remains visible only as a secondary support identifier.
- **Exhaustive safe copy:** The eight stop codes map to exactly this user-facing copy:

  | Stable typed code                    | Summary                                                                      | Remediation                                                                                                                                       |
  | ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `configuration-unreadable`           | The IDE could not safely read the XCOM 2 project configuration.              | Make `.ide` a regular directory and `.ide/xcom2.json` a readable regular file, with neither entry a symbolic link, then refresh the workspace.    |
  | `configuration-too-large`            | The XCOM 2 project configuration exceeds the 64 KiB limit.                   | Reduce `.ide/xcom2.json` to 64 KiB or less, then refresh the workspace.                                                                           |
  | `configuration-invalid-utf8`         | The XCOM 2 project configuration is not valid UTF-8.                         | Save `.ide/xcom2.json` as UTF-8, then refresh the workspace.                                                                                      |
  | `configuration-invalid-json`         | The XCOM 2 project configuration is not valid JSON.                          | Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.                                                |
  | `configuration-invalid-schema`       | The XCOM 2 project configuration does not match the activation v1 structure. | Use exactly these fields once: numeric `version`, text `target`, and the `moduleRoots` list; remove all other fields, then refresh the workspace. |
  | `configuration-unsupported-version`  | This XCOM 2 project configuration version is not supported.                  | Set `version` to 1, then refresh the workspace.                                                                                                   |
  | `configuration-unsupported-target`   | This XCOM 2 project target is not supported.                                 | Set `target` to `"wotc"`, then refresh the workspace.                                                                                             |
  | `configuration-invalid-module-roots` | The configured module roots are not valid for this workspace.                | Provide 1–64 unique, exact-case workspace-relative paths to existing directories, with no symbolic links, then refresh the workspace.             |

- **No implied authority or mutation:** The diagnostic alone creates no XCOM activity, bottom contribution, badge implying activation, tool, or action. It offers no edit, open, or write action. The IDE does not create, write, reformat, or delete `.ide/xcom2.json` or Option A evidence.
- **Explicit-refresh lifecycle:** Only explicit **Workspace Refresh** reevaluates this state; there is no configuration or evidence watcher/poll. Refresh synchronously revokes the old diagnostic and configured decision, displays a neutral **Checking XCOM 2 project configuration…** state, and accepts only the exactly correlated current result. Late or stale results restore neither old diagnostics nor old configured decisions.
- **Result handling:** A valid correlated result clears the warning and may activate configured recognition. An invalid correlated result removes all configured authority. Strong existing Option A recognition (`recognized` / `high`) remains active independently and, when its activity exists, mirrors the same complete safe warning using the atomic accessible presentation rather than a raw-code-only alert. An absent result is silent.
- **Failure and disclosure boundary:** Transport, adapter, or controller errors remain generic failures and must never be forged into one of the eight stop codes. Never render or retain configuration bytes or content canaries, submitted roots, actual absolute paths, parser/provider/native-command details, secrets, raw causes, or other internals.
- **Scoped write boundary:** The Story's no-write assertion covers `.ide/xcom2.json` and the two exact Option A descriptor inputs. Normal application-owned `.ide/workspace.json` marker/registry metadata updates are explicitly excluded and are not XCOM configuration or evidence writes.
- **Native evidence boundary:** Evidence is limited to the declared sandbox and Linux X11 release/no-bundle WebKit target. It makes no browser, package/bundle/installer, Git synchronization, watcher, proprietary compatibility/content parsing, external-root, machine-correctness, broader process/mutation, contextual XCOM tool, Wayland, other-operating-system, or other-DPI claim.

### 2.7 Approved FUTURE/TARGET native missing-Steam Machine Settings acceptance

`REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001` remains declared `@not-implemented` at repository baseline `aaa634e`. Its [native Story](../features/xcom2/machine-settings-missing-steam.feature) traces `FR-X2UI-000`, `FR-X2ARCH-007`, and `AT-X2-028` to the separate UI-only target approved by [ADR 0007](../ADR.md#adr-0007--machine-settings-and-evidence-activated-xcom-project-contributions) at `9151411`. The declaration, route scaffolding, and test support are pending promotion: they are not current implementation, validation, aggregate-routing, or package evidence and do not broaden or reclassify the harness-only `REQ-XCOM2-MACHINE-SETTINGS-001`.

The approved target is bounded as follows:

- start one freshly built production Linux X11 release/no-bundle executable only after isolating distinct empty scenario-owned `HOME`, XDG, `IDE_HOME`, and authorized generic-workspace locations;
- navigate through the visible **Settings** control and **Settings > XCOM 2** tab in the unmodified application, using its real Tauri/Rust path, and observe only the rendered accessible WebKit UI at the asserted 1440×900 viewport;
- present the accessible **Settings** dialog, **XCOM 2 WOTC Setup** heading, **Built-in · Experimental** badge, focusable **XCOM 2 setup monitor details** region, presentation-safe missing-products note, aggregate **Not Found** state, redacted/unknown discovery details, and exactly three **Not Found** product cards for AppIDs `268500`, `602410`, and optional `299990`;
- attribute aggregate blocker evidence to each missing required product, **XCOM 2** and **XCOM 2: War of the Chosen Development Tools**, while the missing optional **XCOM 2 Development Tools** contributes no aggregate blocker; and
- use no IPC interception, monkeypatching, hook, instrumentation, payload/transcript or call-count assertion, fake timer, polling/subscription/lifecycle assertion, refresh/reopen flow, **Plan Setup** or `canPlan` assertion, transaction surface, project activity or tool, post-launch filesystem identity assertion, filesystem mutation, live Steam dependency, package/bundle/installer claim, Wayland/other-operating-system/other-DPI claim, or machine-correctness claim.

## 3. Existing IDE constraints

The implementation shall conform to the architecture documented by `ARC42.md` and `ADR.md`:

1. shared contracts in `packages/contracts`;
2. orchestration ports and view models in `packages/web-core`;
3. platform-neutral React components in `packages/ui`;
4. Tauri TypeScript adapters in `packages/tauri-adapters`;
5. browser adapters that report unavailable native capabilities honestly;
6. native process, external-path authorization and lifecycle logic in `apps/desktop/src-tauri`;
7. no Tauri imports in contracts, web-core or UI;
8. no raw shell strings for privileged build and launch operations;
9. workspace generation IDs shall reject stale results after workspace switching.

### 3.1 Plugin model boundary

The IDE does not currently expose a general third-party extension runtime. Therefore:

- the current module is the fixed **first-party feature** `ide.xcom2-wotc`, built-in, experimental, and behind stable provider-neutral ports;
- it does not load arbitrary executable plugin code or third-party contributions;
- contracts are plugin-shaped so first-party contributions remain explicit; no extension install/remove lifecycle exists yet;
- extraction into a generic plugin runtime requires a separate ADR covering manifests, API versioning, permissions, provenance, signing and sandboxing;
- the separate external-root read/write/execute grant model is also deferred; bounded read-only Steam discovery must not be treated as a general grant.

## 4. Users and primary scenarios

### 4.1 Personas

- **Linux mod developer:** edits and builds WOTC mods without ModBuddy.
- **UnrealScript developer:** needs navigation, diagnostics, completion and dependency awareness.
- **Content modder:** edits configuration/localization and cooks assets through X2MBC while using Unreal Editor externally.
- **Highlander integrator:** consumes Highlander-only classes, functions, events and config hooks safely.
- **Maintainer:** needs reproducible project configuration and version-pinned dependencies.

### 4.2 Critical user journeys

1. Open an existing EMPT/X2MBC project and receive a deterministic environment health report.
2. Open a `.uc` file, navigate SDK/Highlander symbols and receive diagnostics/completion.
3. Run Build or Debug Build, inspect streaming output and click a compiler error to open its exact location.
4. Add or validate Community Highlander as a pinned project dependency without overwriting global SDK sources.
5. Launch Unreal Editor, then launch a minimal game test and inspect `Launch.log`/redscreens.

## 5. Definitions

- **SDK root:** directory ending in `XCOM 2 War of the Chosen SDK`.
- **Game root:** directory ending in `XCom2-WarOfTheChosen`.
- **Mod root:** workspace directory containing a recognized `.x2proj`, `.XComMod`, `Config`, `Src`, or X2MBC build script.
- **Script package:** child package under a mod's `Src` directory.
- **Dependency source:** source made visible at compile time through SDK `SrcOrig`, X2MBC `IncludeSrc`, or an explicitly declared dependency.
- **Runtime dependency:** Workshop/local mod that must be active when the game executes the developed mod.
- **Highlander:** X2WOTCCommunityHighlander, Workshop ID `1134256495`.
- **Build prefix:** copied Proton prefix (`pfx_copy`) used by X2MBC and isolated from Steam mutation.

## 6. Product scope

### 6.1 MVP scope

- project detection and configuration;
- environment discovery, health checks and automated operational setup with resume/rollback;
- UnrealScript editing and foundational semantic navigation;
- INI/localization-aware editing;
- X2MBC build/clean/debug/cook actions;
- structured output and Problems integration;
- project-local Highlander source integration;
- external Unreal Editor/game launch;
- log discovery and viewing;
- desktop implementation and explicit web degradation.

### 6.2 Post-MVP scope

- full UnrealScript refactoring;
- graphical dependency editor;
- Highlander hook search and listener generation;
- Workshop metadata validation and Alternate Mod Uploader launch;
- asset inventory and references;
- mod template/scaffolding wizard;
- headless CI command;
- generic installable plugin packaging.

### 6.3 Out of scope

- replacing Unreal Editor's asset/map/animation UI;
- implementing a UPK editor in the IDE;
- redistributing Firaxis SDK, game assets, Highlander or Microsoft runtimes;
- managing Steam credentials;
- silently subscribing to Workshop items;
- mutating global SDK source trees without preview and explicit approval.

## 7. Configuration contract

### FR-X2CFG-001 Workspace activation configuration

**AS-BUILT (`REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001`):** the plugin reads only the project-owned activation file `.ide/xcom2.json`. ADR 0007 replaces the former broad proposed schema with this exact activation-only v1 contract:

```json
{
  "version": 1,
  "target": "wotc",
  "moduleRoots": ["mods/IntentOnly"]
}
```

Acceptance criteria:

- the file is strict UTF-8 JSON, at most 64 KiB, with exactly `version`, `target`, and `moduleRoots`; duplicate keys, comments, trailing data, missing or extra fields, coercion, and unsupported values are rejected;
- `version` is exactly the number `1`, `target` is exactly the string `wotc`, and `moduleRoots` contains 1–64 unique entries;
- `.` is allowed; every other module root is a normalized, exact-case relative path of at most 4096 UTF-8 bytes naming an existing directory whose regular, non-symlink components and canonical result remain contained in the current authorized workspace;
- the native side owns the fixed configuration path and workspace authority; callers provide neither a workspace root nor a configuration path;
- the IDE reads but never creates, writes, reformats, deletes, or adds the project-owned file to `.gitignore`, and it performs no configuration watch or poll;
- valid configuration grants only recognition `active` with activation source `configured` and activation confidence `explicit`; recognition confidence remains separately derived from convention evidence, and matching configured plus convention evidence produces `configured-and-recognized`;
- invalid configuration grants no configured authority and does not suppress an independent convention-recognition result; presentation uses only safe typed diagnostics;
- explicit **Workspace Refresh** synchronously revokes prior configured state, advances activation authority, correlates configuration and scan results, and rejects stale or late results; removing the file revokes only its configured basis; and
- activation v1 grants no manual confirmation, persistence record, external-root, tool, process, mutation, Build, Problems, Logs, language, action, or bottom-contribution authority.

The implemented contract and native evidence remain activation-only. User defaults and machine-, SDK-, game-, Steam-, Proton-, dependency-, tool-, and build-specific fields are deliberately absent; each remains a future separate contract and cannot be merged into, inherited by, or treated as an override layer for activation v1.

### FR-X2CFG-002 User-level defaults

**FUTURE/TARGET, SEPARATE FROM ACTIVATION V1:** user-level defaults may eventually supply SDK, game, Steam library, and Distrobox names. Their schema, precedence, provenance, permissions, and effective-configuration presentation require a separate contract. They do not add fields to or override `.ide/xcom2.json` activation v1.

### FR-X2CFG-003 Portable project paths

Activation v1 `moduleRoots` shall be normalized workspace-relative paths (or `.`), so the recognition-activation intent remains portable and Git-shareable without machine-specific values. Future dependency paths inside the workspace shall remain relative whenever possible. Machine-specific SDK, game, Steam, Proton, prefix, tool, and build values shall use separate future configuration and shall not be required in version control or added to activation v1.

## 8. Project detection and model

### FR-X2PRJ-001 Detection

**PARTIAL / AS-BUILT Option A recognition:** the plugin recognizes convention evidence from:

- `*.x2proj`;
- `*.XComMod`;
- `.scripts/build.ps1` plus `.scripts/X2ModBuildCommon`;
- `Config/XComEngine.ini`;
- `Src/<ScriptPackage>/Classes/*.uc`.

The dedicated scanner considers exact-case regular metadata/names only within the current authorized Linux workspace. It neither follows nor accepts symlinks, excludes the fixed heavy directories `.git`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.turbo`, and `.vite`, and applies fixed depth-8 and 20,000-encounter bounds. Detection returns module-scoped `active`, `inactive`, or `needs-confirmation` state, confidence, ordered reasons, completeness/issues, and matched module roots. The pure evaluator requires at least two distinct kinds under one root for `active`; one kind is `needs-confirmation` and contributes nothing. A directory, repository, project, workspace, or ordinary file name containing `xcom` is never evidence and shall not activate the feature. Inactive and needs-confirmation modules contribute no XCOM activity entry, bottom tab, build/log/language service, action, or polling.

**AS-BUILT:** valid activation-only v1 configuration activates its declared roots with source `configured` and activation confidence `explicit`; convention recognition confidence remains separately derived. **FUTURE/TARGET:** manual confirmation plus its persistence record may eventually resolve weak or partial layouts. No confirmation path exists now.

### FR-X2PRJ-002 Project model

The model shall expose:

- mod identifier, title and target;
- script packages and their compile order;
- config/localization/content files;
- X2MBC version when detectable;
- build profiles and cooking status;
- compile-time dependencies;
- runtime dependencies;
- SDK and game compatibility status;
- Highlander version/commit/Workshop presence.

### FR-X2PRJ-003 Source layers

Indexing shall preserve source provenance and precedence:

1. base SDK `Development/SrcOrig`;
2. declared dependency sources in declared order;
3. Highlander source when enabled;
4. current mod source last.

Duplicate class/package definitions shall be diagnosed instead of silently merged.

### FR-X2PRJ-004 Dependency compatibility

The plugin shall read `XComEngine.ini` entries under:

```ini
[Engine.ScriptPackages]
+NonNativePackages=...

[UnrealEd.EditorEngine]
+ModEditPackages=...
```

It shall warn when dependency packages are ordered after the current mod, source roots are missing, or a referenced package is not indexed.

## 9. Environment discovery and onboarding

### FR-X2ENV-001 Health check

The feature shall provide an XCOM 2 **Settings contribution** for machine-level environment checks. It shall not require or imply an active XCOM workspace. Checks include:

- WOTC game installation completeness;
- WOTC SDK installation and `full_content` suitability;
- `XComGame.exe`, source and configuration presence;
- `pwsh`, Wine, Git and rsync availability;
- GE-Proton/selected compatibility tool;
- non-Steam SDK shortcut and Proton prefix;
- copied build prefix;
- `CookedPCConsole` symlink target;
- X2MBC build script;
- Highlander compile/runtime source when configured;
- known SDK fixes.

Each result shall be `pass`, `warning`, `fail`, `checking` or `not-applicable`, with evidence and remediation.

### FR-X2ENV-002 Distrobox support

The desktop adapter shall support a configured Distrobox mode. It shall execute fixed Steam/Proton discovery and launch operations through an argument vector equivalent to:

```text
distrobox enter <authorized-container> -- <fixed-program> <fixed-args>
```

Container names must be explicitly configured or selected from discovered containers. User-provided shell fragments are forbidden.

### FR-X2ENV-003 SDK fix audit

The plugin shall detect:

- `XCom_DLC_Day0` references;
- duplicate `*TLE*` source files;
- `SourceControl Disabled=False`;
- missing `GameAssetDatabase OfflineMode=True`;
- missing or incorrect `CookedPCConsole` link.

The audit shall be read-only and shall produce the input for the automated setup plan.

### FR-X2ENV-004 Download/update gate

SDK mutations and builds shall be blocked while Steam reports the game/SDK as updating or when expected install paths are incomplete. The setup workflow may poll and display download state, but shall not claim ownership of Steam's download transaction.

### FR-X2ENV-005 Automated operational setup

**PARTIAL / AS-BUILT concrete SDK transaction:** with game/SDK complete and stable, Prepare audits vanilla SDK AppID `602410` and generates exactly 15 reversible operations for the validated baseline: two Day0 INI removals, one SourceControl/GameAssetDatabase INI patch, 11 exact DLC_3 Tactical Legacy Pack quarantines, and one allowlisted `CookedPCConsole` symlink to the installed WOTC game. Apply requires approval of the exact complete digest for that single external-SDK transaction. Restore Vanilla SDK restores the captured baseline exactly; conflicts never overwrite; rollback followed by Prepare Again supports repeat setup tests. The separate dry run remains non-executable. A live Prepare audit passed with no blockers, but no live Apply occurred.

**FUTURE/TARGET:** Protontricks, Steam shortcut creation, Proton-prefix provisioning/copying, package-manager actions, and all interactive work remain excluded and non-executable.

After Steam has completed the WOTC game and SDK download, the plugin shall provide a guided **Make SDK Operational** workflow. It shall turn a downloaded installation into a verified Linux development environment without requiring the user to reproduce the manual procedure step by step.

The workflow shall support three explicit modes:

- **Plan:** inspect and display all intended actions without mutation;
- **Apply/Resume:** execute approved pending actions idempotently;
- **Rollback:** restore plugin-owned backups and remove only artifacts created by the recorded run.

### FR-X2ENV-006 Setup state machine

Setup shall be represented as a persisted, machine-scoped state machine. Any project-specific action referenced by a plan must retain an explicit project/module identity rather than borrowing the active generic workspace implicitly:

```text
idle → inspecting → waiting-for-download → planned → awaiting-approval
     → applying → awaiting-user-action → verifying → ready
     → partial | failed | cancelled | rolling-back | rolled-back
```

Every transition shall include timestamp, step ID, evidence, result and machine-monitor generation; project-specific steps shall also include module identity and generation. Restarting the IDE shall resume from the last verified checkpoint rather than repeat successful mutations.

### FR-X2ENV-007 Setup plan

The AS-BUILT native Prepare plan covers items 1 and 4–8 below for the concrete SDK transaction. Items 2–3 and 9–14 remain FUTURE/TARGET unless explicitly stated; excluded external interactive items are non-executable.

The generated plan shall cover, when applicable and in dependency order:

1. verify game, SDK and `full_content` completeness;
2. discover required host/container tools and produce install remediation;
3. authorize SDK, game, Steam library, Workshop and prefix roots;
4. create checksummed backups of files that will change;
5. remove `XCom_DLC_Day0` references atomically;
6. quarantine duplicate Tactical Legacy `*TLE*` sources instead of irreversibly deleting them;
7. set `SourceControl Disabled=True` and `GameAssetDatabase OfflineMode=True`;
8. create/repair the SDK `CookedPCConsole` symlink;
9. verify or guide creation of the GE-Proton non-Steam editor shortcut;
10. provision/verify the editor Proton prefix and required runtime components;
11. create or refresh the isolated `pfx_copy` build prefix;
12. create the no-space SDK alias when configured;
13. write or update `.ide/xcom2.json` through a diff;
14. run final smoke verification and produce an operational-readiness report.

The plan shall mark every step as automatic, requires approval, requires user interaction, already satisfied, blocked or not applicable.

### FR-X2ENV-008 Idempotent SDK remediation

**AS-BUILT for the concrete SDK transaction:** Prepare derives the same fixed operation set from the same captured baseline. Restore Vanilla SDK restores exact original bytes, hashes, modes, inventory, and symlink absence. Conflicts never overwrite, and a successful restore enables Prepare Again without duplicate INI entries, nested backups, duplicate links, or repeated quarantines.

### FR-X2ENV-009 Tool installation boundary

The plugin shall not execute privileged package-manager operations silently. Missing Wine, Winetricks, Protontricks, PowerShell, rsync, Git, Distrobox or container packages shall produce:

- an exact command preview for the detected platform;
- an optional separately confirmed privileged action when supported by policy;
- post-install discovery and version verification.

Passwords and elevation prompts remain under the operating system's control and shall never be captured by the plugin.

### FR-X2ENV-010 Proton provisioning

The setup workflow shall automate Proton-prefix operations where deterministic and supported, including prefix discovery, `dotnet472` verification/installation, redistributable execution and creation of `pfx_copy`. If an upstream installer or Steam requires interactive confirmation, setup shall enter `awaiting-user-action`, show exact instructions and verify the postcondition before continuing.

The Steam-managed `pfx` shall never be modified through the build workflow after `pfx_copy` is created. Refreshing `pfx_copy` requires an explicit plan because it may discard user-installed components.

### FR-X2ENV-011 Setup verification

The environment is `ready` only when all required postconditions pass:

- game and SDK roots are complete and stable;
- required binaries and source roots exist;
- known SDK defects are remediated or explicitly waived;
- `CookedPCConsole` resolves to the authorized game directory;
- the editor launch target and compatibility tool are known;
- the build prefix exists and contains required runtime evidence;
- PowerShell/X2MBC prerequisites are executable;
- a non-destructive X2MBC validation or minimal fixture smoke check succeeds.

A warning or waiver shall prevent a misleading all-green status and remain visible in the readiness report.

### FR-X2ENV-012 Backup, journal and rollback

**AS-BUILT:** the native engine durably writes machine-level intent/checkpoints and content-addressed backups. For concrete Prepare it captures the Steam build/manifest/root fingerprint and exact original bytes, hashes, modes, inventory, and symlink absence. Approval binds the exact transaction/workspace/generation/ordered operations/preconditions digest and grants only that one external-SDK write. Hash/path/workspace/generation/fingerprint gates reject stale or escaping input.

Restore Vanilla SDK rolls back in reverse to the exact captured baseline. Conflicts block overwriting post-apply edits; recovery supports journal verification, interrupted rollback continuation, conflict-safe retry, and Prepare Again after successful restore. Limits remain 16 MiB per backup, 64 retained removable transactions, and 256 events. Export payloads omit paths/content. General external-root grants and external interactive setup remain FUTURE/TARGET.

The workflow shall never include game/SDK assets in logs, journals, exports, or support bundles.

## 10. Editor and language support

### FR-X2LANG-001 File types

The editor shall provide syntax mode, icons and basic structure for:

- UnrealScript `.uc` and `.uci`;
- XCOM/Unreal INI files;
- localization `.int` and supported locale variants;
- `.x2proj`, `.XComMod`, PowerShell, JSON and XML.

### FR-X2LANG-002 UnrealScript tokenizer

The Monaco integration shall recognize comments, names, strings, numbers, macros, preprocessor directives, class declarations, inheritance, `within`, structs, enums, states, functions, events, delegates, operators, properties, specifiers, `defaultproperties` and Unreal/XCOM macros.

### FR-X2LANG-003 UnrealScript index

A workspace-scoped provider shall index classes, interfaces, structs, enums, states, functions, events, delegates, variables, config variables and macros from all configured source layers.

Index entries shall include provider, file provenance, package, range and source-layer generation.

### FR-X2LANG-004 Navigation

The plugin shall support:

- go to definition;
- find references;
- workspace/document symbols;
- type hierarchy for `extends`/`within` where resolvable;
- navigation from config class/variable references to UnrealScript declarations.

### FR-X2LANG-005 Completion and hover

Completion shall include visible symbols, inherited members, macros, XCOM globals and known Highlander APIs. Hover shall show declaration, package, provenance and documentation when available.

### FR-X2LANG-006 Diagnostics

Diagnostics shall include at least:

- unresolved types/members/packages;
- duplicate classes;
- invalid inheritance;
- malformed declarations;
- missing dependency source roots;
- package-order errors;
- malformed INI sections/operators;
- missing localization keys detectable from indexed usage.

Compiler diagnostics remain authoritative and shall be shown with provider identity distinct from static IDE diagnostics.

### FR-X2LANG-007 Document synchronization

Open/change/save/close events shall use versioned provider-neutral document contracts. Stale diagnostics and completion results from previous document or workspace generations shall be rejected.

### FR-X2LANG-008 Highlander documentation

When a symbol originates from Highlander, hover or a secondary action shall expose:

- Highlander provenance and version/commit;
- whether it is compile-time-only or likely runtime-required;
- official feature documentation URL when mapped;
- event contract fields (`EventID`, data/source types, `NewGameState`) where available.

## 11. Build, clean and cooking

### FR-X2BUILD-001 Build profiles

The plugin shall expose fixed actions:

- Build (`default`);
- Debug Build (`debug`);
- Clean;
- Rebuild;
- Cook when `ContentOptions.json` is configured.

Actions shall invoke the project's X2MBC entry point with structured arguments for source directory, SDK path, game path and configuration.

### FR-X2BUILD-002 Safe process execution

Rust shall own build process lifecycle. It shall:

- invoke a discovered/authorized executable directly without a shell;
- pass environment and arguments separately;
- canonicalize and authorize workspace and external tool roots;
- prevent arbitrary executable paths from workspace configuration;
- support cancellation and process-tree cleanup;
- prevent conflicting concurrent builds per workspace;
- bound retained output while permitting streamed display.

### FR-X2BUILD-003 Linux prefix

Linux builds shall use the configured copied prefix and `WINEDEBUG=-all` by default. The health panel shall reject a missing prefix and warn when the copy is older than the Steam-managed prefix.

### FR-X2BUILD-004 Structured output

Build events shall include:

- lifecycle state;
- action/profile;
- timestamps and duration;
- normalized phase;
- stdout/stderr chunks;
- parsed diagnostics;
- exit code, cancellation and timeout state;
- output/cooked-mod path when known.

### FR-X2BUILD-005 Navigable diagnostics

Recognized compiler diagnostics shall populate a Problems tab. Selecting one shall open the authorized workspace file and reveal the exact 1-based line/column after explicit coordinate conversion.

External SDK/dependency diagnostics may be displayed read-only and must never bypass external-root authorization.

### FR-X2BUILD-006 Build provenance

Every build result shall record effective SDK/game paths, X2MBC version, profile, Highlander commit/version, dependency roots and source generation. Machine-local absolute paths must be redacted from exportable support bundles when requested.

## 12. Community Highlander integration

### FR-X2HL-001 Integration modes

The plugin shall distinguish:

- no Highlander;
- runtime-only Highlander;
- project-local Git submodule source;
- project-local explicit source root;
- legacy global SDK source overlay.

The recommended/default mode is project-local source plus runtime Workshop dependency.

### FR-X2HL-002 Project-local setup

The plugin shall detect the EMPT/X2MBC pattern:

```powershell
$builder.IncludeSrc("$srcDirectory\X2WOTCCommunityHighlander\X2WOTCCommunityHighlander\Src")
```

It shall verify that the source exists and report the Git commit. A setup assistant may propose:

```text
git submodule add https://github.com/X2CommunityCore/X2WOTCCommunityHighlander.git <project-path>
```

but must show the exact Git/file diff and require confirmation before mutation.

### FR-X2HL-003 Legacy overlay warning

If SDK `SrcOrig` appears overwritten with Highlander sources, the plugin shall identify it as a legacy global overlay, display update/verification risks and offer a migration plan. It shall not delete or restore SDK source automatically.

### FR-X2HL-004 Hard dependency analysis

The plugin shall warn that direct use of Highlander-only classes/functions creates a runtime hard dependency. Hook methods implemented through `X2DownloadableContentInfo` and Highlander-only configuration values shall not automatically be treated as compile-time requirements.

This analysis is advisory unless proven by compiler/runtime metadata; uncertainty must be displayed.

### FR-X2HL-005 Workshop status

When the Steam library is authorized, the plugin shall check Workshop ID `1134256495` and report present/missing/version evidence. It shall never subscribe or update without an explicit user action delegated to Steam.

### FR-X2HL-006 Hook explorer (post-MVP)

The plugin should provide searchable Highlander features grouped by tactical, strategy, UI, compatibility, customization, loadout, pawn and misc categories, with listener-template insertion from documented typed event contracts.

Generated code must be previewed before insertion and cite its source feature.

## 13. Running and testing

### FR-X2RUN-001 Unreal Editor launch

The plugin shall launch the already configured SDK non-Steam shortcut through Steam/Distrobox rather than execute arbitrary command text. Required launch semantics are:

```text
editor -noscriptcompile -nogadwarning
```

The IDE does not embed Unreal Editor.

### FR-X2RUN-002 Game test launch

The plugin shall provide a configurable game test action and show the active test mod set. It must warn when a compile-time Highlander dependency is configured but runtime Highlander is absent.

### FR-X2RUN-003 Logs and redscreens

The plugin shall discover the active Proton prefix's XCOM 2 WOTC logs, display `Launch.log`, follow appended content and parse navigable source references where possible.

### FR-X2RUN-004 Minimal test profile

The plugin shall support a test profile containing only:

- Community Highlander when required;
- the current mod;
- explicitly declared dependencies.

It shall not rewrite the user's normal mod list without preview and backup.

## 14. UI requirements

### FR-X2UI-000 Machine Settings contribution

Desktop Settings shall provide the XCOM 2 machine setup contribution for game/SDK/Steam state, environment health, and operational setup. **AS-BUILT:** it presents the monitor, separate pure non-executable dry run, concrete 15-operation Prepare review, complete 64-character approval digest, exact-digest Apply, cancel, Restore Vanilla SDK, recovery, and Prepare Again controls. Closed Settings performs no XCOM monitor/transaction adapter work. Open Settings exclusively owns one lifecycle for each adapter; close synchronously invalidates, unsubscribes, and clears their timers. Transaction authority remains workspace-correlated. **FUTURE/TARGET:** external interactive setup remains excluded and non-executable. Machine Settings is independent of project/module activation.

The browser setup adapter explicitly reports unavailable without simulation. Normal web composition exposes no XCOM Settings surface and starts no adapter subscription, hidden polling, transaction work, or simulated Steam state.

### FR-X2UI-001 Conditional project activity entry

**PARTIAL / AS-BUILT (`REQ-XCOM2-MODULE-ACTIVATION-001`):** the dedicated accessible **XCOM 2 Project** activity entry opens a recognition-only evidence panel only when Option A's pure evaluator observes at least two distinct exact evidence kinds under one inferred module root. Generic, name-only, duplicate-kind, one-kind, `needs-confirmation`, and `inactive` workspaces show no entry. The contribution follows generation-correlated activation and synchronous deactivation and remains independent of the Java panel and machine Settings.

**AS-BUILT:** valid `.ide/xcom2.json` v1 contributes configured/explicit recognition-only activation; explicit full Workspace Refresh is its only reread trigger. **FUTURE/TARGET:** manual confirmation/persistence, external roots, project actions, and broader project panels remain unimplemented.

### FR-X2UI-002 Conditional project bottom tabs

Only an activated XCOM project/module shall contribute or compose these contextual bottom tabs:

- XCOM Build;
- Problems filtered/labeled for the activated module;
- XCOM Logs.

Machine Environment/setup remains in Settings and is not a global or project bottom tab. Generic workspaces shall receive no XCOM bottom tab. Until a generic contribution registry exists, conditional composition may occur in the desktop app shell behind the first-party feature descriptor.

### FR-X2UI-003 Status bar

The status bar shall show concise state:

```text
WOTC · SDK Ready/Incomplete · Highlander <version|off> · Build <state>
```

### FR-X2UI-004 Actions

Actions shall be accessible through buttons and a command-palette-compatible command registry. Required command IDs:

```text
xcom2.environment.check
xcom2.setup.plan
xcom2.setup.apply
xcom2.setup.resume
xcom2.setup.rollback
xcom2.build.default
xcom2.build.debug
xcom2.build.clean
xcom2.build.cancel
xcom2.editor.launch
xcom2.game.launch
xcom2.logs.open
xcom2.highlander.inspect
```

### FR-X2UI-005 Honest browser mode

The web application may eventually provide syntax highlighting, fixture project parsing and documentation browsing for an explicitly configured/evidence-activated module. AS-BUILT, it provides no XCOM surface and starts no hidden XCOM polling. Any future web contribution shall report native SDK discovery, builds, Proton, external editor/game launch and local logs as unavailable—not simulated successes.

## 15. Architecture requirements

### FR-X2ARCH-001 Contracts

**PARTIAL / AS-BUILT:** `packages/contracts/src/xcom2-setup.ts` defines the provider-neutral dry-run, transaction, operation, approval, event, rollback, recovery, and export-safe types. The dry-run cannot carry executable operations; native code owns operation construction. Recognition and activation-only v1 configuration contracts plus pure activation decisions are AS-BUILT. Manual confirmation/persistence, external roots, environment expansion, build, language, and runtime contracts remain FUTURE/TARGET.

No contract shall expose raw Tauri, Rust, Protontricks, Distrobox, native paths, or backup content.

### FR-X2ARCH-002 Ports

**PARTIAL / AS-BUILT:** the focused `Xcom2SetupPort` supports `prepare`, `approve`, `apply`, `getTransaction`, `listTransactions`, `cancel`, `rollback`, `recover`, and `subscribe` with structured requests/results. Native implementations alone discover targets and construct allowlisted operations; callers provide no paths or raw filesystem instructions. The setup monitor port remains separate from this transaction port.

The dedicated `Xcom2ModuleScannerPort` and read-only module-configuration port are AS-BUILT for bounded requests/results. Manual confirmation/persistence, external roots, build, language, and runtime ports remain FUTURE/TARGET. All request/response types shall remain structured and workspace/generation scoped.

### FR-X2ARCH-003 Adapters

**AS-BUILT for setup transactions and project recognition:**

- the setup Tauri adapter maps typed setup operations to fixed Rust commands and validates native responses;
- the recognition Tauri adapter accepts only the fixed correlation/limit request and strictly validates response identity, enums, canonical workspace-relative paths, ordering, and duplicates;
- the configuration adapter accepts only current correlation, strictly sanitizes native failures, and exposes no caller-selected workspace/configuration path;
- the dedicated Rust recognition and configuration commands own workspace authority; the latter enforces strict UTF-8/JSON/schema/size/path/duplicate/containment rules and reads only;
- browser composition creates no configuration reader or recognition scanner, and setup reports unavailable without simulation;
- UI consumes props/callbacks only; app shells own composition.

Future confirmation/external-root/project-tool/build/language/runtime adapters must preserve the same boundaries.

### FR-X2ARCH-004 External-root authorization

The existing workspace-only authorization is insufficient because SDK, game, Workshop, prefix, and logs live outside the mod workspace. **AS-BUILT:** the complete digest provides a narrow one-transaction write approval for the fingerprinted concrete SDK operation set; it is not a reusable external-root grant.

**FUTURE/TARGET:** the implementation shall introduce a general explicit external-root grant model with:

- root kind (`sdk`, `game`, `steamLibrary`, `protonPrefix`, `dependency`);
- canonical path;
- read/write/execute capability;
- user approval and provenance;
- revocation;
- symlink escape prevention;
- least privilege (read-only by default).

No generic filesystem bypass shall be introduced.

### FR-X2ARCH-005 Process policy

Only allowlisted operations may launch external programs. Workspace files shall never select an unrestricted executable. Build scripts may be project inputs only after explicit trust approval and shall run with displayed provenance.

### FR-X2ARCH-006 Feature descriptor

The first-party built-in, experimental module shall expose plugin-shaped metadata. No extension install/remove lifecycle or generic plugin runtime exists yet. The descriptor is equivalent in shape to a possible future extension manifest:

```typescript
interface Xcom2FeatureDescriptor {
  id: "ide.xcom2-wotc";
  apiVersion: 1;
  fileExtensions: string[];
  commands: string[];
  panels: string[];
  requiredCapabilities: string[];
}
```

This descriptor is not permission to execute arbitrary third-party code. Its Settings contribution is machine-scoped; project activity, bottom tabs, commands, and language contributions must be conditioned on the activation decision from FR-X2PRJ-001.

### FR-X2ARCH-007 Activation boundary

Project/module activation is **PARTIAL / AS-BUILT** under `REQ-XCOM2-MODULE-ACTIVATION-001` and `REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001`, both recognition-only. The bounded service remains separate from machine Settings monitoring. One authorized-workspace generation jointly correlates one dedicated read-only convention scan and one fixed-path activation-v1 read. A pure evaluator keeps activation source/confidence separate from convention recognition confidence; only an `active` result drives the accessible recognition activity. Invalid configuration grants no authority and cannot suppress an independent Option A result. Healthy Steam/game/SDK evidence or completed setup never activates a project. Explicit full Workspace Refresh and committed switching synchronously revoke the old contribution before reread/transition; mismatched configuration/scan/workspace authority rejects stale results. Generic, name-only, and one-kind workspaces contribute nothing unless valid v1 configuration explicitly activates a contained root. The browser starts no configuration read, recognition scan, or XCOM monitor.

Manual confirmation/persistence, external roots, content parsing, Build, Problems, Logs, language support, actions, and bottom contributions remain FUTURE/TARGET.

## 16. Security and safety requirements

### NFR-X2SEC-001 Path containment

All workspace writes must remain under the authorized mod workspace. External roots are read-only unless a specific operation has a separately approved write grant.

### NFR-X2SEC-002 No shell injection

Build/launch APIs accept enums, IDs and structured arguments—not raw command lines. Rust uses direct process APIs.

### NFR-X2SEC-003 Mutation preview

SDK fixes, Git submodule changes, config rewrites, symlink creation and mod-list changes require:

1. precondition check;
2. backup or reversible plan;
3. diff/operation preview;
4. explicit confirmation bound to the exact full operation digest;
5. postcondition verification;
6. durable audit event/checkpoint;
7. conflict-safe rollback instructions.

The native transaction implements these mechanics for the concrete 15-operation SDK setup. Its approval is limited to one reviewed transaction and does not satisfy the FUTURE/TARGET general external-root grant model or authorize excluded interactive setup.

### NFR-X2SEC-004 Secrets and logs

Steam credentials, tokens and private keys shall never be read. Logs/support bundles shall redact home paths, account IDs and configured sensitive values where feasible.

### NFR-X2SEC-005 Dependency provenance

Every indexed external source shall display origin, version/commit and trust status. Conflicting sources shall not be silently combined.

## 17. Performance and reliability

### NFR-X2PERF-001 Startup

Project detection should produce an initial classification within 2 seconds for a representative mod workspace without indexing the full SDK synchronously.

### NFR-X2PERF-002 Progressive indexing

Local project symbols shall become available before full SDK/Highlander indexing. Progress and cancellation shall be visible.

### NFR-X2PERF-003 Interactive latency

After indexing, p95 completion/hover requests should finish within 250 ms and definition queries within 500 ms on the reference machine.

### NFR-X2REL-001 Build cancellation

Cancellation shall terminate the owned process tree and reach a terminal state within 5 seconds, without marking partial output as successful.

### NFR-X2REL-002 Crash recovery

An IDE restart shall recover project configuration and the last completed build summary, but shall not assume an interrupted build succeeded.

### NFR-X2REL-003 Steam update resilience

The health check shall detect missing/changed SDK sources after Steam update or verification and invalidate affected indexes/build provenance.

### NFR-X2REL-004 Setup resumability

After IDE, host or container interruption, setup shall recover its journal within 2 seconds, classify the interrupted step from observable postconditions and offer safe resume or rollback. It shall never infer success solely from the previous process exit state.

### NFR-X2REL-005 Setup rollback integrity

For every automatically mutated fixture, rollback tests shall restore the original content hash and remove only setup-created artifacts. Conflicting post-setup edits shall block automatic rollback and require review.

### NFR-X2COMP-001 Supported baseline

The first supported environment is:

- Linux/CachyOS host;
- Tauri desktop IDE;
- Steam native or explicitly configured Distrobox (`steambox` reference deployment);
- XCOM 2 WOTC Steam SDK;
- GE-Proton 9-27 or verified newer compatibility tool;
- PowerShell Core and X2ModBuildCommon;
- EMPT-style mod projects.

Other platforms require explicit compatibility evidence.

## 18. Observability

### FR-X2OBS-001 Events

Emit bounded structured events for environment checks, indexing, builds, launch, log discovery, dependency changes and failures. Events shall carry workspace ID and generation.

### FR-X2OBS-002 Support bundle

A user-approved bundle should include effective configuration with redaction, tool versions, environment health, latest build summary and bounded logs. It shall exclude proprietary SDK/game assets and source content.

## 19. Acceptance test matrix

| ID        | Scenario                                      | Expected result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-X2-001 | Open/switch non-XCOM workspace                | One bounded recognition scan may run for the authorized workspace generation, but it yields no activity or bottom contribution. With Settings closed, no machine snapshot/refresh, history/detail, polling, or subscription work starts; machine setup remains available only by opening desktop Settings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AT-X2-002 | Open EMPT fixture                             | Detects mod ID, packages, X2MBC and build profiles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AT-X2-003 | SDK path missing                              | Environment reports failure with remediation; build disabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AT-X2-004 | SDK update in progress                        | Mutating setup blocked/warned and index marked provisional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AT-X2-005 | Distrobox mode                                | Fixed discovery/launch runs only in authorized container.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AT-X2-006 | UnrealScript definition                       | Navigates from local use to SDK or Highlander declaration with provenance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AT-X2-007 | Duplicate class fixture                       | Reports both source roots and does not silently choose one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AT-X2-008 | Build success fixture                         | Streams output, exits success and records provenance/output path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AT-X2-009 | Build compile error                           | Populates Problems and opens exact source line on click.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT-X2-010 | Cancel build                                  | Kills process tree and reports cancelled within 5 seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AT-X2-011 | Missing build prefix                          | Build disabled with copied-prefix remediation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AT-X2-012 | Highlander submodule                          | Detects source root and exact commit; `IncludeSrc` validated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AT-X2-013 | Highlander direct API use, runtime mod absent | Displays hard-dependency warning before test launch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AT-X2-014 | Hook-only config fixture                      | Does not falsely claim compile-time Highlander is mandatory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AT-X2-015 | External path escape                          | Recognition neither traverses nor accepts symlinks; setup transaction paths remain canonically contained by their separate reviewed authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AT-X2-016 | Web build                                     | Builds independently with no XCOM surface, adapter startup, subscription, or hidden polling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AT-X2-017 | Workspace switch during scan/index/build      | Current recognition removes its activity synchronously at commit and ignores stale scan generations; future index/build flows retain the same requirement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AT-X2-018 | Steam SDK files changed                       | Index/build provenance invalidated and health recheck requested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AT-X2-019 | Setup plan on incomplete download             | No mutation; state is `waiting-for-download` with Steam evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AT-X2-020 | Setup plan dry run                            | Complete ordered description; no filesystem/process mutation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AT-X2-021 | Repeat concrete setup                         | Prepare yields the exact reviewed set; Apply→Restore→Prepare Again introduces no duplicates or drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AT-X2-022 | Interrupt setup after an atomic fix           | Restart recovers checkpoint and resumes without duplicating the change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AT-X2-023 | Interactive Proton installer required         | Step is FUTURE/TARGET, excluded, and non-executable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AT-X2-024 | Restore Vanilla SDK                           | Exact captured bytes, hashes, modes, inventory, and symlink absence are restored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AT-X2-025 | Restore encounters external edit              | Automatic overwrite is blocked; conflict and recovery choices are displayed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AT-X2-026 | Portable configured activation and revocation | A strict project-owned activation-only v1 file with `version`, `target`, and contained relative `moduleRoots` activates only the recognition contribution; external removal has no effect before explicit Workspace Refresh, refresh synchronously revokes configured state and rejects stale restoration, restoring the exact file plus refreshing restores the contribution, and the IDE never writes the file or gains tool, process, external-root, mutation, or bottom-contribution authority.                                                                                                                                                                                                                                                                           |
| AT-X2-027 | Safe invalid-configuration diagnostics        | Invalid v1 yields one accessible Settings > Workspace warning with the fixed file label, exact mapped copy, and support ID, but no content, roots, absolute paths, internals, secrets, causes, or edit/open/write action. Refresh revokes old diagnostic/configured authority and accepts only current correlation; strong Option A recognition remains active and mirrors the complete warning without contextual authority. The Story is `@implemented-and-validated`.                                                                                                                                                                                                                                                                                                      |
| AT-X2-028 | Native missing-Steam machine Settings UI      | **FUTURE/TARGET pending promotion:** From one fresh, isolated Linux X11 release/no-bundle process, visible Settings navigation through the real Tauri/Rust path presents the accessible XCOM 2 machine section, safe aggregate **Not Found** state, and exactly three **Not Found** product cards; each missing required product contributes blocker evidence and the optional product does not. Acceptance is rendered-UI-only and claims no IPC instrumentation/counting/lifecycle, refresh/reopen, **Plan Setup**/`canPlan`, transaction, project activity/tool, post-launch filesystem identity, mutation, live Steam, package/bundle/installer, Wayland/other OS/DPI, or machine correctness. `REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001` remains `@not-implemented`. |

## 20. Delivery phases

### Phase 0 — Architecture and fixtures

**Status:** Partial. ADR 0007 accepts the built-in feature-module boundary while explicitly deferring the generic plugin runtime and external-root write/execute grant design. Sanitized fixtures and the broader threat/configuration work remain required.

- accept an ADR for first-party feature modules and defer external-root grants until their mutation semantics are designed;
- create sanitized WOTC/EMPT/Highlander fixtures without proprietary game assets;
- define contracts, threat model and configuration schema;
- add boundary tests.

Exit criterion: contracts and fixtures compile; no process execution.

### Phase 1 — Project, environment and operational setup

**Status:** Partial. `REQ-XCOM2-MACHINE-SETTINGS-001` is `@implemented-not-e2e-validated`: Settings owns one bounded monitor/transaction lifecycle only while open, with synchronous close cancellation and guarded switch/restore/stale behavior. Monitor, separate non-executable dry run, browser-unavailable adapter, concrete 15-operation SDK Prepare, exact-digest one-transaction Apply approval, machine journals/backups, Restore Vanilla SDK, conflicts/recovery, and Prepare Again are AS-BUILT. The live Prepare audit passed with no blockers; no live Apply has occurred. `REQ-XCOM2-MODULE-ACTIVATION-001`, `REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001`, and `REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001` are `@implemented-and-validated`: bounded Option A scanning, project-owned read-only activation v1, and the safe explicit-refresh warning/checking lifecycle retain separate confidence/authority, strong Option A fallback, no-disclosure/no-input-write scope, and no contextual authority. Manual confirmation/persistence, external roots, contextual project tools, complete health/tool discovery, general external-root grants, Proton/shortcut/prefix/package-manager work, and user-interaction checkpoints remain FUTURE/TARGET.

- convention and activation-v1 recognition are current; the full configured project model remains future;
- activation-only `.ide/xcom2.json` v1 is current; broader configuration remains future;
- complete health panel and SDK/game/tool/Distrobox discovery;
- production operation builder and least-privilege external grants;
- idempotent concrete SDK remediation, symlink and prefix-copy actions;
- user-interaction checkpoints for Steam/Proton installers;
- production verification and carefully approved live validation.

Exit criterion: AT-X2-001 through AT-X2-005 and AT-X2-019 through AT-X2-025 pass.

### Phase 2 — Build replacement for VS Code

- X2MBC actions;
- process lifecycle and cancellation;
- output/Problems panels;
- diagnostic navigation;
- build provenance.

Exit criterion: a representative EMPT project can be built without VS Code; AT-X2-008 through AT-X2-011 pass.

### Phase 3 — UnrealScript intelligence

- tokenizer/parser/index;
- source layering;
- definition/references/symbols;
- completion/hover/diagnostics;
- versioned document sync.

Exit criterion: AT-X2-006 and AT-X2-007 pass with measured latency evidence.

### Phase 4 — Highlander

- project-local source/submodule detection;
- `IncludeSrc` validation;
- runtime dependency checks;
- documentation mapping;
- optional setup preview.

Exit criterion: AT-X2-012 through AT-X2-014 pass.

### Phase 5 — Run/test/polish

- Unreal Editor/game launch;
- log following and redscreen parsing;
- minimal test profile;
- support bundle;
- documentation and packaging.

Exit criterion: complete edit → build → launch → diagnose workflow without VS Code.

## 21. Definition of “replaces VS Code”

The plugin may claim to replace VS Code for the supported XCOM 2 workflow only when a user can, from this IDE:

1. open/configure an EMPT/X2MBC mod;
2. edit all source/config/localization/build metadata files;
3. receive UnrealScript syntax, navigation and actionable diagnostics;
4. build/debug-build/clean/cook with structured output;
5. navigate compiler errors;
6. configure and verify project-local Highlander dependencies;
7. launch the external Unreal Editor and game test;
8. inspect logs and recover from common failures;
9. complete the workflow without opening VS Code or ModBuddy.

This claim does not imply replacement of Unreal Editor or Steam Workshop tooling.

## 22. Required documentation outputs

Before release, the implementation shall add:

- ADR for the XCOM feature/plugin boundary and the decision to defer external-root mutation grants;
- ARC42 building-block/runtime updates;
- user setup guide for native Steam and Distrobox Steam;
- `.ide/xcom2.json` schema reference;
- X2MBC build guide;
- Highlander dependency guide;
- troubleshooting and support-bundle guide;
- license/provenance inventory for external tools and documentation-derived data.
