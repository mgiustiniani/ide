@not-implemented
Business Need: Kotlin language behavior presented in the IDE by consuming RefactorKit
  To present Kotlin syntax and navigation under workspace authority with honest availability
  A Kotlin developer needs a Kotlin document highlighted, its definitions and references resolved, and
  its locations revealed through the RefactorKit engine kotlin commands, so the IDE can show Kotlin
  language behavior without fabricating highlighting, definitions, or references when the Kotlin
  toolchain or engine capability is absent.

Ability: Present Kotlin highlighting, definition, and references from the RefactorKit engine kotlin commands through provider-neutral ports
  The desktop can register a Kotlin document with the Monaco Kotlin language, request the RefactorKit
  engine kotlin definition and references commands for a Kotlin position, present the resolved
  definition and references and reveal a selected location, and report honest unavailable or error when
  the Kotlin toolchain or engine capability is absent, while browser and desktop adapters expose the
  same capability behind ports and the web frontend never imports the Tauri API.

Feature: Kotlin language behavior presented in the IDE by consuming RefactorKit
  This functional requirement covers one coherent Kotlin language slice: given a Kotlin document
  (.kt, .kts, or a document whose language identifier is kotlin) and a Kotlin position, the IDE
  resolves the document to the Monaco Kotlin language so it receives syntax highlighting rather than
  plaintext, and requests the RefactorKit engine kotlin definition and references commands to resolve
  go-to-definition and find-references, presenting them and revealing a selected location, with honest
  unavailable/error when the Kotlin toolchain or engine capability is absent. Kotlin navigation stays
  INSIDE RefactorKit as an internal, modular capability; the IDE is a consumer, not a reimplementation,
  and there is NO standalone Kotlin kit. It is one feature source reused across browser and desktop
  profiles; profiles, worlds, adapters, or glue differences vary by platform and no competing feature
  source exists. Pure view-model decision behavior authorized here is Spec BDD; the operational Story
  is the behavioral backlog. RefactorKit engine capability metadata is authoritative for support, and
  real-engine existence is deferred to the integration moment and is not a slice gate. Kotlin
  toolchain resolution is qualified by the explicitly approved --jdk-home and --compiler-jar paths;
  without them the Kotlin capability is reported honestly as unavailable rather than assumed. Kotlin
  refactoring is a separate slice and is not authorized or implied by this feature. Live
  Tauri-window Kotlin navigation E2E may remain unvalidated when headless and is recorded honestly;
  it never silently upgrades the declared status.

  @REQ-IDE-KOTLIN-LANGUAGE-001 @kotlin @desktop @story-bdd @functional-requirement
  Scenario: AC-001 - A Kotlin document resolves to the Monaco Kotlin language and receives syntax highlighting
    Given an authorized workspace with a Kotlin document is presented in the IDE
    And the document source is a .kt file, a .kts file, or a document whose language identifier is kotlin
    And the provider authoritatively advertises the Kotlin language capability for that workspace
    When the IDE opens that document in the editor
    Then the IDE resolves the document to the Monaco Kotlin language
    And the document receives Kotlin syntax highlighting rather than plaintext rendering
    And the Kotlin language assignment is not fabricated, reimplemented, or sourced from a standalone kit

  @REQ-IDE-KOTLIN-LANGUAGE-001 @kotlin @desktop @story-bdd @functional-requirement
  Scenario: AC-002 - The IDE resolves go-to-definition via the engine kotlin definition command and reveals the location
    Given an authorized Kotlin document is presented in the IDE at a Kotlin position
    And the Kotlin toolchain is qualified by the explicitly approved --jdk-home and --compiler-jar paths
    And the provider authoritatively advertises Kotlin definition capability for that workspace
    When the IDE requests go-to-definition for that Kotlin position through the RefactorKit engine kotlin definition command
    Then the engine returns a definition location correlated to the workspace authority, the document, the position, and the provider
    And the IDE reveals the definition at the exact location reported by the engine
    And the definition is not fabricated, guessed from textual matching, or produced by the IDE itself

  @REQ-IDE-KOTLIN-LANGUAGE-001 @kotlin @desktop @story-bdd @functional-requirement
  Scenario: AC-003 - The IDE resolves find-references via the engine kotlin references command, presents them, and reveals a selected reference
    Given an authorized Kotlin document is presented in the IDE at a Kotlin position
    And the Kotlin toolchain is qualified by the explicitly approved --jdk-home and --compiler-jar paths
    And the provider authoritatively advertises Kotlin references capability for that workspace
    When the IDE requests find-references for that Kotlin position through the RefactorKit engine kotlin references command
    Then the engine returns references correlated to the workspace authority, the document, the position, and the provider
    And the IDE presents the engine references as the Kotlin reference results
    And when the developer selects one presented reference the IDE reveals that reference at its reported location
    And the reference set is neither fabricated, truncated into a success claim, nor supplemented with a fallback textual rewrite

  @REQ-IDE-KOTLIN-LANGUAGE-001 @kotlin @desktop @story-bdd @functional-requirement
  Scenario: AC-004 - Adapters use extract, delegate, and response and report honest unavailable or error without fabrication
    Given a Kotlin language request arrives at a browser or desktop adapter behind a provider-neutral port
    When the adapter receives the request
    Then the adapter extracts only the request payload needed by the delegate
    And the adapter delegates the extracted request to the owned RefactorKit kotlin definition or references capability
    And the adapter returns the delegated engine response to the caller
    And the adapter contains no hidden domain policy, no standalone Kotlin kit, and no reimplementation of Kotlin language behavior
    When the Kotlin toolchain or the engine kotlin capability is absent or the engine command fails
    Then the IDE reports the Kotlin capability honestly as unavailable or the command honestly as an error
    And it never fabricates Kotlin highlighting, a definition, references, a successful result, or a fallback textual rewrite
    And a browser without a conforming browser provider reports the local Kotlin language capability as unavailable

  @REQ-IDE-KOTLIN-LANGUAGE-001 @kotlin @desktop @story-bdd @functional-requirement
  Scenario: AC-005 - The web frontend stays Tauri-free at the platform boundary
    Given packages ui, web-core, and web are part of the standalone web frontend
    When the Kotlin language capability is exercised through the browser profile
    Then no file under ui, web-core, or web imports "@tauri-apps/api"
    And the web frontend builds and runs without Tauri
    And browser and desktop Kotlin language implementations live behind frontend ports, not platform APIs

  @REQ-IDE-KOTLIN-LANGUAGE-001 @kotlin @desktop @story-bdd @functional-requirement
  Scenario: AC-006 - Implementation status is evidence-based and live Kotlin navigation e2e may remain unvalidated headless
    Given meaningful RED precedes new product behavior for this feature
    When the feature file is parsed for requirement and status reconciliation
    Then the feature declares exactly one effective status "@not-implemented" at feature level
    And no scenario overrides that single effective status
    And the requirement ID "@REQ-IDE-KOTLIN-LANGUAGE-001" is repository-unique and reconciled
    And contracts, shells, import Stories, diagnostics, or hard-coded/fake Kotlin languages, definitions, or references do not promote this status
    And Kotlin language registration, Monaco highlighting, engine kotlin definition and references resolution, live editor or native GUI wiring, packaging, and platform coverage are reported separately
    And Kotlin refactoring remains a separate slice and its absence never downgrades nor upgrades this language slice
    And live Tauri-window Kotlin navigation E2E may remain unvalidated headless without silently upgrading the declared status
