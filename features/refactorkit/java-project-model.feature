@not-implemented
Business Need: Java project model presented in the IDE by consuming RefactorKit
  To present the Java project structure under workspace authority with honest availability
  A Java developer needs the packages, classes, and symbols of a Java workspace presented as a
  project model, sourced from the RefactorKit engine scan and symbols commands, so the IDE can show
  the project structure without fabricating a model when the engine is absent or the scan fails.

Ability: Present packages, classes, and symbols from the RefactorKit engine scan through provider-neutral ports
  The desktop can request the RefactorKit engine symbols scan for a Java workspace root, present the
  packages/classes/symbols from the engine result as the project model, and report honest unavailable
  or error when the engine is absent or the scan fails, while browser and desktop adapters expose the
  same capability behind ports and the web frontend never imports the Tauri API.

Feature: Java project model presented in the IDE by consuming RefactorKit
  This functional requirement covers one coherent Java project-model slice: given a Java workspace
  root, the IDE requests the RefactorKit engine symbols scan (real_engine.rs run_engine_scan /
  run_engine_symbols delegating the real CLI `refactorkit scan <path>` / `refactorkit symbols <path>`,
  workspace_registry.rs workspace_id_for_path) and presents the packages/classes/symbols from the
  engine result as the project model, with honest unavailable/error when the engine is absent or the
  scan fails. It follows the prior decision (obs 2026-07-11): the Java project model stays INSIDE
  RefactorKit as an internal, modular component; there is NO standalone project-model kit and the IDE
  is a consumer, not a reimplementation. It is one feature source reused across browser and desktop
  profiles; profiles, worlds, adapters, or glue differences vary by platform and no competing feature
  source exists. Pure view-model decision behavior authorized here is Spec BDD; the operational Story
  is the behavioral backlog. RefactorKit engine capability metadata is authoritative for support, and
  real-engine existence is deferred to the integration moment and is not a slice gate. Live
  Tauri-window project-model E2E may remain unvalidated when headless and is recorded honestly; it
  never silently upgrades the declared status.

  @REQ-IDE-JAVA-PROJECT-MODEL-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-001 - The IDE requests the engine symbols scan and presents the project model from the engine result
    Given an authorized Java workspace with a workspace root is presented in the IDE
    And the provider authoritatively advertises the Java project-model capability for that workspace
    When the IDE requests the RefactorKit engine symbols scan for that workspace root
    Then the engine returns packages, classes, and symbols correlated to the workspace authority, the request, and the provider
    And the IDE presents the packages, classes, and symbols from the engine result as the project model
    And the project model is not fabricated, reimplemented, or sourced from a standalone kit

  @REQ-IDE-JAVA-PROJECT-MODEL-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-002 - The IDE reports honest unavailable or error and never fabricates a project model
    Given an authorized Java workspace with a workspace root is presented in the IDE
    When the engine is absent or the engine symbols scan fails for that workspace root
    Then the IDE reports the project-model capability honestly as unavailable or the scan honestly as an error
    And it neither fabricates a project model, a package/class/symbol list, a successful result, nor a fallback textual rewrite
    And a browser without a conforming browser provider reports the local Java project-model capability as unavailable

  @REQ-IDE-JAVA-PROJECT-MODEL-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-003 - Adapters use extract, delegate, and response with no hidden domain policy
    Given a Java project-model request arrives at a browser or desktop adapter behind a provider-neutral port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the owned RefactorKit scan or symbols capability
    And the adapter returns the delegated engine response to the caller
    And the adapter contains no hidden domain policy, no standalone project-model kit, and no reimplementation of the model
    And the project model comes from RefactorKit and is never produced by the IDE itself

  @REQ-IDE-JAVA-PROJECT-MODEL-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-004 - The web frontend stays Tauri-free at the platform boundary
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the Java project-model capability is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And browser and desktop project-model implementations live behind frontend ports, not platform APIs

  @REQ-IDE-JAVA-PROJECT-MODEL-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-005 - Implementation status is evidence-based and live e2e may remain unvalidated headless
    Given meaningful RED precedes new product behavior for this feature
    When the feature file is parsed for requirement and status reconciliation
    Then the feature declares exactly one effective status "@not-implemented" at feature level
    And no scenario overrides that single effective status
    And the requirement ID "@REQ-IDE-JAVA-PROJECT-MODEL-001" is repository-unique and reconciled
    And contracts, shells, import Stories, diagnostics, or hard-coded/fake packages, classes, or symbols do not promote this status
    And real-engine scan/symbols resolution, live editor or native GUI wiring, packaging, and platform coverage are reported separately
    And live Tauri-window project-model E2E may remain unvalidated headless without silently upgrading the declared status
