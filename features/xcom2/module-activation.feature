Business Need: Conservative XCOM 2 module activation
  To avoid presenting project tooling for unrelated or ambiguous workspaces
  Desktop users need an XCOM project contribution to follow only credible, workspace-authorized module evidence.

  This first Story covers recognition only, retains ADR 0007 Option A, and keeps XCOM machine setup evidence independent of project activation.
  Traceability: FR-X2PRJ-001, FR-X2UI-001, FR-X2ARCH-007, NFR-X2SEC-001, the non-XCOM workspace subset of AT-X2-001, AT-X2-015, and the stale-switch subset of AT-X2-017.

  Native validation evidence is bounded to the actual sandbox filesystem and the production Linux X11 Tauri release/no-bundle WebKit DOM at an asserted 1440x900 viewport.
  Recognition uses exact-case Linux paths and accepts only regular, non-symlink evidence within the current authorized workspace root.
  It makes no application package, Wayland, other operating-system, or DPI-behavior claim.
  It also makes no claim about proprietary project compatibility, content parsing, external roots, explicit configuration or manual confirmation, machine setup correctness, or build or language capability.

  @REQ-XCOM2-MODULE-ACTIVATION-001 @desktop @native-gui @functional-requirement @non-functional-requirement @security @resilience @accessibility @implemented-and-validated
  Scenario: Contribute recognition only while credible XCOM module evidence is current
    Given one scenario sandbox owns all desktop user state and an actual workspace registry with exactly these authorized workspaces:
      | workspace            | initial role                         |
      | xcom-reference-notes | generic workspace                    |
      | ambiguous-wotc       | one-kind ambiguous XCOM evidence     |
      | credible-wotc        | corroborated XCOM module evidence    |
    And the actual "xcom-reference-notes" workspace contains only these ordinary regular files:
      | relative path       |
      | README.md           |
      | notes/reference.txt |
    And the actual "ambiguous-wotc" workspace contains only this exact regular file:
      | relative path                    |
      | mods/Maybe/Config/XComEngine.ini |
    And the actual "credible-wotc" workspace contains exactly these regular files:
      | relative path                                                                  |
      | mods/CovertOps/CovertOps.x2proj                                                 |
      | mods/CovertOps/CovertOps.XComMod                                                |
      | mods/CovertOps/Config/XComEngine.ini                                            |
      | mods/CovertOps/Src/CovertOps/Classes/X2DownloadableContentInfo_CovertOps.uc     |
    And every listed path and containing directory has that exact Linux case and no workspace path is a symlink
    When a freshly built production release/no-bundle Tauri executable is launched directly on Linux X11 for "xcom-reference-notes"
    And its WebKit DOM viewport is exactly 1440x900
    Then within 15 seconds the generic workspace is ready
    And it has no "XCOM 2 Project" activity entry or XCOM bottom contribution
    When the person uses the real Settings workspace controls to switch to "ambiguous-wotc"
    Then within 15 seconds the ambiguous workspace is ready
    And it has no "XCOM 2 Project" activity entry or XCOM bottom contribution
    And machine setup evidence visible in Settings remains machine-scoped and does not activate the workspace
    When the person uses the real Settings workspace controls to switch to "credible-wotc"
    Then within 15 seconds exactly one accessible activity entry named "XCOM 2 Project" appears
    And that activity entry has a keyboard-focusable control with the accessible name "XCOM 2 Project"
    When the person opens "XCOM 2 Project" with the keyboard
    Then its recognition panel shows exactly:
      | field        | value                                                                                       |
      | module root  | mods/CovertOps                                                                                |
      | state        | active                                                                                       |
      | confidence   | high                                                                                         |
      | completeness | complete                                                                                     |
      | limitation   | Recognition only: no Build, Problems, Logs, language support, actions, or bottom contribution. |
    And its ordered evidence list is exactly:
      | kind                | workspace-relative path                                                    |
      | x2proj              | mods/CovertOps/CovertOps.x2proj                                             |
      | xcommod             | mods/CovertOps/CovertOps.XComMod                                            |
      | engine-config       | mods/CovertOps/Config/XComEngine.ini                                        |
      | unrealscript-layout | mods/CovertOps/Src/CovertOps/Classes/X2DownloadableContentInfo_CovertOps.uc |
    And no scan issue is shown
    And the active module contributes no XCOM Build, Problems, Logs, language support, project action, or bottom contribution
    When the person uses the real Settings workspace controls to switch back to "xcom-reference-notes"
    Then the "XCOM 2 Project" activity entry and recognition panel are removed synchronously with the committed workspace change before generic content is presented
    And the generic workspace has no XCOM bottom contribution
    And no late "XCOM 2 Project" activity entry, recognition panel, or XCOM bottom contribution reappears during the five seconds after the generic workspace is ready
