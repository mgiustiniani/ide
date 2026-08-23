Business Need: Operational JetBrains-style Java language service in the IDE desktop
  To give Java developers reliable JDT language-server behavior: lifecycle, document sync,
  and Java intelligence, without trusting untrusted toolchain output
  People editing Java in the desktop IDE need a running Java language service with honest
  availability and cancellable, untrusted intelligence results.

Ability: Manage and query a Java language service through ports
  The desktop can spawn a JDT Language Server, track its lifecycle, sync versioned document
  text, and request completion, hover, and signature help through a JavaIntelligencePort,
  while browser and desktop adapters expose the same capability behind ports and the web
  frontend never imports the Tauri API.

Feature: Java language service lifecycle, document sync, and untrusted intelligence
  This characterization requirement covers the operational Java language service for one
  workspace. It is one feature source reused across browser and desktop profiles; profiles,
  worlds, adapters, or glue differences vary by platform and no competing feature source exists.
  JDT LS startup, lifecycle, document sync, and Java intelligence are already implemented by
  characterization; the feature is classified as characterization and its status is not yet
  promoted. Editor text editing, refactoring, and toolchain installation are outside its scope.

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement @not-implemented
  Scenario: AC-001 - The Java language service lifecycle is managed and availability is honest
    Given a workspace contains Java sources and a Java language service controller is wired
    And a JDT Language Server process can be spawned by the Rust backend
    When the person requests the Java language service status
    Then the controller reports a lifecycle status from "stopped", "starting", "running", or "stopping"
    When the person starts the Java language service
    Then the controller starts the JDT Language Server and reports "running" when ready
    When the person restarts the Java language service
    Then the controller restarts the JDT Language Server and reports a fresh "running" status
    When the person stops the Java language service
    Then the controller stops the JDT Language Server and reports "stopped"
    And lifecycle events are polled and observable through the poll-events channel
    When no JDT Language Server or JDK toolchain is discoverable
    Then the controller reports Java language service availability honestly as unavailable
    And it neither reports "running" nor fabricates a ready state

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement @not-implemented
  Scenario: AC-002 - Document sync keeps versioned full text and serves only ready documents
    Given the Java language service is running for the workspace
    When the person opens a Java document in the editor
    Then the controller syncs the open event with versioned full text to the language server
    When the person changes the Java document text
    Then the controller syncs the change event with the incremented version and full text
    When the person saves the Java document
    Then the controller syncs the save event for the current versioned text
    When the person closes the Java document
    Then the controller syncs the close event and drops the document
    When an intelligence request targets a document the language server has not fully synced
    Then the controller serves results only for ready documents and declines for not-ready ones

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement @not-implemented
  Scenario: AC-003 - Java intelligence is untrusted data and cancellable
    Given a ready Java document is open and the Java language service is running
    When the person requests completion for a position in the document
    Then the controller returns completion items through JavaIntelligencePort
    And the frontend treats those completion items as untrusted data and validates before use
    When the person requests hover for a symbol in the document
    Then the controller returns hover content through JavaIntelligencePort as untrusted data
    When the person requests signature help for a call site in the document
    Then the controller returns signature help through JavaIntelligencePort as untrusted data
    When an intelligence request is cancelled
    Then the controller cancels the in-flight request and stops awaiting the language server
    And no cancelled result is delivered to the editor

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement @not-implemented
  Scenario: AC-004 - Adapters use extract, delegate, and response with no hidden policy
    Given a Java intelligence request arrives at a browser or desktop adapter behind a port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the Java language service
    And the adapter returns the delegated response to the caller
    And the adapter contains no hidden domain policy or fabricated intelligence

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement @not-implemented
  Scenario: AC-005 - The web frontend stays Tauri-free at the platform boundary
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the Java language service is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And capability access to the Java language service is defined through ports, not platform APIs

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement @not-implemented
  Scenario: AC-006 - Implementation status is evidence-based and not promoted
    Given characterization steps and glue establish meaningful RED for this feature
    When the feature file is parsed for requirement and status reconciliation
    Then the feature declares exactly one effective status "@not-implemented" at feature level
    And no scenario overrides that single effective status
    And observed test evidence does not silently upgrade the declared status
    And the requirement ID "@REQ-IDE-JAVA-LANGUAGE-001" is repository-unique and reconciled
