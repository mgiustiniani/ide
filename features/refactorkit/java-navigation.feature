@not-implemented
Business Need: Java go-to-definition and references wired in the IDE editor
  To navigate Java source under workspace authority with honest resolution and reveal
  A Java developer needs a Java symbol by fully-qualified name to resolve its definition and its
  references through the RefactorKit engine or Java language capability, present them, and navigate or
  reveal the selected location in the editor, without fabricated results when the capability is absent
  or the symbol is unresolvable.

Ability: Resolve and reveal Java definitions and references through provider-neutral ports
  The desktop can resolve a Java symbol's definition (go-to-definition) and references (find-references)
  via the RefactorKit engine/java-language capability, present the results, navigate or reveal the
  selected location in the editor through the existing navigation driver, and report honest unavailable
  or error when the capability is absent or the symbol is unresolvable, while browser and desktop
  adapters expose the same capability behind ports and the web frontend never imports the Tauri API.

Feature: Java go-to-definition and references wired into the editor
  This functional requirement covers one coherent Java navigation slice: resolving a Java symbol
  definition (go-to-definition) and its references (find-references) via the RefactorKit engine
  (real_engine.rs definition/references commands) or the Java language capability, presenting results,
  navigating and revealing the selected location in the editor, and honest unavailable outcomes. It
  reuses the existing navigation infrastructure (useRefactorKitSymbolNavigationController plus
  documentNavigation.navigateToLocation and editor revealRequest) and does not rework the existing
  TypeScript/JavaScript saved-snapshot navigation. It is one feature source reused across browser and
  desktop profiles; profiles, worlds, adapters, or glue differences vary by platform and no competing
  feature source exists. Pure view-model decision behavior authorized here is Spec BDD; the operational
  Story is the behavioral backlog. RefactorKit engine capability metadata is authoritative for support,
  and real-engine existence is deferred to the integration moment and is not a slice gate. Live
  Tauri-window navigation E2E may remain unvalidated when headless and is recorded honestly; it never
  silently upgrades the declared status.

  @REQ-IDE-JAVA-NAVIGATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-001 - A Java symbol definition resolves and its location is revealed in the editor
    Given an authorized Java workspace and a Java symbol fully-qualified name is selected
    And the provider authoritatively advertises the Java definition capability for that workspace
    When the person requests go-to-definition for that Java symbol FQN
    Then the provider resolves one definition location correlated to the symbol FQN, the workspace authority, the request, and the provider
    And the IDE reveals the resolved location in the editor at the exact point reported by the provider coordinates
    And the reveal uses the existing navigation driver and editor revealRequest without fabricating a location

  @REQ-IDE-JAVA-NAVIGATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-002 - Java references resolve, are presented, and a selected reference navigates and reveals
    Given an authorized Java workspace and a Java symbol fully-qualified name is selected
    And the provider authoritatively advertises the Java references capability for that workspace
    When the person requests find-references for that Java symbol FQN
    Then the provider resolves the reference locations correlated to the symbol FQN, the workspace authority, the request, and the provider
    And the IDE presents the resolved references to the person
    When the person selects a presented reference
    Then the IDE navigates to and reveals that reference location in the editor at the exact point reported by the provider coordinates
    And the reveal uses the existing navigation driver and editor revealRequest without fabricating a location

  @REQ-IDE-JAVA-NAVIGATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-003 - Adapters use extract, delegate, and response with honest unavailable or error outcomes
    Given a Java navigation request arrives at a browser or desktop adapter behind a provider-neutral port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the owned Java definition or references capability
    And the adapter returns the delegated response to the caller
    And the adapter contains no hidden domain policy, direct workspace mutation, or fabricated evidence
    When the capability is absent, its capability metadata is absent or unacceptable, the operation is unsupported, or the symbol FQN is unresolvable
    Then the IDE reports the capability honestly as unavailable or the resolution honestly as an error
    And it neither fabricates a definition, a reference list, a successful result, nor a fallback textual rewrite
    And a browser without a conforming browser provider reports the local Java navigation capability as unavailable

  @REQ-IDE-JAVA-NAVIGATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-004 - The web frontend stays Tauri-free at the platform boundary
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the Java navigation capability is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And capability access to the Java navigation capability is defined through ports, not platform APIs

  @REQ-IDE-JAVA-NAVIGATION-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-005 - Implementation status is evidence-based and live e2e may remain unvalidated headless
    Given meaningful RED precedes new product behavior for this feature
    When the feature file is parsed for requirement and status reconciliation
    Then the feature declares exactly one effective status "@not-implemented" at feature level
    And no scenario overrides that single effective status
    And the requirement ID "@REQ-IDE-JAVA-NAVIGATION-001" is repository-unique and reconciled
    And contracts, shells, import Stories, diagnostics, or hard-coded/fake definition or reference results do not promote this status
    And real-engine definition/references resolution, live editor or native GUI wiring, packaging, and platform coverage are reported separately
    And live Tauri-window navigation E2E may remain unvalidated headless without silently upgrading the declared status
