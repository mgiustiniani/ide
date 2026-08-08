Business Need: Trusted RefactorKit diagnostics for TypeScript workspaces
  To correct TypeScript and JavaScript compiler errors without weakening workspace safety
  A TypeScript developer needs exact diagnostics in the IDE experiences already used for code problems.
  This approved exception accepts a source-built RefactorKit 0.7.0-SNAPSHOT under bounded provenance and workspace-audit evidence; it does not claim a released provider.

  @desktop @REQ-REFACTORKIT-TS-001 @functional-requirement @non-functional-requirement @not-implemented
  Scenario: View trustworthy compiler diagnostics in the existing IDE problem surfaces
    Given a TypeScript developer has opened an authorized desktop workspace
    And the approved source-built RefactorKit 0.7.0-SNAPSHOT advertises diagnostics.v2 for TypeScript and JavaScript
    And that snapshot is bound to accepted exact-source, clean-build, executable, compiler-process, and bounded workspace-audit evidence
    When compiler diagnostics are requested for the current source snapshot
    Then the IDE retains and enforces all capability metadata advertised for diagnostics.v2
    And the request and every response use schema version 2 with the same operation and request identity
    And processing continues only for a structured ready status, while a structured refused or error status stops it
    And diagnostics run only through the exact compiler backend and attestation accepted for that source-built snapshot
    And every accepted diagnostic preserves the exact compiler result and exact UTF-16 source range
    And every status and diagnostic response matches the current workspace, workspace generation, semantic session, source snapshot, semantic lease, and source authority
    And stale or mismatched status and diagnostic results are rejected before they can replace current IDE state
    And only complete responses within the advertised runtime and response bounds are accepted
    And exact compiler diagnostics for the current authorized workspace appear in the existing Problems experience and Monaco editor diagnostics
    And checking, ready, refused, and error states are presented honestly in the existing Language Tooling UI
    But the diagnostic operation does not write to the workspace or execute project scripts
    And no fallback diagnostic output is shown
    And no TypeScript-specific panel is introduced
