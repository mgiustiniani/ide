@REQ-IDE-JAVA-FILE-OPERATIONS-NATIVE-001 @partial @desktop @native-gui @functional-requirement @e2e @native-java-file-operations
Feature: Review and apply saved Java file operations through RefactorKit
  Developers invoke formatting and import organization from the active Java editor.
    The IDE protects unsaved work, shows the engine's preview from the editor context menu and reconciles source after apply and rollback.

  Scenario Outline: Apply and roll back a Java file operation with the real engine
    Given a real RefactorKit Java file-operation workspace for "<operation>"
    When the person opens the Java source and its editor context action refuses unsaved edits
    And the person saves the Java source and reviews its exact file operation without writing
    And the person applies the reviewed file operation and the resulting Java source compiles with unchanged behavior
    And the person rolls the file operation back and observes the original source on disk and in the editor
    And the person closes the clean file-operation IDE with unrelated files preserved

    Examples:
      | operation        |
      | format-file      |
      | organize-imports |
