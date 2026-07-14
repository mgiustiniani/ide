Business Need: Trusted RefactorKit diagnostics for TypeScript workspaces
  To correct TypeScript and JavaScript compiler errors without weakening workspace safety
  A TypeScript developer needs exact diagnostics in the IDE experiences already used for code problems.

  @desktop @REQ-REFACTORKIT-TS-001 @functional-requirement @non-functional-requirement @not-implemented
  Scenario: View trustworthy compiler diagnostics in the existing IDE problem surfaces
    Given a TypeScript developer has opened an authorized desktop workspace
    And RefactorKit 0.6.2 advertises compiler diagnostics for TypeScript and JavaScript
    When compiler diagnostics are requested for the current source snapshot
    Then the IDE respects all capability metadata advertised for that operation
    And diagnostics run only through a ready, qualified, and hash-bound RefactorKit 0.6.2 semantic toolchain
    And exact compiler diagnostics for the current authorized workspace appear in the existing Problems experience and Monaco editor diagnostics
    And results from a stale workspace, session, or source snapshot are rejected
    And unavailable or refused readiness is presented honestly in the existing Language Tooling UI
    But the diagnostic operation does not write to the workspace or execute project scripts
    And no fallback diagnostic output is shown
    And no TypeScript-specific panel is introduced
