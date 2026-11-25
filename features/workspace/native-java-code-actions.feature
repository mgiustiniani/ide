@REQ-IDE-JAVA-CODE-ACTIONS-NATIVE-001 @partial @desktop @native-gui @functional-requirement @e2e @native-java-code-actions
Feature: Use JDT LS code actions in the native editor
  Java developers need JDT LS editing actions from the editor, with accepted edits applied to the
  current buffer and unsaved source protected from hidden writes.

  Scenario: Import an unresolved Java type through a real JDT LS quick fix
    Given the native Java code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests a quick fix for the unresolved List type
    Then Monaco presents the JDT LS import action for java.util.List
    When the person applies that import quick fix
    Then the editor buffer includes the import and the saved source remains unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-refactor-extract
  Scenario: Extract a Java method through a JDT LS refactor code action
    Given the native Java Extract Method GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests the JDT LS Extract Method refactoring
    Then Monaco presents the JDT LS Extract Method refactoring
    When the person applies the JDT LS Extract Method refactoring
    Then the editor buffer includes the extracted method and the saved source remains unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-organize-imports
  Scenario: Organize Java imports in the native editor without saving the buffer
    Given the native Java organize-imports GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests organization of the Java imports
    Then Monaco presents the JDT LS Organize Imports source action
    When the person applies the JDT LS Organize Imports action
    Then the editor buffer has sorted used imports, removes the unused import, and keeps saved source unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  Scenario: Render a parameter-name inlay hint beside a literal argument
    Given the native Java code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    Then Monaco renders the JDT LS parameter-name hint beside a literal argument
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-surround-try-catch
  Scenario: Surround a Java statement that throws a checked exception with try and catch
    Given the native Java try-catch code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests the JDT LS Surround with try and catch quick assist
    Then Monaco presents the JDT LS Surround with try and catch quick assist
    When the person applies the JDT LS Surround with try and catch quick assist
    Then the Java buffer contains a catch block and the saved source remains unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-typing-formatting
  Scenario: Format an active Java document with JDT LS without saving the result
    Given the native Java code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person formats only the selected Java method through JDT LS
    Then Monaco formats only the selected Java range and keeps the saved source unchanged
    When the person formats the active Java document through JDT LS
    Then Monaco applies formatting only to the unsaved Java buffer
    When the person enables Java formatting while typing, types a trigger, then disables it
    Then Java typing formatting respects the workspace preference and preserves saved source
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-formatter-profile
  Scenario: Apply a workspace Eclipse formatter profile, restart JDT LS, and preserve a draft
    Given the native Java code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person applies the Eclipse formatter profile through Settings
    Then the unsaved Java draft survives the formatter profile restart
    Then Monaco renders the JDT LS parameter-name hint without saving the Java draft
    When the person formats the active Java document with the selected formatter profile
    Then Monaco applies the selected formatter profile to the unsaved Java buffer
    When the person opens the selected Eclipse formatter XML from Settings in the editor
    Then the editor shows the configured formatter XML and preserves the Java draft
    When the person changes the formatter brace style and saves the XML from the editor
    Then the saved formatter XML contains the updated style and the Java draft is unchanged
    When the person restarts JDT LS after editing the formatter XML
    Then JDT LS is ready with the edited formatter profile
    When the person formats the Java draft with the edited formatter profile
    Then Monaco applies the edited brace style without saving the Java source
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project and formatter profile are restored and the native application exits cleanly

  Scenario: Generate a Java field's accessors through a direct JDT LS source edit
    Given the native Java code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests override or implementation generation for inherited methods
    Then Monaco presents the JDT LS override and implementation generator
    When the person selects the inherited method to generate
    Then the editor buffer includes the selected override and the saved source remains unchanged
    When the person requests generation of accessors for the Java field
    Then Monaco presents the edit-only JDT LS getter and setter action
    When the person applies that accessor generation action
    Then the editor buffer includes the generated accessors and the saved source remains unchanged
    When the person requests a semantic rename of the Java field in the current document
    Then Monaco presents the JDT LS rename input for the field
    When the person renames the field to displayLabel
    Then the field rename changes only the editor buffer
    When the person requests implementation of the inherited Java method
    Then Monaco presents the edit-only JDT LS abstract-method action
    When the person applies that abstract-method action
    Then the editor buffer includes the generated implementation and the saved source remains unchanged
    When the person requests generation of toString for the Java class
    Then Monaco presents the edit-only JDT LS toString action
    When the person applies that toString action
    Then the editor buffer includes the generated toString and the saved source remains unchanged
    When the person requests constructor generation for the Java class
    Then Monaco presents the JDT LS constructor generation action
    When the person applies that constructor generation action
    Then the editor buffer includes a constructor for the selected field and the saved source remains unchanged
    When the person requests hashCode and equals generation for the Java class
    Then Monaco presents the JDT LS hashCode and equals generation action
    When the person applies that hashCode and equals generation action
    Then the editor buffer includes hashCode and equals methods and the saved source remains unchanged
    When the person requests delegate method generation for a Java field
    Then Monaco presents the JDT LS delegate method generator
    When the person selects a method from the delegate target
    Then the editor buffer includes the selected delegate method and the saved source remains unchanged
    When the person requests sorting of the Java class members
    Then Monaco presents the JDT LS Sort Members action
    When the person applies that member-sorting action
    Then the editor buffer has sorted members and the saved source remains unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-local-rename
  Scenario: Rename a Java local variable without renaming a shadowed field
    Given the native Java local-rename GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests a semantic rename of a Java local variable that shadows a field
    Then Monaco presents the JDT LS rename input for the local variable
    When the person renames the local variable to computedValue
    Then the semantic local rename changes only its binding in the editor buffer
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-parameter-rename
  Scenario: Rename one overloaded Java parameter without changing same-named bindings
    Given the native Java parameter-rename GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests a semantic rename of the String overload parameter
    Then Monaco presents the JDT LS rename input for the method parameter
    When the person renames the selected parameter to input
    Then only that parameter binding changes in the unsaved editor buffer
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-cross-file-rename
  Scenario: Rename only the selected overloaded Java method across two open draft files
    Given the native Java cross-file-rename GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person opens both Java sources for a cross-file rename
    When the person requests a semantic rename of one Java overload with an open cross-file reference
    Then Monaco presents the JDT LS rename input for the cross-file method
    When the person renames the selected overload to caption
    Then the selected overload rename updates only its bindings in both drafts and leaves saved files unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-cross-file-rename
  Scenario: Open a closed Java reference in the background and rename from fresh synchronized drafts
    Given the native Java cross-file-rename GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests a semantic rename with the Java reference file still closed
    Then Monaco presents the JDT LS rename input for the cross-file method
    When the person renames the selected overload to caption
    Then the selected overload rename updates only its bindings in both drafts and leaves saved files unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-nested-type-rename
  Scenario: Rename a nested Java type and its references across two open drafts
    Given the native Java nested-type rename GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person opens both Java sources for a cross-file rename
    When the person requests a semantic rename of the nested Java type
    Then Monaco presents the JDT LS rename input for the nested Java type
    When the person renames the nested type to Inner
    Then the nested-type rename updates its declaration and open references in both unsaved Java buffers
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-record-component-rename
  Scenario: Rename a Java record component and its accessor references across two open drafts
    Given the native Java record-component rename GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person opens both Java sources for a cross-file rename
    When the person requests a semantic rename of the Java record component
    Then Monaco presents the JDT LS rename input for the Java record component
    When the person renames the record component to displayLabel
    Then the record-component rename updates its declaration and accessor references in both unsaved Java buffers
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-multi-document-code-action
  Scenario: Apply a JDT LS quick fix to another open Java draft
    Given the native Java multi-document-code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person opens the Java companion source for a multi-document code action
    When the person requests a quick fix that creates a method in the other open Java file
    Then Monaco presents the JDT LS method-creation quick fix for the other open file
    When the person applies that multi-document method-creation quick fix
    Then the workspace edit updates the open Java file and leaves both saved files unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-semantic-multi-document-code-action
  Scenario: Select a method-creation quick fix before opening its closed Java target
    Given the native Java multi-document-code-action GUI has an isolated Java project and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person opens the Java companion source for a multi-document code action
    When the person closes the clean Java target before requesting its quick fix
    When the person requests a method-creation quick fix for the closed Java target
    Then the method-creation quick fix is selectable without opening its target
    When the person applies that multi-document method-creation quick fix
    Then the workspace edit updates the open Java file and leaves both saved files unchanged
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-language-responsiveness
  Scenario: Native file opening remains responsive during Java formatting
    Given the native Java GUI delays only a real JDT LS formatting response
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person opens another file while the real formatting response is held
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

  @native-java-javadoc
  Scenario Outline: Generate Javadoc for a Java <kind> and preserve an earlier unsaved edit
    Given the native Java Javadoc GUI has an isolated "<kind>" declaration and installed JDT LS
    When the person starts the language service and opens the Java source
    Then JDT LS reports code actions, document and range formatting, and the unresolved List diagnostic
    When the person requests a quick fix for the unresolved List type
    Then Monaco presents the JDT LS import action for java.util.List
    When the person applies that import quick fix
    Then the editor buffer includes the import and the saved source remains unchanged
    When the person requests Javadoc for the selected Java declaration
    Then Monaco presents the JDT LS Add Javadoc comment action
    When the person applies the JDT LS Add Javadoc comment action
    Then the unsaved Javadoc matches the declaration and passes javac and doclint
    When the person undoes and redoes the Javadoc action
    Then Javadoc history preserves the prior import draft and saved source
    When the person restores the disk version, stops JDT LS, and closes the IDE
    Then the Java project inputs remain unchanged and the native application exits cleanly

    Examples:
      | kind        |
      | method      |
      | constructor |
