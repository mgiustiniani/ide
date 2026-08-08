Business Need: Safe review and one-shot approval of an XCOM 2 project build recipe
  To make a future build deliberate without trusting project scripts as commands
  Desktop users need to inspect and approve one exact Default Build recipe before any execution capability exists.

  This Story starts only after a current authorized workspace has one active XCOM 2 module; it neither recognizes nor activates a module and is separate from Project Foundry.
  The contained project script remains untrusted input. Inspection derives bounded metadata from conventional contained files, but does not execute, rewrite, install, fetch, deploy, cook, or launch anything.
  The fixture for future acceptance must be sanitized and hand-authored from MIT X2ModBuildCommon concepts, retain an attribution notice, and contain no copied source, asset, or log material.
  Approval is volatile and one-shot. It is exact-recipe review authority only, not evidence of a successful build or authority to execute one.

  @REQ-XCOM2-PROJECT-BUILD-RECIPE-001 @desktop @tauri-harness @functional-requirement @non-functional-requirement @security @resilience @accessibility @not-implemented
  Scenario: Review and approve one exact blocked Default Build recipe without trusting or executing it
    Given the current authorized workspace has exactly one current active XCOM 2 module
    And the module and every file eligible for recipe inspection are regular, non-symlink entries contained by that authorized workspace
    And the module contains the conventional untrusted X2ModBuildCommon entry point at exact module-relative path ".scripts/build.ps1"
    And the bounded inspection fixture is sanitized, hand-authored, and derived only from MIT X2ModBuildCommon concepts with its required attribution notice
    And no source file, asset, log, proprietary game byte, proprietary SDK byte, or machine-local proprietary path has been copied into the fixture
    And inspection reads only this closed allowlist of conventional metadata categories from contained regular files:
      | metadata category                     | permitted derivation                                      |
      | active module descriptor              | module identity and source role                           |
      | untrusted build entry point            | script path, fingerprint, size, and declarative role inputs |
      | X2ModBuildCommon licensing evidence   | MIT provenance and applicable attribution notice         |
      | Highlander project dependency evidence | project-local source and Workshop runtime dependency      |
    And inspection never follows a symlink or enters a directory whose path contains one of these excluded segments:
      | excluded segment |
      | Content          |
      | Script           |
      | vendor           |
      | build            |
      | log              |
      | assets           |
    And inspection neither extends the activation-only ".ide/xcom2.json" schema nor requires or creates a build manifest
    And the browser reports project build recipe review unavailable without simulating inspection, approval, or success
    When the person opens the active module's accessible "Default Build recipe" review with the keyboard
    Then the review identifies the action by exact enum value "default"
    And it labels ".scripts/build.ps1" as untrusted project input that will not be executed by this review
    And it presents the script's exact module-relative path, lowercase SHA-256, and byte size as separate review fields
    And it presents X2ModBuildCommon provenance as MIT-licensed with the exact applicable attribution notice available in the review
    And it presents each invocation input as a structured role and value state rather than a raw command, shell fragment, or interpolated command line:
      | structured role       | required meaning                                      |
      | source-directory      | active module source input                           |
      | sdk-directory         | separately authorized machine prerequisite           |
      | game-directory        | separately authorized machine prerequisite           |
      | configuration         | X2ModBuildCommon Default configuration                |
      | build-prefix          | isolated pfx_copy prerequisite                        |
      | highlander-source     | project-local Highlander source dependency            |
      | highlander-runtime    | matching Workshop runtime dependency                  |
    And the recipe keeps Build, Deploy, Cook, and Launch as separate actions and approves none of the latter three
    And the recipe requires project-local Highlander source together with its matching Workshop runtime dependency rather than a global SDK source overlay
    And every machine-owned SDK, game, pfx_copy, tool, and runtime prerequisite remains explicitly unresolved
    And the accessible status states that native execution is unavailable and blocked for this slice
    And unresolved prerequisites remain visible by text and programmatic state without relying on color alone
    And the review exposes exactly one keyboard-focusable "Approve exact recipe" control and one "Discard" control
    And the exact recipe digest binds all of these reviewed facts:
      | bound fact                                           |
      | authorized workspace identity                        |
      | current workspace generation                         |
      | active module identity and contained module root     |
      | inspection generation                                |
      | script module-relative path                          |
      | script lowercase SHA-256 and byte size               |
      | MIT provenance and applicable attribution notice    |
      | action enum                                          |
      | ordered structured argument roles and value states  |
      | pfx_copy prerequisite state                          |
      | project-local Highlander source identity and state   |
      | Workshop runtime dependency identity and state       |
      | ordered unresolved prerequisite states               |
      | recipe schema version                                |
    And changing any bound fact requires a different digest and a new review
    When the person activates "Approve exact recipe"
    Then the approval control is disabled before exactly one approval request starts
    And the request contains only the exact recipe digest and its current bound identities, generations, fingerprints, provenance, action, structured roles, dependency states, and prerequisite states
    And the request contains no executable path chosen from project data, raw command, shell text, script bytes, proprietary bytes, proprietary path, output claim, or success claim
    And one volatile one-shot approval is retained only for that exact reviewed recipe
    And it can authorize at most one future "default" Build request and no Deploy, Cook, or Launch request
    And this slice exposes no consumer that can execute or consume the approval as a build
    And the accessible result states "Recipe approved; execution remains unavailable"
    And it does not state or imply that Build, Deploy, Cook, Launch, installation, or validation succeeded
    When the person attempts to approve the same displayed recipe again
    Then no second approval request occurs
    And no process, network, SDK, game, or prefix access has occurred:
      | access boundary                     | observed count |
      | project script invocation           | 0              |
      | shell or other process invocation   | 0              |
      | network request                      | 0              |
      | SDK filesystem access               | 0              |
      | game filesystem access              | 0              |
      | Steam-managed prefix access         | 0              |
      | pfx_copy access                     | 0              |
    And no workspace, module, script, configuration, manifest, approval receipt, SDK, game, prefix, deployment, cooked output, launch state, or other filesystem write or mutation has occurred
    And no Build, Deploy, Cook, or Launch action has occurred
    When each of these changes is considered before any future use of the approval:
      | revocation cause                                            |
      | explicit Workspace Refresh                                  |
      | authorized workspace change or workspace switch            |
      | workspace generation change                                 |
      | active module removal, replacement, root change, or switch  |
      | script path, SHA-256, byte size, or entry type change       |
      | X2ModBuildCommon provenance or attribution notice change    |
      | inspected conventional metadata change                      |
      | pfx_copy, Highlander source, or Workshop dependency change  |
      | any other recipe-bound fact change                          |
    Then the volatile one-shot approval is synchronously revoked before stale work can use it
    And a revoked approval cannot be restored or reused without a fresh inspection, review, and approval
    And browser support and native execution remain honestly unavailable rather than returning a fake successful result
