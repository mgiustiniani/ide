@REQ-IDE-JAVA-LIBRARY-NAVIGATION-NATIVE-001 @desktop @native-gui @functional-requirement @partial
Business Need: Open the exact declaration of a dependency without editing library sources
  A Java developer needs F12 to distinguish overloaded library members using the selected SDK and effective project context.
  The call hierarchy preserves exact overload identities for resolved dependency binaries while refusing source navigation when no dependency source is available.
  Source attachments open as immutable snapshots while unrelated workspace drafts remain unsaved.
  Saved sources and complete immutable Java editor frames use locally attached Maven/Gradle dependencies on Linux release/no-bundle execution.
  In an editor frame, a dirty helper changes the library target while previous project outputs remain compiled.
  SDK source archives, installers and other operating systems require separate qualification.

  Scenario Outline: Select the exact <tool> library declaration from <authority> Java source and preserve workspace drafts
    Given the native library navigation GUI has an isolated <tool> dependency, selected JDK and <authority> Java source
    When the person synchronizes the Java project with an unrelated text draft open
    And the person requests outgoing call hierarchy from the Java caller method
    Then the native call hierarchy preserves both exact dependency overloads and opens only workspace call sites
    And the person requests F12 at the overloaded external library call
    Then the native library document selects the exact name and blocks typing and saving
    When the person opens the owning source from the Java toolbar
    Then the owning library snapshot preserves the current Java frame and unrelated draft
    When the person discards the text draft and closes the library navigation IDE
    Then the library navigation IDE exits with all source and dependency inputs unchanged

    Examples:
      | tool   | authority |
      | Maven  | saved     |
      | Gradle | saved     |
      | Maven  | editor    |
      | Gradle | editor    |

  @native-java-platform-source
  Scenario: Select and reopen the selected JDK declaration as an immutable source snapshot
    Given the native JDK source GUI has a selected JDK 25 and an isolated Maven project
    When the person synchronizes the Java project with an unrelated text draft open
    And the person requests F12 at the selected JDK method
    Then the JDK source tab selects the exact declaration and blocks typing and saving
    When the person opens the owning source from the Java toolbar
    Then the selected JDK source snapshot remains read-only and preserves the unrelated draft
    When the person discards the text draft and closes the library navigation IDE
    Then the library navigation IDE exits with all source and dependency inputs unchanged

  @native-java-modulepath-library
  Scenario Outline: Resolve a modular <tool> dependency from the synchronized module path
    Given the native library navigation GUI has an isolated <tool> modular dependency, selected JDK and saved Java source
    When the person synchronizes the Java project with an unrelated text draft open
    And the person requests F12 at the overloaded external library call
    Then the native library document selects the exact name and blocks typing and saving
    When the person opens the owning source from the Java toolbar
    Then the owning library snapshot preserves the current Java frame and unrelated draft
    When the person discards the text draft and closes the library navigation IDE
    Then the library navigation IDE exits with all source and dependency inputs unchanged

    Examples:
      | tool   |
      | Maven  |
      | Gradle |

  @native-java-platform-unavailable
  Scenario: Report unavailable JDK sources without opening a fabricated source document
    Given the native JDK 21 source GUI has no selected JDK source archive
    When the person synchronizes the Java project with an unrelated text draft open
    And the person requests F12 at the selected JDK method
    Then the editor reports the missing JDK source and opens no source tab
    When the person opens the owning source from the Java toolbar
    Then the editor keeps the JDK source unavailable and preserves the unrelated draft
    When the person discards the text draft and closes the library navigation IDE
    Then the library navigation IDE exits with all source and dependency inputs unchanged

  @native-java-platform-unavailable @native-java-platform-editor-frame
  Scenario: Preserve a dirty Java editor frame when selected JDK sources are unavailable
    Given the native JDK 21 source GUI has no selected JDK source archive and an unsaved Java edit
    When the person synchronizes the Java project with an unrelated text draft open
    And the person requests F12 at the selected JDK method
    Then the editor reports the missing JDK source and opens no source tab
    When the person opens the owning source from the Java toolbar
    Then the editor keeps the JDK source unavailable and preserves the Java editor frame and text draft
    When the person discards both editor and text drafts and closes the library navigation IDE
    Then the library navigation IDE exits with all source and dependency inputs unchanged
