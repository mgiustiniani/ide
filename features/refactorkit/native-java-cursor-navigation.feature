@REQ-IDE-JAVA-CURSOR-NAVIGATION-NATIVE-001 @desktop @native-gui @functional-requirement @partial
Business Need: Navigate Java bindings from the cursor in the real desktop editor
  A Java developer needs workspace-symbol search, definitions and references for the selected expression, including overloaded methods and UTF-16 positions.
  The native Linux profiles use a configured RefactorKit daemon and a two-module Maven reactor where app depends on core.
  The scenario runs the saved-source F12 definition before RefactorKit's separate implementations query and verifies both under one selected project context. It also covers one immutable dirty-buffer overlay. Dependency sources, broader effective-project synchronization and other operating systems have separate acceptance criteria.

  Scenario: Resolve an overloaded method, open its references and preserve a dirty-buffer overlay
    Given the native Java cursor GUI has an isolated two-module Maven reactor and installed RefactorKit and JDT LS tools
    When the production editor opens the Java call after an astral Unicode character
    And the person requests an implementation for the Java interface method
    Then the native editor opens its workspace method implementation
    When the person requests F12 at the overloaded method call
    Then the native editor opens the integer overload at its exact declaration position
    When the person opens Go to Type Definition on the Java constructor type
    Then the editor opens the bound type in the other Maven module
    When the person requests RefactorKit implementations for the Java interface method
    Then RefactorKit shows and opens its concrete workspace method implementation
    When the person opens Java workspace-symbol search with Ctrl+T
    Then the Java workspace-symbol query receives focus in the native UI
    When the person searches for Helper and opens its class result
    Then the editor opens Helper at its exact workspace declaration
    When the person Ctrl-clicks the overloaded Java method call
    Then Ctrl-click opens the exact integer overload declaration
    When the person requests Shift F12 at the saved Java call
    Then the native reference preview shows the saved declaration and call site
    When the person opens the call site from the native reference preview
    Then the editor reveals the exact UTF-16 call position without replacing saved source
    When the person requests Java supertypes for the selected source type
    Then the type hierarchy shows and opens its workspace superclass
    When the person requests callers for the selected Java method
    Then the call hierarchy shows the caller and opens its call site
    When the person changes the Java call to a string overload without saving and requests F12
    Then Java navigation follows the dirty string-overload overlay without changing workspace sources
    When the person requests native window close with the unsaved Java edit
    Then the window stays open with the Java edit still unsaved
    When the person discards the fixture edit and closes the clean navigation IDE
    Then the navigation IDE exits with unchanged Java sources and project descriptor
