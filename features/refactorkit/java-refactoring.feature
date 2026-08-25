@not-implemented
Business Need: Operational RefactorKit Java refactoring in the IDE desktop
  To transform Java under workspace authority with preview, apply, and honest rollback
  A Java developer needs one reviewed RefactorKit refactoring proposal to be previewed read-only,
  applied only against the exact reviewed plan with explicit authority, and rolled back only when the
  provider advertises that capability, without fabricated success.

Ability: Preview, apply, and roll back Java refactorings through provider-neutral ports
  The desktop can request a capability-advertised Java refactoring preview, present the immutable
  reviewed plan, apply it under explicit authority, discard or conditionally roll it back, and report
  honest availability, while browser and desktop adapters expose the same capability behind ports and
  the web frontend never imports the Tauri API.

Feature: Read-only preview, exact-plan apply, and conditional rollback for RefactorKit Java refactorings
  This operational requirement covers one coherent Java refactoring slice: capability discovery,
  target-bound preview/review, discard, exact-plan Apply, conditional Rollback, and honest outcomes for
  rename class, rename member, rename local variable, move class, change method signature, and safe delete.
  Extract Method and Organize Imports are out of scope. It is one feature source reused across browser and
  desktop profiles; profiles, worlds, adapters, or glue differences vary by platform and no competing
  feature source exists. Pure view-model decision behavior authorized here is Spec BDD; the operational
  Story is the behavioral backlog. RefactorKit daemon capability metadata is authoritative for support, and
  generic apply/rollback infrastructure or import Stories are foundations, not completion. Real-engine
  existence is deferred to the integration moment and is not a slice gate.

  @REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-001 - A refactoring preview is read-only and grants no apply authority
    Given an authorized Java workspace and an exact semantic target are selected
    And the provider authoritatively advertises the requested Java refactoring operation
    When the person requests a preview for that operation and target
    Then the provider returns one immutable patch plan correlated to the operation, target, workspace authority, selection/request, and provider
    And the review identifies the proposed effects as create, edit, move, or delete with available diff, warnings, diagnostics, risks, conflicts, blockers, eligibility, and staleness evidence
    And no proposed project-content effect occurs before explicit authority
    And the preview grants no apply authority for the plan

  @REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-002 - Apply binds to the exact reviewed plan under explicit authority, rollback only when advertised
    Given the exact reviewed plan is still current against the workspace, selection, and request
    When the person gives explicit apply authority bound to that exact reviewed plan
    Then the provider receives the plan authority rather than reconstructed Java source or UI-fabricated edits
    And Apply occurs only for that exact reviewed plan and current context
    And a changed or replaced plan requires a fresh preview and review before any Apply
    When the provider reports a correlated transaction for the applied plan
    Then the IDE reports the applied, refused, stale, failed, or indeterminate outcome honestly
    When rollback is authoritatively advertised for the relevant transaction class
    Then rollback is exposed only for that advertised, transaction-bound compensating write
    And its restoration result, conflicts, changed files, and diagnostics are reported honestly
    When rollback is not advertised
    Then rollback is neither offered nor described as read-only, and no rollback success is inferred from a transaction ID, generic apply capability, or a visible control

  @REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-003 - Adapters use extract, delegate, and response with honest unavailable outcomes
    Given a Java refactoring request arrives at a browser or desktop adapter behind a provider-neutral port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the owned capability
    And the adapter returns the delegated response to the caller
    And the adapter contains no hidden domain policy, direct workspace mutation, or fabricated evidence
    When the provider is absent, its capability metadata is absent or unacceptable, or the operation is unsupported
    Then the IDE reports the capability honestly as unavailable
    And it neither fabricates a plan, successful result, nor fallback textual rewrite
    And a browser without a conforming browser provider reports the local RefactorKit capability as unavailable

  @REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-004 - The web frontend stays Tauri-free at the platform boundary
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the Java refactoring capability is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And capability access to the refactoring capability is defined through ports, not platform APIs

  @REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-005 - Implementation status is evidence-based and live e2e may remain unvalidated headless
    Given meaningful RED precedes new product behavior for this feature
    When the feature file is parsed for requirement and status reconciliation
    Then the feature declares exactly one effective status "@not-implemented" at feature level
    And no scenario overrides that single effective status
    And the requirement ID "@REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001" is repository-unique and reconciled
    And contracts, shells, import Stories, diagnostics, or hard-coded/fake plans do not promote this status
    And deterministic fixture orchestration, real-engine semantic transformation, rollback restoration, live editor or native GUI wiring, packaging, and platform coverage are reported separately
    And live e2e may remain unvalidated headless without silently upgrading the declared status
