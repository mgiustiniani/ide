Business Need: Safe XCOM 2 project configuration diagnostics
  To correct invalid project intent without exposing project data or losing credible recognition
  Desktop users need actionable configuration warnings that follow explicit workspace refresh authority.

  This Story defines the approved invalid-configuration diagnostic UX for activation-only `.ide/xcom2.json` v1 while preserving ADR 0007 Option A recognition.
  Traceability: FR-X2CFG-001, FR-X2PRJ-001, FR-X2UI-001, FR-X2UI-005, FR-X2ARCH-001, FR-X2ARCH-002, FR-X2ARCH-003, FR-X2ARCH-007, NFR-X2SEC-001, NFR-X2SEC-004, NFR-X2REL-002, AT-X2-001, AT-X2-017, AT-X2-026, and new invalid-configuration diagnostic acceptance AT-X2-027.

  Eventual native evidence is bounded to a scenario-owned sandbox filesystem and the production Linux X11 Tauri release/no-bundle WebKit DOM at an asserted 1440x900 viewport.
  The project fixture contains no proprietary content, and every project path remains regular, non-symlink, exact-case, and contained within the current authorized workspace.
  It makes no application-package, Git-synchronization, configuration-watcher, Wayland, other-operating-system, or other-DPI-behavior claim.
  It also makes no proprietary compatibility, module-content parsing, external-root, machine-correctness, process, mutation, or contextual XCOM tool claim.
  Browser behavior is unchanged and outside this native Story.

  @REQ-XCOM2-MODULE-CONFIGURATION-DIAGNOSTICS-001 @desktop @native-gui @functional-requirement @non-functional-requirement @security @resilience @accessibility @not-implemented
  Scenario: Explain invalid project configuration across explicit refresh without suppressing recognized activation
    Given one scenario sandbox owns all desktop user state and an actual authorized workspace named "diagnostic-wotc"
    And the isolated desktop user state contains one scenario-owner secret canary that is absent from the workspace
    And the actual workspace contains no XCOM convention evidence
    And its actual "mods/IntentOnly" path is an empty regular directory
    And its actual regular file ".ide/xcom2.json" has exactly these malformed UTF-8 bytes:
      """
      {"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"],"note":"CONFIG-SOURCE-MUST-NOT-APPEAR"
      """
    And every project path and containing directory has that exact Linux case, is non-symlink, and remains contained within the authorized workspace
    When a freshly built production release/no-bundle Tauri executable is launched directly on Linux X11 for "diagnostic-wotc"
    And its WebKit DOM viewport is exactly 1440x900
    Then within 15 seconds the workspace is ready
    And it has no "XCOM 2 Project" activity entry, recognition panel, or XCOM bottom contribution
    When the person opens the real Settings and selects "Workspace"
    Then "Current workspace" shows exactly one atomic accessible warning with role "alert" and title "XCOM 2 project configuration needs attention"
    And that warning shows exactly:
      | field              | value                                                                                                  |
      | project file label | .ide/xcom2.json                                                                                        |
      | summary            | The XCOM 2 project configuration is not valid JSON.                                                    |
      | remediation        | Correct the JSON syntax so the file contains one complete JSON object, then refresh the workspace.     |
      | support identifier | configuration-invalid-json                                                                             |
    And the warning is perceivable without color alone and offers no edit, open, or write action
    And the rendered DOM contains none of these prohibited disclosures:
      | prohibited disclosure                          |
      | CONFIG-SOURCE-MUST-NOT-APPEAR                  |
      | the actual absolute scenario sandbox root      |
      | configuration bytes or submitted module roots  |
      | parser, provider, or native-command details    |
      | the scenario-owner secret canary or raw causes |
    And no "XCOM 2 Project" activity entry, recognition panel, or XCOM bottom contribution appears
    When the scenario owner externally replaces the actual regular ".ide/xcom2.json" file without using the application with exactly these valid v1 UTF-8 bytes:
      """
      {"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"]}
      """
    Then throughout the next one second the exact invalid-JSON warning remains unchanged
    And no "XCOM 2 Project" activity entry, recognition panel, or XCOM bottom contribution appears
    And the application performs no configuration watch or poll refresh
    When the person invokes the actual "Workspace Refresh" control
    Then the invalid-JSON warning is synchronously cleared and the neutral state "Checking XCOM 2 project configuration…" appears before Workspace Refresh reports completion
    And within 15 seconds the neutral checking state clears and no configuration or scan warning is shown
    And exactly one accessible activity entry named "XCOM 2 Project" appears with a keyboard-focusable control of the same accessible name
    When the person opens "XCOM 2 Project" with the keyboard
    Then its recognition panel shows exactly:
      | field                  | value                                                                                       |
      | target                 | wotc                                                                                        |
      | module root            | mods/IntentOnly                                                                             |
      | state                  | active                                                                                      |
      | source                 | configured                                                                                  |
      | activation confidence  | explicit                                                                                    |
      | recognition confidence | none                                                                                        |
      | limitation             | Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution. |
    And its ordered activation reasons are exactly:
      | kind                   | workspace-relative path |
      | explicit-configuration | .ide/xcom2.json         |
    And configured activation grants no XCOM Build, Problems, Logs, language support, project action, process execution, external-root authority, or bottom contribution
    When the scenario owner externally replaces the actual regular ".ide/xcom2.json" file without using the application with exactly these unsupported-target UTF-8 bytes:
      """
      {"version":1,"target":"xcom2","moduleRoots":["mods/IntentOnly"]}
      """
    And the scenario owner externally creates exactly these empty regular Option A descriptor files without using the application:
      | workspace-relative path                  | exact byte length |
      | mods/IntentOnly/IntentOnly.x2proj        | 0                 |
      | mods/IntentOnly/IntentOnly.XComMod       | 0                 |
    Then throughout the next one second the exact configured activity and open recognition panel remain unchanged
    And no configuration or scan warning appears
    And the application performs no configuration or evidence watch or poll refresh
    When the person returns to the real Settings > Workspace and invokes the actual "Workspace Refresh" control
    Then the configured decision and its explicit-configuration reason are synchronously revoked and the neutral state "Checking XCOM 2 project configuration…" appears before Workspace Refresh reports completion
    And within 15 seconds "Current workspace" shows exactly one atomic accessible warning with role "alert" and title "XCOM 2 project configuration needs attention"
    And that warning shows exactly:
      | field              | value                                                |
      | project file label | .ide/xcom2.json                                      |
      | summary            | This XCOM 2 project target is not supported.         |
      | remediation        | Set target to "wotc", then refresh the workspace.  |
      | support identifier | configuration-unsupported-target                     |
    And the neutral checking state has cleared
    And exactly one keyboard-accessible "XCOM 2 Project" activity entry remains solely from recognized high-confidence Option A evidence
    When the person opens "XCOM 2 Project" with the keyboard
    Then its recognition panel shows exactly:
      | field        | value                                                                                       |
      | module root  | mods/IntentOnly                                                                             |
      | state        | active                                                                                      |
      | confidence   | high                                                                                        |
      | completeness | complete                                                                                    |
      | limitation   | Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution. |
    And its ordered evidence list is exactly:
      | kind    | workspace-relative path                  |
      | x2proj  | mods/IntentOnly/IntentOnly.x2proj        |
      | xcommod | mods/IntentOnly/IntentOnly.XComMod       |
    And its warning mirrors the exact unsupported-target title, project file label, summary, remediation, and support identifier as one atomic accessible role "alert"
    And no configured, explicit, or explicit-configuration reason or authority remains
    And no XCOM Build, Problems, Logs, language support, project action, process execution, external-root authority, or bottom contribution exists
    Then throughout the next five seconds the exact unsupported-target warning, recognized high-confidence activity, open panel, and ordered evidence remain unchanged
    And no late stale configured decision, explicit authority, explicit-configuration reason, second activity entry, or XCOM bottom contribution appears
    And the actual ".ide/xcom2.json" bytes remain exactly the unsupported-target bytes specified above
    And both Option A descriptor files remain exact empty regular files
    And after application launch the only workspace filesystem mutations are the scenario owner's two exact external configuration replacements and exact external creation of those two descriptor files
    And throughout the scenario the application never creates, writes, reformats, or deletes the project configuration or Option A evidence files
