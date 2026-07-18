Business Need: Honest native XCOM machine Settings when Steam products are missing
  To understand why XCOM machine setup cannot proceed without exposing local machine details
  Desktop users need the native Settings monitor to present a complete, safe missing-Steam state.

  This Story is the native UI-only acceptance target approved by ADR 0007 and does not supersede the harness-only machine Settings runtime requirement.
  Traceability: FR-X2UI-000, FR-X2ARCH-007, and AT-X2-028.

  Eventual evidence is bounded to one fresh production Linux X11 Tauri release/no-bundle process, its WebKit DOM at an asserted 1440x900 viewport, and only the rendered accessible UI reached through the visible Settings controls.
  The unmodified application uses its real Tauri/Rust path; acceptance uses no IPC interception, monkeypatch, hook, instrumentation, transcript, call counting, fake timer, or supplied Steam fixture.
  It makes no browser, Wayland, other-operating-system, other-DPI, application-package, bundle, installer, live-Steam, or machine-correctness claim.
  It also makes no refresh or reopen, Plan Setup or canPlan, transaction, project activity or tool, polling or subscription lifecycle, post-launch filesystem identity, or mutation claim.
  After launch the scenario performs no filesystem mutation before ordinary post-exit sandbox cleanup.

  @REQ-XCOM2-MACHINE-SETTINGS-MISSING-STEAM-001 @desktop @native-gui @functional-requirement @non-functional-requirement @security @accessibility @implemented-and-validated
  Scenario: Present a safe complete missing-Steam state in native XCOM machine Settings
    Given one scenario-owned sandbox contains these distinct empty locations before application launch:
      | environment binding or resource | empty scenario-owned location |
      | HOME                            | home                          |
      | XDG_CONFIG_HOME                 | xdg/config                    |
      | XDG_CACHE_HOME                  | xdg/cache                     |
      | XDG_DATA_HOME                   | xdg/data                      |
      | XDG_STATE_HOME                  | xdg/state                     |
      | XDG_RUNTIME_DIR                 | xdg/runtime                   |
      | IDE_HOME                        | ide-home                      |
      | authorized generic workspace    | generic-workspace             |
    When a freshly built production release/no-bundle Tauri executable is launched directly on Linux X11 for the authorized generic workspace
    And its production WebKit DOM viewport is exactly 1440x900
    Then the generic workspace becomes ready in that fresh process
    When the person activates the visible "Settings" control
    Then an accessible modal dialog named "Settings" is visible
    When the person uses the "Settings sections" navigation and selects the tab with label "XCOM 2" and description "Global machine setup"
    Then the "XCOM 2" tab is selected
    And the selected section presents the accessible heading "XCOM 2 WOTC Setup"
    And it presents the exact badge "Built-in · Experimental"
    And it presents a focusable scroll region named "XCOM 2 setup monitor details"
    And that region contains one note with exactly "Steam products not found. Steam may be unavailable, or no monitored app manifests were discovered."
    And "Aggregate setup state" shows exactly:
      | field                      | value                               |
      | Overall state              | Not Found                           |
      | Warnings                   | No warnings reported                |
      | Steam discovery provenance | Unknown (path redacted)             |
    And its ordered setup blockers are exactly:
      | position | blocker                                                                         |
      | 1        | XCOM 2 download or installation is incomplete                                  |
      | 2        | XCOM 2 is not stable                                                            |
      | 3        | XCOM 2: War of the Chosen Development Tools download or installation is incomplete |
      | 4        | XCOM 2: War of the Chosen Development Tools is not stable                      |
    And "Monitored Steam products" contains exactly these product cards:
      | product                                             | Steam AppID | role                        | accessible lifecycle |
      | XCOM 2                                              | 268500      | Required                    | Not Found            |
      | XCOM 2: War of the Chosen Development Tools         | 602410      | Required                    | Not Found            |
      | XCOM 2 Development Tools                            | 299990      | Related / optional evidence | Not Found            |
    And each product card shows exactly this presentation-safe missing-product detail:
      | field                         | value                              |
      | Download progress             | Progress unknown                   |
      | Download bytes                | Unknown downloaded / Unknown total |
      | Staging progress              | Progress unknown                   |
      | Staging bytes                 | Unknown staged / Unknown total     |
      | StateFlags                    | Not reported                       |
      | Size on disk                  | Unknown                            |
      | Install directory present     | No                                 |
      | Download directory present    | No                                 |
      | Last update                   | No manifest found                  |
      | Completeness                  | Incomplete                         |
      | Completeness evidence         | Steam appmanifest was not found    |
      | Stability                     | Unstable                           |
      | Stability evidence            | Product state is unavailable       |
      | Mutation                      | Blocked                            |
    And each product card shows exactly these ordered safe mutation reasons:
      | position | reason                                  |
      | 1        | Product is unavailable                  |
      | 2        | This built-in monitor is read-only      |
    And no product card presents manifest provenance or any manifest, install, download, or other local filesystem path
    When the person closes the native window after collecting the rendered evidence
    Then the executable exits cleanly
    And scenario cleanup releases its Linux X11 resources and removes the scenario-owned sandbox
