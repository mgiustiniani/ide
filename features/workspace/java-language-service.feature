@partial
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
  JDT LS startup, lifecycle, document sync, and Java intelligence are implemented. Deterministic
  production-adapter scenarios cover lifecycle, synchronization, cancellation, and browser
  boundaries; a Linux native GUI scenario verifies diagnostics, completion with a same-document
  import edit, hover, signature help, references, definition navigation, and JDT LS callers/callees
  with declaration and call-site navigation for one basic Java project, plus JDT LS import and preview-pattern semantics for
  one Maven Java 27 fixture. A focused native GUI scenario also verifies that Search Everywhere
  combines file, Java-symbol, and project-text results and navigates to the selected Java symbol.
  The native scenario also verifies that reference and definition navigation leave saved source
  unchanged and that both Java drafts survive a JDT LS restart. The requirement is partial because
  full native lifecycle and cancellation, effective Maven and Gradle project-context sync, installers,
  and other operating systems remain unqualified. Editor text editing, refactoring, and toolchain
  installation are outside its scope.

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @native-gui @native-java-preview-incompatible @story-bdd @functional-requirement
  Scenario: An incompatible preview compiler cannot report a clean Java file
    Given the native Java 26 preview-import GUI has an isolated Java project and installed JDT LS
    When the person opens Java 26 preview with a Java 27 JDT compiler
    Then Problems explains the unsupported preview without claiming successful diagnostics
    When the person saves compatible project compiler options and refreshes JDT LS
    Then real diagnostics recover without restarting the service or saving the Java draft
    When the person stops JDT LS and closes the Java 26 preview-import IDE
    Then the Java 26 preview fixture is preserved and the native IDE exits cleanly

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement
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

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement
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

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement
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

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-004 - Adapters use extract, delegate, and response with no hidden policy
    Given a Java intelligence request arrives at a browser or desktop adapter behind a port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the Java language service
    And the adapter returns the delegated response to the caller
    And the adapter contains no hidden domain policy or fabricated intelligence

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-005 - The web frontend stays Tauri-free at the platform boundary
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the Java language service is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And capability access to the Java language service is defined through ports, not platform APIs

  @REQ-IDE-JAVA-LANGUAGE-001 @java @desktop @story-bdd @functional-requirement
  Scenario: AC-006 - Implementation status reflects verified scope
    When the Java language feature is parsed for status and requirement reconciliation
    Then the feature declares exactly one effective status "@partial" at feature level
    And no scenario declares a conflicting status override
    And the requirement ID "@REQ-IDE-JAVA-LANGUAGE-001" is repository-unique and reconciled

  @REQ-IDE-JAVA-LANGUAGE-001 @native-java-language-intelligence @java @desktop @native-gui @e2e @functional-requirement
  Scenario: AC-007 - Java diagnostics and intelligence reach the native editor
    Given the native Java language-intelligence GUI has an isolated Java project and installed JDT LS
    When the person starts JDT LS and opens the Java language-intelligence source
    When the person reloads the WebView and verifies Java hover after an edited revision
    When the person opens a Java source with an unresolved type
    Then the Problems view presents the JDT LS diagnostic without changing saved source
    When the person requests hover for the Java field
    Then Monaco presents the JDT LS field hover without changing saved source
    When the person requests signature help at a Java method call
    Then Monaco presents the JDT LS method signature without changing saved source
    When the person requests Java member completion after a String receiver
    Then Monaco presents the JDT LS completion item without changing saved source
    When the person accepts a type completion that requests a Java import
    Then Monaco applies the completed type and import to the unsaved Java source
    When the person uses the editor shortcut to search for Java references at the repeat method
    Then the panel lists the JDT LS declaration and call, opens the call site, and leaves the source unsaved
    When the person inspects JDT LS callers and calls made for Java methods
    Then the panel shows JDT LS callers and callees, opens a call site, and preserves saved source
    When the person opens Java Structure from Commands and selects a filtered method
    Then Java Structure preserves the hierarchy, exact declaration cursor, and unsaved source
    When the person uses the JDT LS editor shortcut at a Java call site
    Then the panel opens the JDT LS declaration and preserves saved source
    When the person restarts JDT LS with an unsaved Java draft
    Then JDT LS returns to ready and both Java drafts remain unchanged
    When the person restores the Java source, stops JDT LS, and closes the IDE
    Then the Java language-intelligence project is restored and the native application exits cleanly

  @REQ-IDE-JAVA-LANGUAGE-001 @native-java-templates @java @desktop @native-gui @e2e @functional-requirement
  Scenario: AC-008 - Java typing templates expand in the native editor
    Given the native Java language-intelligence GUI has an isolated Java project and installed JDT LS
    When the person starts JDT LS and opens the Java language-intelligence source
    When the person expands the Java standard-output template
    Then Monaco expands the Java template at its placeholder and keeps the source unsaved
    When the person expands the Java main-method template
    Then Monaco expands the Java main-method template and keeps the source unsaved
    When the person expands the remaining Java typing templates
    Then Monaco expands the remaining Java typing templates without saving their source
    Then Monaco advances through the counted-loop snippet placeholders with Tab after dismissing Java completions, keeping the source unsaved
    When the person restores the Java source, stops JDT LS, and closes the IDE
    Then the Java language-intelligence project is restored and the native application exits cleanly

  @REQ-IDE-JAVA-LANGUAGE-001 @native-java-language-intelligence @native-java27-preview @java @desktop @native-gui @e2e @functional-requirement
  Scenario: AC-009 - Maven Java 27 preview source resolves in the native editor
    Given the native Java 27 preview-import GUI has an isolated Maven project and installed JDT LS
    When the person starts JDT LS and opens the Maven Java 27 preview source
    Then Monaco resolves Java 27 preview switch and instanceof patterns, hovers both pattern variables, and reports no source errors
    When the person stops JDT LS and closes the Java 27 preview-import IDE
    Then the Maven Java 27 preview fixture is preserved and the native IDE exits cleanly

  @REQ-IDE-JAVA-LANGUAGE-001 @native-java-language-intelligence @native-java26-preview @java @desktop @native-gui @e2e @functional-requirement
  Scenario: AC-012 - Java 26 primitive patterns resolve in the native editor
    Given the native Java 26 preview-import GUI has an isolated Java project and installed JDT LS
    When the person starts JDT LS and opens the Java 26 primitive-pattern source
    Then Monaco resolves the Java 26 primitive patterns without source errors while reporting an unrelated missing type
    When the person stops JDT LS and closes the Java 26 preview-import IDE
    Then the Java 26 preview fixture is preserved and the native IDE exits cleanly

  @REQ-IDE-JAVA-LANGUAGE-001 @native-java-language-intelligence @native-java-search-everywhere @java @desktop @native-gui @e2e @functional-requirement
  Scenario: AC-010 - Search Everywhere combines file, Java symbol, and project text results
    Given the native Java language-intelligence GUI has an isolated Java project and installed JDT LS
    When the person starts JDT LS and opens the Java language-intelligence source
    When the person searches for Completion in Search Everywhere
    Then Search Everywhere presents the matching file, Java symbol, and project text
    When the person selects the Java symbol result using the keyboard
    Then the native editor opens its Java declaration without changing the saved file
    When the person restores the Java source, stops JDT LS, and closes the IDE
    Then the Java language-intelligence project is restored and the native application exits cleanly

  @REQ-IDE-JAVA-LANGUAGE-001 @native-java-jdtls-runtime-preference @java @desktop @native-gui @e2e @functional-requirement
  Scenario: AC-011 - Refuse an incompatible JDT LS runtime and recover with a saved runtime JDK
    Given the native Java language-intelligence GUI has an isolated Java project and installed JDT LS
    When the person tries an incompatible JDT LS runtime then saves a compatible runtime JDK preference
    Then the native service uses the saved runtime JDK independently of the project JDK after restart
    When the person restores the Java source, stops JDT LS, and closes the IDE
    Then the Java language-intelligence project is restored and the native application exits cleanly
