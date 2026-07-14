Business Need: Trusted semantic navigation for TypeScript and JavaScript workspaces
  To explore saved code without allowing a workspace to choose or alter semantic tooling
  A TypeScript or JavaScript developer needs a searched symbol to open only at a definition proven by the authorized desktop session.

  @desktop @REQ-REFACTORKIT-TS-002 @functional-requirement @non-functional-requirement @compatibility @security @not-implemented
  Scenario: Open a searched workspace symbol at its semantic definition
    Given a TypeScript or JavaScript developer has opened an authorized desktop workspace
    And each participating TypeScript or JavaScript editor buffer matches its saved file
    And accepted RefactorKit experimental language-server capability evidence advertises workspace symbol search and semantic definition lookup for that workspace
    And the only eligible toolchain uses external Node, typescript-language-server, and TypeScript paths explicitly approved by the developer
    When the developer searches for a workspace symbol in the existing generic Search surface
    And selects a semantic search result
    Then its semantic definition opens in the existing editor at the exact point reported by the provider coordinates
    And the selected result and definition come from the same authorized workspace, workspace generation, semantic session, and saved workspace snapshot
    And any opaque symbol identity is passed transiently between search and definition without being entered by the developer or persisted
    And semantic search and navigation are refused while a participating TypeScript or JavaScript editor buffer is dirty or has never been saved
    And the Search surface discloses that results may be incomplete for dynamic or mixed JavaScript
    But neither PATH nor workspace-local files are searched for semantic tooling
    And unavailable semantic evidence never falls back to structural identifiers
    And the operation does not execute project scripts or write to the workspace
    And no TypeScript- or JavaScript-specific panel is introduced
    And no project action is added to global Settings
    And a browser without explicit desktop simulation reports the capability as unavailable
