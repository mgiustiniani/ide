Business Need: Settings-owned XCOM machine runtime lifecycle
  To prevent hidden or duplicated XCOM work before project activation exists
  Desktop users need XCOM machine setup monitoring and transactions to run only while Settings is open.

  This prerequisite defines only machine Settings runtime ownership; future XCOM project/module activation and its contextual contributions remain separate.
  Healthy machine evidence or completed machine setup does not activate a module.
  Traceability: FR-X2UI-000, FR-X2ARCH-007, and AT-X2-001.

  Eventual executable evidence is bounded to the production App, controllers, and typed Tauri adapters over a fake in-process Tauri command backend and fake timers.
  It makes no native GUI, real IPC, live Steam, real filesystem, application package, or installer claim.

  @REQ-XCOM2-MACHINE-SETTINGS-001 @desktop @tauri-harness @functional-requirement @non-functional-requirement @resource-lifecycle @resilience @not-implemented
  Scenario: Keep one bounded XCOM machine runtime exclusively owned by open Settings
    Given the deterministic desktop Tauri harness cold-starts the production App on generic non-XCOM workspace "generic-cold"
    And the harness drives the production controllers and typed Tauri adapters through a fake in-process Tauri command backend and fake timers
    And Settings is closed
    When that workspace becomes ready
    And the person switches to another generic non-XCOM workspace named "generic-switched" while Settings remains closed
    Then for both generic workspaces the backend records zero XCOM monitor snapshot or refresh calls
    And it records zero XCOM transaction history or detail calls
    And it records zero XCOM event-poll or subscription calls
    And neither workspace receives an XCOM activity or bottom contribution
    When the person opens machine Settings for "generic-switched"
    Then exactly one bounded XCOM monitor lifecycle and one bounded XCOM transaction lifecycle are active for the current workspace
    And each lifecycle owns only its corresponding subscription and poll timer
    And the backend obtains exactly one fresh XCOM monitor snapshot and exactly one XCOM transaction-history load for the current workspace
    And machine Settings adds no XCOM activity or bottom contribution and does not activate an XCOM module
    When the person requests one manual XCOM refresh
    Then the backend performs exactly one XCOM monitor refresh and exactly one additional XCOM transaction-history load
    And no duplicate lifecycle, poll timer, or subscription is created
    When the person closes Settings
    Then the XCOM monitor and transaction subscriptions and poll timers are cancelled
    When the fake clock advances by five configured monitor and transaction poll intervals
    Then the complete XCOM native-call transcript remains unchanged from the moment Settings closed
    When the person reopens machine Settings for "generic-switched"
    Then exactly one new bounded XCOM monitor lifecycle and one new bounded XCOM transaction lifecycle are active
    And all earlier lifecycle generations remain cancelled
    And the backend obtains exactly one new fresh XCOM monitor snapshot and exactly one new XCOM transaction-history load
    And no native call is duplicated by an earlier lifecycle generation
