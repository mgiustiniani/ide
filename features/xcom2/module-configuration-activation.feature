Business Need: Explicit XCOM 2 module activation through portable project configuration
  To let a project owner activate recognition without manufacturing convention evidence
  Desktop users need a bounded workspace configuration to control a recognition-only XCOM project contribution.

  This Story implements only ADR 0007's approved activation-only `.ide/xcom2.json` v1 scope and does not change the existing convention-recognition Story.
  Traceability: FR-X2CFG-001, FR-X2CFG-003, FR-X2PRJ-001, FR-X2UI-001, FR-X2UI-005, FR-X2ARCH-001, FR-X2ARCH-002, FR-X2ARCH-003, FR-X2ARCH-007, NFR-X2SEC-001, NFR-X2SEC-004, NFR-X2REL-002, AT-X2-001, AT-X2-015, AT-X2-017, and new configured-activation acceptance AT-X2-026.

  Eventual native evidence is bounded to a scenario-owned sandbox filesystem and the production Linux X11 Tauri release/no-bundle WebKit DOM at an asserted 1440x900 viewport.
  The fixture contains no proprietary content, and configured roots remain regular, non-symlink paths contained within the current authorized workspace.
  It makes no Git-synchronization or configuration-watcher capability claim and no application-package, Wayland, other operating-system, or DPI-behavior claim.
  Browser behavior is unchanged and outside this native Story.
  It also makes no module-content parsing, external-root, machine-correctness, or contextual XCOM tool claim.

  @REQ-XCOM2-MODULE-CONFIGURATION-ACTIVATION-001 @desktop @native-gui @functional-requirement @non-functional-requirement @security @resilience @accessibility @implemented-and-validated
  Scenario: Activate and explicitly refresh one configured recognition-only module
    Given one scenario sandbox owns all desktop user state and an actual workspace registry with exactly these authorized workspaces:
      | workspace       | initial role                  |
      | plain-notes     | generic workspace             |
      | configured-wotc | explicitly configured module |
    And the actual "plain-notes" workspace contains only these ordinary regular files:
      | relative path       |
      | README.md           |
      | notes/reference.txt |
    And "plain-notes" contains no XCOM convention evidence and no ".ide/xcom2.json" configuration
    And the actual "configured-wotc" workspace contains no XCOM convention evidence
    And its actual "mods/IntentOnly" path is an empty regular directory
    And its actual regular file ".ide/xcom2.json" has exactly these UTF-8 bytes:
      """
      {"version":1,"target":"wotc","moduleRoots":["mods/IntentOnly"]}
      """
    And the configured module root and all its containing directories are non-symlink directories contained within the authorized "configured-wotc" workspace
    When a freshly built production release/no-bundle Tauri executable is launched directly on Linux X11 for "plain-notes"
    And its WebKit DOM viewport is exactly 1440x900
    Then within 15 seconds the generic workspace is ready
    And it has no "XCOM 2 Project" activity entry, recognition panel, or XCOM bottom contribution
    When the person uses the real Settings workspace controls to switch to "configured-wotc"
    Then within 15 seconds the configured workspace is ready
    And exactly one accessible activity entry named "XCOM 2 Project" appears
    And that activity entry has a keyboard-focusable control with the accessible name "XCOM 2 Project"
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
    And no configuration or scan issue is shown
    And configuration grants no XCOM Build, Problems, Logs, language support, project action, process execution, external-root authority, or bottom contribution
    When the scenario owner removes the actual ".ide/xcom2.json" file externally without using the application
    Then throughout the next one second the activity entry and its exact open recognition panel remain unchanged
    And the application performs no configuration watch or poll refresh
    When the person invokes the actual "Workspace Refresh" control
    Then the activity entry and recognition panel are synchronously revoked before Workspace Refresh reports completion
    And no late stale "XCOM 2 Project" activity entry, recognition panel, or XCOM bottom contribution reappears during the next five seconds
    When the scenario owner externally restores ".ide/xcom2.json" with the exact UTF-8 bytes specified above
    And the person invokes the actual "Workspace Refresh" control
    Then within 15 seconds exactly one keyboard-accessible "XCOM 2 Project" activity entry and its exact previously specified panel fields and ordered reason are restored
    And no configuration or scan issue is shown
    When the person uses the real Settings workspace controls to switch back to "plain-notes"
    Then the "XCOM 2 Project" activity entry and recognition panel are removed synchronously with the committed workspace change before generic content is presented
    And the generic workspace has no XCOM bottom contribution
    And the restored actual ".ide/xcom2.json" bytes remain exactly unchanged
    And throughout the scenario the application never creates, writes, reformats, or deletes ".ide/xcom2.json"; only the scenario owner's external removal and restoration change it
    And the configured module root and all its containing directories remain non-symlink directories contained within the authorized "configured-wotc" workspace
