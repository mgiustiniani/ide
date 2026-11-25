Business Need: Responsive file access while optional desktop providers are loading
  People developing Java need to open their authorized source files while external tooling is still being checked.
  This focused Linux check uses the installed RefactorKit CLI through a delayed launcher; it does not replace provider output.
  Broader startup reliability, other operating systems and installer behavior remain outside this scenario.

  @REQ-IDE-STARTUP-RESPONSIVENESS-NATIVE-001 @partial @desktop @native-gui @non-functional-requirement @resilience
  Scenario: Open source while a real provider availability check is still pending
    Given an isolated startup workspace and a delayed launcher for the real installed RefactorKit CLI
    When the production startup IDE launches with that provider
    Then the File Explorer and recovery become ready while the provider probe remains pending
    When the person opens the startup source through the File Explorer
    Then Monaco presents its exact saved content without modifying source
    And the provider eventually reports the real CLI version
    When the person closes the clean startup IDE through the native window protocol
    Then startup state remains confined and the scenario is released without forced termination
