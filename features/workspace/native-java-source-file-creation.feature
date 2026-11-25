@REQ-IDE-JAVA-FILE-CREATION-NATIVE-001 @implemented-and-validated @desktop @native-gui @functional-requirement @e2e @native-java-source-file-creation
Feature: Create and edit a Java source file through File Explorer
  A Java developer can create a source file in an existing package, edit and save it, then verify it with an available JDK.
  The native profile selects the production desktop artifact. Artifact and platform qualification is recorded in [ARC42](../../ARC42.md).

  @native-java-large-package
  Scenario: Open a Java source at the end of a large package in File Explorer
    Given an isolated native Java file-creation workspace contains an existing package source
    And the Java package contains 120 sibling source files before the existing source
    When the real production desktop executable is launched for the workspace
    And the person opens the existing source at the end of the package in File Explorer
    When the person closes the Java file-creation IDE
    Then the executable exits and every file in the large package is preserved

  Scenario: Create a Java source file from the package context menu and save compilable code
    Given an isolated native Java file-creation workspace contains an existing package source
    When the real production desktop executable is launched for the workspace
    And the person tries restricted Java type names and ignorable file-name characters
    Then the rejected type submissions leave source files and editor tabs unchanged
    When the person switches workspaces with unsubmitted file, folder and Java-type forms
    Then the creation forms are retired without creating entries in either workspace
    When the person creates "Created.java" from the package context menu
    Then the exact empty Java file exists and opens as the selected editor tab
    When the person enters and saves a Java main class in the new editor
    Then the saved source matches the editor and compiles and runs with the host JDK
    When the person closes the Java file-creation IDE
    Then the native executable exits and the workspace changes stay inside the scenario sandbox

  Scenario Outline: Create a Java <kind> from the type wizard as an unsaved draft
    Given an isolated native Java file-creation workspace contains an existing package source
    When the real production desktop executable is launched for the workspace
    And the person creates Java type "<name>" of kind "<kind>" in package "example"
    Then the generated Java type opens as a selected unsaved draft and the disk file stays empty
    When the person saves the generated Java type
    Then the saved generated Java type compiles at its supported Java release
    When the person closes the Java file-creation IDE
    Then the native executable exits and the workspace changes stay inside the scenario sandbox

    Examples:
      | name              | kind       |
      | GeneratedService  | class      |
      | GeneratedContract | interface  |
      | OrderStatus       | enum       |
      | Person            | record     |
      | JsonField         | annotation |
