@not-implemented
Business Need: Real-engine RefactorKit integration in the IDE desktop daemon
  To run genuine RefactorKit semantic transformation under workspace authority with honest discovery,
  read-only preview, exact-plan apply, and advertised-only rollback
  A Java developer needs the IDE daemon to delegate to the real RefactorKit engine instead of a
  deterministic fixture peer, discover it honestly, preview read-only, apply only the exact reviewed
  plan under explicit authority, roll back only when the engine advertises that capability, and never
  present fixture orchestration as real-engine evidence.

Ability: Discover, preview, apply, and roll back through the real RefactorKit engine behind ports
  The desktop can discover a wrapper PATH or installed engine path, expose authoritative capability
  metadata, preview read-only with no write before explicit authority, apply a real transformation
  bound to the exact reviewed plan and approval, roll back only when advertised, and report honest
  availability while browser and desktop adapters expose the same capability behind ports and the web
  frontend never imports the Tauri API.

Feature: Real-engine delegation for discovery, preview, apply, and conditional rollback
  This operational requirement covers one coherent engine-integration slice: engine discovery and
  capability authority, read-only real-engine preview, exact-plan real apply under explicit approval,
  advertised-only rollback, honest outcomes, and evidence-based status for scan, symbols, definition,
  references, rename, rename member, extract method, and change signature. It is one feature source
  reused across browser and desktop profiles; profiles, worlds, adapters, or glue differences vary by
  platform and no competing feature source exists. Pure view-model decision behavior authorized here is
  Spec BDD; the operational Story is the behavioral backlog. Engine capability metadata is authoritative
  for support, and the deterministic in-process fixture peer remains only a fallback and harness and is
  never claimed as real-engine evidence.

  @REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-001 - Engine discovery yields authoritative capability and honest unavailability
    Given an authorized Java workspace and the RefactorKit engine is discoverable through a wrapper PATH or an installed engine path
    When the IDE daemon resolves the engine for the requested operational surface
    Then the daemon reports the real engine authoritative capability for scan, symbols, definition, references, rename, rename member, extract method, and change signature
    And the reported capability is correlated to the discovered engine, its version, and the workspace
    When neither the wrapper PATH nor an installed engine path is discoverable
    Then the IDE reports the engine capability honestly as unavailable
    And it neither fabricates an engine, a capability, a plan, nor a successful result from the fixture peer

  @REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-002 - Real-engine preview is read-only and correlated before any authority
    Given a real RefactorKit engine is discoverable and an exact semantic target is selected
    When the person requests a preview for a supported operation and target
    Then the provider returns one real-engine patch plan correlated to the operation, target, workspace authority, selection, request, and engine
    And no proposed project-content effect occurs before explicit authority
    And the preview grants no apply authority for the plan
    And the fixture peer may serve as a harness only and is never reported as real-engine preview evidence

  @REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-003 - Apply runs a real transformation bound to the exact plan and approval; rollback only when advertised
    Given the exact reviewed plan is still current against the workspace, selection, and request
    When the person gives explicit apply authority bound to that exact reviewed plan
    Then the provider runs the real engine transformation against that exact reviewed plan and current context rather than reconstructed source or UI-fabricated edits
    And a changed or replaced plan requires a fresh preview and review before any Apply
    When the provider reports a correlated transaction for the applied real plan
    Then the IDE reports the applied, refused, stale, failed, or indeterminate outcome honestly and never fabricates success
    When rollback is authoritatively advertised for the relevant transaction class
    Then rollback is exposed only for that advertised, transaction-bound compensating write
    And its restoration result, conflicts, changed files, and diagnostics are reported honestly
    When rollback is not advertised
    Then rollback is neither offered nor described as read-only, and no rollback success is inferred from a transaction ID, generic apply capability, or a visible control

  @REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-004 - Adapters extract, delegate, and respond with honest unavailable outcomes and a Tauri-free web boundary
    Given a real-engine request arrives at a browser or desktop adapter behind a provider-neutral port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the owned real-engine capability
    And the adapter returns the delegated response to the caller
    And the adapter contains no hidden domain policy, direct workspace mutation, or fabricated evidence
    When the engine is absent, its capability metadata is absent or unacceptable, or the operation is unsupported
    Then the IDE reports the capability honestly as unavailable
    And it neither fabricates a plan, successful result, nor fallback textual rewrite
    And a browser without a conforming browser provider reports the local RefactorKit engine capability as unavailable
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the capability is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And capability access to the real-engine capability is defined through ports, not platform APIs

  @REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-005 - Implementation status is evidence-based and live e2e may remain unvalidated headless
    Given meaningful RED precedes new product behavior for this feature
    When the feature file is parsed for requirement and status reconciliation
    Then the feature declares exactly one effective status "@not-implemented" at feature level
    And no scenario overrides that single effective status
    And the requirement ID "@REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001" is repository-unique and reconciled
    And contracts, shells, fixture orchestration, import Stories, diagnostics, or hard-coded/fake plans do not promote this status
    And deterministic fixture-peer evidence, real-engine semantic transformation, rollback restoration, live editor or native GUI wiring, packaging, and platform coverage are reported separately
    And fixture-peer fallback is never claimed as real-engine evidence
    And live e2e may remain unvalidated headless without silently upgrading the declared status
