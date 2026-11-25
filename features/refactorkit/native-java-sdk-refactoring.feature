@REQ-IDE-JAVA-SDK-REFACTORING-NATIVE-001 @desktop @native-gui @functional-requirement @partial
Business Need: Review Java drafts and restore saved changes with the selected project JDK
  A Java developer needs a complete preview, explicit Apply and protected rollback using the original project context.
  Maven scenarios use the real native application and RefactorKit daemon. Saved-source operations use a six-module project with Java 17 sources, while module rename and creation use a compact offline reactor. The source-root cases use separate Maven and Gradle projects with an additional root in one module. A cross-module class move also selects a destination module when creating a package that does not yet exist. The saved format-file case selects a workspace Eclipse formatter XML profile and checks the provider-attested profile identity, formatted output, offline Maven verification and rollback.
  Maven compiles and tests copies of the applied sources so build output does not change the live rollback snapshot.
  Draft-only member rename, formatting, import organization and class rename use explicit Apply and Undo without saving source content.
  The saved Extract Constant scenario exercises a compile-time integer expression selected in Monaco when the synchronized RefactorKit runtime advertises the project-context operation; preview, Apply, offline Maven verification on a copied source tree and exact rollback are checked separately.
  The saved Extract Variable scenario exercises a primitive-int subexpression within a return expression when the synchronized RefactorKit runtime advertises the project-context operation; preview, Apply, offline Maven verification on a copied source tree and exact rollback are checked separately.
  The saved Extract Variable initializer scenario exercises a primitive-int subexpression in a single-fragment local initializer directly in a method body, including explicit-type insertion, when the synchronized RefactorKit runtime advertises the project-context operation; preview, Apply, offline Maven verification on a copied source tree and exact rollback are checked separately.
  The saved Extract Parameter scenario selects the complete `parameter + int literal` return expression in a private static one-parameter method with one same-file bound call site. It checks the provider's new parameter and call argument, Apply, offline Maven verification on a copied source tree and exact rollback.
  The saved Extract Field scenario selects one compile-time `int` expression in a non-static method and checks the private final instance field insertion, Apply, offline Maven verification on a copied source tree and exact rollback.
  The saved Extract Method scenario exercises multiple complete statements that read method parameters and a local declared before the selection, update one local through a conditional branch, call a method that throws a checked exception, and produce one local used afterward; preview, Apply, offline Maven verification on a copied source tree and exact rollback are checked separately.
  The saved Add Parameter scenario selects a method from the Monaco cursor and checks the provider's default argument for the existing in-workspace call through preview, Apply, offline Maven verification on a copied source tree and exact rollback.
  The saved Remove Parameter scenario selects a method from the Monaco cursor, names an unused parameter and checks the provider's updated declaration and bound call through preview, Apply, offline Maven verification on a copied source tree and exact rollback.
  The Make Static scenario selects an isolated private instance method from the Monaco cursor; RefactorKit owns JDT binding analysis and refuses unsupported method or call-site shapes. The native GUI checks preview, Apply, offline Maven verification on a copied source tree and exact rollback.
  Make Public selects methods from the Monaco cursor. RefactorKit owns JDT binding analysis and refuses incomplete bindings, unsupported annotations, or unresolved override risks; the native GUI checks both supported final-owner methods through preview, Apply, offline Maven verification on copied source trees and exact rollback, and checks that an unsafe method in an extensible class remains unchanged with Apply disabled.
  The experimental RefactorKit LSP visibility path is exercised separately through the native editor menu and applies only to the editor buffer; Maven verifies a copy of the applied content while the saved source remains unchanged.
  The Extract Interface scenario selects a saved top-level class at the Monaco cursor. It verifies provider-attested JDT class identity, explicit interface and method names, Apply, offline Maven verification on a copied source tree, and rollback of both the class edit and generated interface. The current provider cell supports one public primitive-signature instance method without a class hierarchy; other shapes remain provider-refused.
  The Extract Superclass scenario selects a saved top-level class at the Monaco cursor. It verifies provider-attested JDT class identity, explicit superclass and method names, Apply, offline Maven verification on a copied source tree, and rollback of both the class edit and generated superclass. The current provider cell supports one public, unannotated instance method with `int` parameters and exactly one `int` return expression; the class has no superclass, interfaces or type parameters. Other shapes remain provider-refused.
  Move Member uses JDT LS to find a same-file destination class and RefactorKit to verify its binding. The native scenarios build the real Maven reactor, move a package-private static no-argument integer method and verify its bound call and runtime result, then roll back exactly; an instance method must be refused without source changes.
  The Pull Up Method scenario selects a saved final method at the Monaco cursor and names its direct superclass. The provider's bounded high-risk slice requires two same-package top-level classes in one source file, one available non-generated source set, and complete JDT references; it warns about reflective and external consumers and refuses other shapes. The native GUI checks preview, explicit Apply, offline Maven verification on a copied source tree and exact rollback.
  The Push Down Method scenario selects a saved protected final method at the Monaco cursor and names its only direct child. The provider's bounded high-risk slice requires a package-private abstract parent and one package-private final direct child in the same available source set, with every method use a complete binding-resolved invocation inside that child; it warns about reflective and external consumers and refuses other shapes. The native GUI checks preview, explicit Apply, offline Maven verification on a copied source tree and exact rollback.
  The Add Module scenario selects the Maven project root and verifies read-only preview, explicit Apply, offline Maven verification and transaction rollback when the aggregate Java context is partial. It removes generated Maven output before rollback and checks that the original reactor inputs are restored.
  The Gradle Add Module scenarios use both Groovy and Kotlin settings DSLs, review a nested project addition, compile an applied-source copy offline and roll back the exact original project inputs.
  Recovery after restart requires a fresh synchronized SDK context and explicit review before restoring the original drafts.
  The Maven source-root case moves between two declared Build Helper `CUSTOM` roots, while Gradle moves between `MAIN` roots. Both verify preview, Apply, Rollback, and exact source restoration; the Gradle case also passes one offline module test against an applied-source copy. Broader move/delete cases, other operations, installers, and other operating systems require separate acceptance.
  The Spring Data JPQL field-rename review traces to RefactorKit requirement REQ-JAVA-RENAME-FIELD-CHAR-001; Apply remains unavailable while project reference closure is incomplete.

  @native-java-saved-refactoring @native-java-jpql-review
  Scenario: Review a field rename with Spring Data JPQL property paths in a native IDE
    Given the SDK refactoring GUI has a real Maven project with a Spring Data JPQL field reference and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews a Java field rename with direct Spring Data JPQL references and retries after a saved edit
    Then the review lists incomplete JPQL references, disables Apply, and opens the selected occurrence without changing the project
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-jpql-opaque-resource
  Scenario: Review a JPQL field rename when the workspace has uninspected query resources
    Given the SDK refactoring GUI has a real Maven project with a Spring Data JPQL field reference and a capable daemon
    And the Maven project contains uninspected JPQL mapping and query resources
    When the person opens a saved Java source and synchronizes its selected project JDK
    Then the rename review names each uninspected resource and withholds Apply
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-jpql-managed
  Scenario: Rename a JPA field and its closed Spring Data JPQL query and roll back
    Given the SDK refactoring GUI has a real Maven project with a closed Spring Data JPQL query and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies and rolls back the JPQL rename while the query returns the same result
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-jpql-managed
  Scenario: Withhold Apply for a closed JPQL query when a compiled class exists
    Given the SDK refactoring GUI has a real Maven project with a closed Spring Data JPQL query and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    Then the JPQL rename keeps Apply unavailable when a compiled class exists
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-jpql-named-query
  Scenario: Rename a JPA field used in a static named query and a Spring Data query
    Given the SDK refactoring GUI has a real Maven project with a closed Spring Data JPQL query and a capable daemon
    And the same entity declares a static JPA named query for the field
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back the JPQL rename with both queries returning the same result
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-jpql-named-query
  Scenario: Withhold Apply for a static named-query rename with a compiled class
    Given the SDK refactoring GUI has a real Maven project with a closed Spring Data JPQL query and a capable daemon
    And the same entity declares a static JPA named query for the field
    When the person opens a saved Java source and synchronizes its selected project JDK
    Then the named-query rename shows all references and keeps Apply unavailable with a compiled class
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-jpql-named-query
  Scenario: Withhold Apply for a named query built by concatenation
    Given the SDK refactoring GUI has a real Maven project with a closed Spring Data JPQL query and a capable daemon
    And the same entity declares a computed JPA named query for the field
    When the person opens a saved Java source and synchronizes its selected project JDK
    Then the computed named-query rename shows the Spring Data references and keeps Apply unavailable
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-saved-refactoring @native-java-sdk-formatter-profile
  Scenario: Apply and roll back formatting, import organization and class rename with secondary types in unrelated modules
    Given the SDK refactoring GUI has a real Maven reference project with an unused import, workspace formatter profile and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies and rolls back SDK formatting import organization and class rename
    Then the applied source copies compile and pass Maven tests and all original inputs are restored
    And the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-batch-cleanup
  Scenario: Review a mixed saved Java cleanup batch and restore every selected source
    Given the SDK refactoring GUI has a real Maven reference project with an unused import, workspace formatter profile and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person refuses duplicate cleanup files and applies a mixed batch whose rollback preserves a later edit until retry
    Then the Java cleanup batch source copy passes Maven tests and the exact original inputs are restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-batch-cleanup
  Scenario: Review a mixed saved Gradle Java cleanup batch and restore every selected source
    Given the SDK cleanup GUI has a real Gradle reference project with an unused import and a capable daemon
    When the person opens builds and synchronizes the Gradle Java cleanup project
    And the person refuses duplicate cleanup files and applies a mixed batch whose rollback preserves a later edit until retry
    Then the Java cleanup batch source copy passes Gradle tests and the exact original inputs are restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-batch-formatter-profile
  Scenario: Apply the selected Eclipse profile in a saved Maven Java cleanup batch
    Given the SDK refactoring GUI has a real Maven reference project with an unused import, workspace formatter profile and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person selects the Team Java Eclipse profile and reviews applies and rolls back mixed Java cleanup
    Then the Java cleanup batch source copy passes Maven tests and the exact original inputs are restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-batch-formatter-profile
  Scenario: Apply the selected Eclipse profile in a saved Gradle Java cleanup batch
    Given the SDK cleanup GUI has a real Gradle reference project with an unused import and a capable daemon
    When the person opens builds and synchronizes the Gradle Java cleanup project
    And the person selects the Team Java Eclipse profile and reviews applies and rolls back mixed Java cleanup
    Then the Java cleanup batch source copy passes Gradle tests and the exact original inputs are restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-maven-module-create
  Scenario: Apply and roll back Maven Add Module when the project context is partial
    Given the SDK refactoring GUI has a real Maven reactor for Add Module and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person previews, applies, verifies and rolls back Maven Add Module from a partial project context
    Then Add Module rejects rollback with live build outputs, preserves later edits, and restores the reactor after controlled cleanup and explicit retry
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-module-create
  Scenario Outline: Apply and roll back a nested Gradle Add Module using <dsl> settings
    Given the SDK refactoring GUI has a real Gradle project for Add Module using "<dsl>" settings and a capable daemon
    When the person opens and explicitly evaluates the Gradle project for module creation
    And the person previews applies builds and rolls back Gradle Add Module
    Then Gradle Add Module compiles an applied-source copy and rollback restores the original project
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | dsl    |
      | groovy |
      | kotlin |

  @native-java-inline-refactorings @native-java-inline-variable @native-java-saved-refactoring
  Scenario: Apply and roll back Inline Variable from a selected local identifier
    Given the SDK refactoring GUI has a real Maven project with inline local and constant fixtures and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Inline Variable from the selected Java identifier
    Then Inline Variable passes Maven verify on a source copy and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-inline-refactorings @native-java-inline-constant @native-java-saved-refactoring
  Scenario: Apply and roll back Inline Constant from a selected constant identifier
    Given the SDK refactoring GUI has a real Maven project with inline local and constant fixtures and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Inline Constant from the selected Java identifier
    Then Inline Constant passes Maven verify on a source copy and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-inline-refactorings @native-java-inline-method @native-java-saved-refactoring
  Scenario: Apply and roll back Inline Method from the saved Java cursor
    Given the SDK refactoring GUI has a real Maven project with inline local and constant fixtures and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Inline Method from the saved Java cursor
    Then Inline Method passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-parameter-object
  Scenario: Introduce a parameter object without changing argument order
    Given the SDK refactoring GUI has a Maven method with two adjacent parameters and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person introduces a parameter object from the saved method cursor, verifies the Maven copy and rolls back
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-delegate
  Scenario: Refuse an incomplete helper group and extract the complete group in Maven
    Given the SDK refactoring GUI has a Maven class with private static helpers and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person extracts the helper group into a delegate, tests the applied copy and rolls back
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-delegate
  Scenario: Refuse an incomplete helper group and extract the complete group in Gradle
    Given the SDK refactoring GUI has a Gradle class with private static helpers and a capable daemon
    When the person opens a saved Java source and builds and evaluates its Gradle project
    And the person extracts the helper group into a delegate, tests the applied copy and rolls back
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-inline-method-upgrade
  Scenario: Discover Inline Method after replacing the installed RefactorKit runtime
    Given the SDK refactoring GUI has a real Maven project with inline local and constant fixtures and a capable daemon
    And the IDE discovers RefactorKit through the test user's standard installation
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person closes the IDE, upgrades RefactorKit and reopens the same project
    And the person applies and rolls back Inline Method from the saved Java cursor
    Then Inline Method passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-saved-refactoring @native-java-extract-constant
  Scenario: Extract a constant from the selected saved Java expression and roll it back
    Given the SDK refactoring GUI has a real Maven project with a selected constant expression and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Extract Constant from the selected Monaco expression
    Then Extract Constant replaces the selected expression, passes Maven verify on a source copy, and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-variable
  Scenario: Extract a local variable from a selected saved Java return subexpression and roll it back
    Given the SDK refactoring GUI has a real Maven project with a selected return expression and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Extract Variable from a selected Monaco return subexpression
    Then Extract Variable introduces a local for the selected return subexpression, passes Maven verify on a source copy, and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-variable-initializer
  Scenario: Extract a local variable from a selected saved Java local initializer and roll it back
    Given the SDK refactoring GUI has a real Maven project with a selected local initializer and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Extract Variable from a selected Monaco local initializer
    Then Extract Variable introduces a local before the selected initializer, passes Maven verify on a source copy, and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-parameter
  Scenario: Extract the selected int return expression into a parameter and update its bound call
    Given the SDK refactoring GUI has a real Maven project with one supported Extract Parameter call site and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person extracts the selected return expression into a parameter and rolls it back
    Then Extract Parameter updates its method and call, passes Maven verify on a source copy, and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-field
  Scenario: Extract the selected compile-time int expression into a private instance field
    Given the SDK refactoring GUI has a real Maven project with one supported Extract Field expression and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person extracts the selected constant expression into an instance field and rolls it back
    Then Extract Field passes Maven verify on a source copy and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-method
  Scenario: Extract Java statements with parameters, a preceding local, conditional output and a checked exception
    Given the SDK refactoring GUI has a real Maven project with binding-aware Extract Method data flow and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Extract Method from selected Monaco statements with conditional data flow and a checked exception
    Then Extract Method passes its inputs and checked exception through the helper, passes Maven tests on a source copy, and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-extract-method
  Scenario: Extract a Java method in a synchronized multi-module Gradle project
    Given the SDK refactoring GUI has a real Gradle project with binding-aware Extract Method data flow and a capable daemon
    When the person opens a saved Java source, compiles the Gradle project and synchronizes its selected project JDK
    And the person applies and rolls back Extract Method from selected Monaco statements with conditional data flow and a checked exception
    Then Extract Method passes its inputs and checked exception through the helper, passes Gradle tests on a source copy, and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-saved-refactoring @native-java-cursor-parameter-reorder
  Scenario: Reorder method parameters from the saved Java cursor and roll back
    Given the SDK refactoring GUI has a real Maven project with a two-parameter method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back parameter reordering from the Monaco cursor
    Then the parameter reorder passes Maven verify on a source copy and restores the original method and call
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-cursor-parameter-rename
  Scenario: Rename a method parameter from the saved Java cursor and roll back
    Given the SDK refactoring GUI has a real Maven project with a two-parameter method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back parameter renaming from the Monaco cursor
    Then parameter rename passes Maven verify on a source copy and restores the original method and call
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-saved-refactoring @native-java-cursor-parameter-reorder
  Scenario: Retire stale Java project context during a parameter-reorder review
    Given the SDK refactoring GUI has a real Maven project with a two-parameter method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And a compiled Maven output changes outside the IDE after the person opens the parameter-reorder dialog
    And the person attempts to preview the parameter reorder against the stale snapshot
    Then the stale Java context is retired, Apply is unavailable, and explicit synchronization remains available
    When the person restores the Maven output and explicitly resynchronizes the project
    Then the effective Maven context is available again after synchronization
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-public-parameter-reorder-refusal
  Scenario: Explain why a public method parameter reorder is refused
    Given the SDK refactoring GUI has a real Maven project with a public two-parameter method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person previews parameter reordering from the Monaco cursor
    Then RefactorKit explains the public-method restriction, disables Apply, and preserves the project
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-make-static
  Scenario: Make an isolated private method static from the saved Java cursor and roll it back
    Given the SDK refactoring GUI has a real Maven project with an isolated private method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person makes an isolated Java method static from the Monaco cursor and rolls it back
    Then Make Static passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-make-public
  Scenario: Make one bound final method public from the saved Java cursor and roll it back
    Given the SDK refactoring GUI has a real Maven project with a final private method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person makes a final Java method public from the Monaco cursor and rolls it back
    Then Make Public passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-lsp-refactoring
  Scenario: Review and apply a RefactorKit LSP visibility change without saving source
    Given the SDK refactoring GUI has a real Maven project with a final private method and a source-built RefactorKit LSP
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews and applies RefactorKit LSP Make Public to the editor buffer without saving the source
    Then the RefactorKit LSP visibility change is reviewed, compiles on a source copy, and leaves the saved source unchanged
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-make-public
  Scenario: Make a non-final private method public in a final class and roll it back
    Given the SDK refactoring GUI has a real Maven project with a non-final private method in a final class and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person makes a non-final Java method public from the Monaco cursor and rolls it back
    Then Make Public passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-make-public
  Scenario: Refuse to make an unsafe non-final private method public in an extensible class
    Given the SDK refactoring GUI has a real Maven project with a non-final private method in an extensible class and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person previews Make Public for a non-final private method in an extensible class
    Then Make Public explains the override risk, disables Apply, and preserves the original project
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-interface
  Scenario: Extract a public primitive method into an interface from the saved class cursor and roll it back
    Given the SDK refactoring GUI has a real Maven project with a supported public class method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person extracts an interface from the saved Java class cursor and rolls it back
    Then Extract Interface passes Maven verify on a source copy and removes the generated interface on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-extract-superclass
  Scenario: Extract a public primitive method into a superclass from the saved class cursor and roll it back
    Given the SDK refactoring GUI has a real Maven project with a supported superclass extraction method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person extracts a superclass from the saved Java class cursor and rolls it back
    Then Extract Superclass passes Maven verify on a source copy and removes the generated superclass on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-move-member
  Scenario: Move a saved static Java method into a provider-selected destination type
    Given the SDK refactoring GUI has a real Maven project with a "static-method" Move Member method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person selects a Java destination type and applies verifies and rolls back Move Member
    Then Move Member updates the bound call passes Maven tests and restores the original source on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-move-member
  Scenario: Refuse moving an unsupported Java instance method without changing project files
    Given the SDK refactoring GUI has a real Maven project with a "instance-method" Move Member method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person selects a Java destination type and reviews the unsupported instance member move
    Then the unsupported Move Member request leaves Apply disabled and all project files unchanged
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-pull-up-member
  Scenario: Pull one supported final method into its direct superclass and roll it back
    Given the SDK refactoring GUI has a real Maven project with one supported Pull Up Method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Pull Up Method from the saved Java cursor
    Then Pull Up Method passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-push-down-member
  Scenario: Push one supported final method into its only direct child and roll it back
    Given the SDK refactoring GUI has a real Maven project with one supported Push Down Method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Push Down Method from the saved Java cursor
    Then Push Down Method passes Maven verify on a source copy and restores the original method on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-encapsulate-field
  Scenario: Encapsulate a parameterized field from the Java Project model and roll back
    Given the SDK refactoring GUI has a real Maven project with a bound parameterized field and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back Encapsulate Field from the Java Project model
    Then Encapsulate Field updates bound reads, passes Maven verify on a source copy, and restores all original sources
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-cursor-parameter-addition
  Scenario: Add a method parameter from the saved Java cursor and roll back
    Given the SDK refactoring GUI has a real Maven project with a two-parameter method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person adds and rolls back a method parameter from the Monaco cursor
    Then adding a method parameter passes Maven verify on a source copy and restores the original declaration and call
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-cursor-parameter-removal
  Scenario: Remove an unused method parameter from the saved Java cursor and roll back
    Given the SDK refactoring GUI has a real Maven project with an unused method parameter and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews parameter removal from the Monaco cursor for a side-effecting argument and a literal argument
    Then removing a method parameter passes Maven verify on a source copy and restores the original declaration and call
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-cursor-parameter-type-change
  Scenario: Change a method parameter type from the saved Java cursor and roll back
    Given the SDK refactoring GUI has a real Maven project with a two-parameter method and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person changes and rolls back a method parameter type from the Monaco cursor
    Then the parameter type change passes Maven verify on a source copy and restores the original declaration and call
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-draft-restart
  Scenario: Review cancel and restore a durable draft class rename after IDE restart
    Given the SDK refactoring GUI has a real Maven reference project and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person restarts the IDE and reviews recovery of an applied draft class rename
    Then durable recovery restores the reviewed original drafts after cancellation without saving sources
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-draft-restart
  Scenario: Restore a durable Gradle draft class rename after IDE restart
    Given the SDK refactoring GUI has a real Gradle reference project for draft recovery
    When the person opens a saved Java source and builds and evaluates its Gradle project
    And the person restarts the IDE and reviews recovery of an applied draft class rename
    Then durable recovery restores the reviewed original drafts after cancellation without saving sources
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-draft-restart
  Scenario Outline: Restore a Maven draft class rename after losing the Apply confirmation <frame>
    Given the SDK refactoring GUI has a real Maven reference project and a capable daemon
    And the Apply confirmation "<frame>" will be interrupted in transit
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person restarts the IDE and reviews recovery after losing the Apply confirmation
    Then durable recovery restores the reviewed original drafts after cancellation without saving sources
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | frame    |
      | request  |
      | response |

  @native-java-draft-restart
  Scenario: Restore a Maven draft class rename after interruption during the saved-source move
    Given the SDK refactoring GUI has a real Maven reference project and a capable daemon
    And the desktop will stop immediately after the saved-source rename
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person restarts the IDE after it stops during the saved-source move
    Then durable recovery restores the reviewed original drafts after cancellation without saving sources
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-draft-refactoring
  Scenario: Apply and undo a draft member rename from the Monaco keyboard shortcut and formatting
    Given the SDK refactoring GUI has a real Maven reference project and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and undoes draft member rename from the editor shortcut and formatting without saving
    Then the original dirty Java drafts and every saved input are restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-draft-imports-rename
  Scenario: Apply and undo draft import organization and class rename from the Monaco keyboard shortcut
    Given the SDK refactoring GUI has a real Maven reference project and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and undoes draft import organization and class rename through the editor shortcut without saving
    Then the original dirty Java drafts and every saved input are restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-project-model-class-refactoring
  Scenario: Move classes within and across Maven modules, including a new destination package, refuse Java-referenced deletion and keep Maven-referenced safe delete read-only
    Given the SDK refactoring GUI has a real Maven project with a referenced Java type and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back move, refuses Java-referenced deletion and keeps Maven-referenced safe delete review-only
    Then project-model class refactorings restore exact inputs after same-module and dependency-module moves, create the selected destination package, update the dependent source, and refuse unsafe deletion while the open Java tab follows the move and rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-project-model-class-refactoring
  @native-java-project-model-class-refactoring-command-palette
  Scenario: Review Java class moves from the command palette and preserve safe-delete refusals
    Given the SDK refactoring GUI has a real Maven project with a referenced Java type and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back class moves from the command palette, refuses Java-referenced deletion and keeps Maven-referenced safe delete review-only
    Then command-palette class moves restore exact inputs after same-module and dependency-module moves, create the selected destination package, update the dependent source, and refuse unsafe deletion
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-project-model-package-refactoring
  Scenario: Move an exact package across Maven modules from the Java project model and roll it back
    Given the SDK refactoring GUI has a real Maven package migration project and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back a package move from the Java project model
    Then project-model package moves pass offline project tests after Apply and restore every original source input on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-project-model-package-refactoring-command-palette
  Scenario: Review, apply and roll back a package move from the Java command palette
    Given the SDK refactoring GUI has a real Maven package migration project and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back a package move from the command palette
    Then project-model package moves pass offline project tests after Apply and restore every original source input on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-project-model-package-refactoring
  Scenario: Move an exact package across Gradle modules from the Java project model and roll it back
    Given the SDK refactoring GUI has a real Gradle package migration project and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back a package move from the Java project model
    Then project-model package moves pass offline project tests after Apply and restore every original source input on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-project-model-class-refactoring
  Scenario: Apply and roll back an attested Gradle project-model class move
    Given the SDK refactoring GUI has a real Gradle multi-module project with an unreferenced Java type and a capable daemon
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back an attested Gradle project-model class move
    Then Gradle project-model class moves pass offline project tests after Apply and restore every original source input on rollback
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-cross-module-class-move
  Scenario: Move a referenced Java class into a new package in another Gradle module and roll it back
    Given the SDK refactoring GUI has a real Gradle multi-module project with an application class used by another application source
    When the person opens a saved Java source, compiles the Gradle project and synchronizes its selected project JDK
    And the person moves the Gradle application class into a new package in the library module and rolls it back
    Then the Gradle application test calls the moved library class and rollback restores every original input
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-gradle-class-move-recovery
  Scenario: Recover a Gradle class move after RefactorKit reports missing compiler outputs
    Given the SDK refactoring GUI has a real Gradle multi-module project with an application class used by another application source
    When the person opens a saved Java source and synchronizes its selected project JDK
    Then the move preview reports missing Gradle compiler outputs and keeps the saved sources intact
    When the person builds and tests the synchronized application in Java Run
    And the person resynchronizes Gradle and retries the move through Apply and Rollback
    Then the Gradle application test calls the moved library class and rollback restores every original input
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-reference-development
  Scenario Outline: Build, test, debug, refactor and run a six-module <tool> Java project
    Given the SDK refactoring GUI has a six-module <tool> project and a standard RefactorKit installation
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person builds and tests the synchronized application in Java Run
    And the person debugs the application, stops at the saved source breakpoint and continues to completion
    And the person moves a referenced Java class to the library, verifies the changed project and rolls it back
    And the person runs the restored application and verifies its selected JDK and generated and runtime dependencies
    And the person opens the generated Java method from its call site with F12
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-project-model-source-root-refactoring
  Scenario: Apply and roll back a source-root move from the synchronized project context
    Given the SDK refactoring GUI has a real Maven project with two Build Helper custom source roots in one module
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back a source-root move from the Java project context
    Then the moved source passes an offline module test and rollback restores the exact original inputs
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-project-model-source-root-refactoring
  Scenario: Apply and roll back a Gradle source-root move from the evaluated project context
    Given the SDK refactoring GUI has a real Gradle project with two source roots in one module
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person applies and rolls back a source-root move from the Java project context
    Then the moved source passes an offline module test and rollback restores the exact original inputs
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved


  @native-java-signature-hierarchy
  Scenario: Add a parameter to an interface and implementation after acknowledging external callers
    Given the SDK refactoring GUI has a Maven interface implementation and calls through both types
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person adds and rolls back a method parameter from the Monaco cursor
    Then adding a method parameter passes Maven verify on a source copy and restores the original declaration and call
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved


  @native-java-signature-hierarchy-variants
  Scenario Outline: Review a source signature hierarchy with explicit external-consumer risk acceptance
    Given the SDK refactoring GUI has a Maven <operation> signature hierarchy
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies verifies and rolls back the signature hierarchy change
    Then the acknowledged signature hierarchy and both calls are verified and restored
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | operation |
      | reorder   |
      | remove    |
      | type      |


  @native-java-functional-reference-signature
  Scenario: Add a parameter and explicitly adapt a static method reference to a lambda
    Given the SDK refactoring GUI has a Maven static method reference and a direct call
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person adds and rolls back a method parameter from the Monaco cursor
    Then the static method reference becomes a verified lambda and exact rollback restores it
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-bound-reference-signature
  Scenario: Add a parameter and explicitly adapt a bound instance reference to a lambda
    Given the SDK refactoring GUI has a Maven bound instance reference and a direct call
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person adds and rolls back a method parameter from the Monaco cursor
    Then the bound instance reference becomes a verified lambda and exact rollback restores it
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved


  @native-java-constructor-selection-refusal
  Scenario: Explain an unavailable constructor cursor selection without creating a plan
    Given the SDK refactoring GUI has a Maven constructor with new calls and a constructor reference
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person requests Add Parameter at the saved constructor cursor
    Then the provider constructor-selection limitation is explained and the source is preserved
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-constructor-signature-basic
  Scenario Outline: Review and restore a constructor <operation> signature with an unrelated overload
    Given the SDK refactoring GUI has a Maven <operation> constructor signature and an unrelated overload
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies verifies and rolls back the constructor signature change
    Then the constructor signature and bound call are verified and restored with the overload unchanged
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | operation |
      | rename    |
      | add       |
      | reorder   |

  @native-java-constructor-signature-variants
  Scenario Outline: Review and restore a constructor <operation> signature with an unrelated overload
    Given the SDK refactoring GUI has a Maven <operation> constructor signature and an unrelated overload
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies verifies and rolls back the constructor signature change
    Then the constructor signature and bound call are verified and restored with the overload unchanged
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | operation |
      | remove    |
      | type      |

  @native-java-constructor-reference-signature
  Scenario: Add a constructor parameter and explicitly adapt its reference to a lambda
    Given the SDK refactoring GUI has a Maven constructor reference direct call and unrelated overload
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies verifies and rolls back the constructor signature change
    Then the constructor reference becomes a verified lambda and exact rollback restores it
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-constructor-delegation-basic
  Scenario Outline: Review and restore a constructor <operation> signature with this and super delegation
    Given the SDK refactoring GUI has a Maven <operation> constructor signature with this and super delegation
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies verifies and rolls back the constructor signature change
    Then both constructor delegations are verified and restored with the overload unchanged
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | operation |
      | rename    |
      | add       |
      | reorder   |

  @native-java-constructor-delegation-variants
  Scenario Outline: Review and restore a constructor <operation> signature with this and super delegation
    Given the SDK refactoring GUI has a Maven <operation> constructor signature with this and super delegation
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews applies verifies and rolls back the constructor signature change
    Then both constructor delegations are verified and restored with the overload unchanged
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | operation |
      | remove    |
      | type      |

  @native-java-project-commands-maven
  Scenario: Synchronize a maven project from Commands while preserving an unsaved Java edit
    Given the Java Project command GUI has a real maven reference project
    When the person synchronizes the selected project from Commands with an unsaved Java edit
    Then Java Project displays the effective context and preserves the unsaved edit and saved inputs
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-project-commands-gradle
  Scenario: Synchronize a gradle project from Commands while preserving an unsaved Java edit
    Given the Java Project command GUI has a real gradle reference project
    When the person synchronizes the selected project from Commands with an unsaved Java edit
    Then Java Project displays the effective context and preserves the unsaved edit and saved inputs
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

  @native-java-field-type-change
  Scenario Outline: Review a <visibility> field type without confusing a shadowing local
    Given the field-type GUI has a Maven <visibility> field and a shadowing local
    When the person opens a saved Java source and synchronizes its selected project JDK
    And the person reviews the saved Java field type through RefactorKit
    Then the field type is verified and restored or its unsupported visibility is refused without changes
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | visibility |
      | private    |
      | public     |

  @native-java-gradle-module-rename-groovy
  Scenario Outline: Review an <mode> Gradle project rename with groovy settings
    Given the Gradle rename GUI has an <mode> project using "groovy" settings
    When the person explicitly evaluates the Gradle rename project
    And the person reviews renaming the selected Gradle project
    Then the Gradle rename is built and rolled back or its inbound dependency is refused without changes
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | mode            |
      | app             |
      | dynamic-library |

  @native-java-gradle-module-rename-kotlin
  Scenario Outline: Review an <mode> Gradle project rename with kotlin settings
    Given the Gradle rename GUI has an <mode> project using "kotlin" settings
    When the person explicitly evaluates the Gradle rename project
    And the person reviews renaming the selected Gradle project
    Then the Gradle rename is built and rolled back or its inbound dependency is refused without changes
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | mode            |
      | app             |
      | dynamic-library |

  @native-java-gradle-module-rename-inbound
  Scenario Outline: Review Gradle rename with <mode> dependencies using <dsl> settings
    Given the Gradle rename GUI has an <mode> project using "<dsl>" settings
    When the person explicitly evaluates the Gradle rename project
    And the person reviews renaming the selected Gradle project
    Then the Gradle rename is built and rolled back or its inbound dependency is refused without changes
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | mode            | dsl    |
      | literal-library | groovy |
      | literal-library | kotlin |
      | dynamic-library | groovy |

  @native-java-gradle-module-rename-application-inbound
  Scenario Outline: Review a library rename in a Gradle application using <dsl> settings
    Given the Gradle rename GUI has an application-library project using "<dsl>" settings
    When the person explicitly evaluates the Gradle rename project
    And the person reviews renaming the selected Gradle project
    Then the Gradle rename is built and rolled back or its inbound dependency is refused without changes
    When the person closes the SDK refactoring IDE
    Then the SDK refactoring IDE exits cleanly with the original sources preserved

    Examples:
      | dsl    |
      | groovy |
      | kotlin |
