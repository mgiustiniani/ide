Business Need: Controlled desktop import of one external Java class
  To reuse an external Java class without bypassing workspace authority or review
  A Java developer needs the desktop IDE to delegate one explicitly approved clipboard import to RefactorKit as the sole transaction writer.

  This requirement is bounded to one selected existing package directory in an authorized Maven-like workspace.
  User-facing rollback, general refactoring, TypeScript requirements, native GUI or package evidence, and complete hidden-metadata no-write claims are outside its scope.
  Its initial executable target after Story scaffolding is the deterministic desktop/tauri-harness profile, whose evidence can justify at most @implemented-not-e2e-validated.

  @desktop @REQ-REFACTORKIT-JAVA-IMPORT-001 @functional-requirement @security @resilience @not-implemented
  Scenario: Review and apply exactly one external Java class from the clipboard
    Given the authorized Maven-like workspace "java-import-workspace" contains the existing package directory "src/main/java/example/imports"
    And "src/main/java/example/imports/ClipboardImportProof.java" does not exist
    And the clipboard contains exactly:
      """
      package example.imports;

      public final class ClipboardImportProof {
        public static final String REQUIREMENT = "REQ-REFACTORKIT-JAVA-IMPORT-001";
      }
      """
    When the developer opens the actual File Explorer context menu for "src/main/java/example/imports"
    And chooses "Paste Java Class from Clipboard"
    Then before clipboard access the deterministic desktop and Tauri composition accepts all of these RefactorKit declarations:
      | declaration                  | accepted contract                                             |
      | API version                  | 0.2                                                           |
      | java.importExternalClass     | targetDirectory, preview, apply, discard, and rollback         |
      | refactor.apply               | available                                                     |
      | refactor.discard             | available                                                     |
      | patch.rollback               | available                                                     |
    And the clipboard is read exactly once
    And RefactorKit receives the exact clipboard fixture and selected directory for preview
    And the provider-produced review shows all of this evidence:
      | evidence                      | reviewed value                                                                 |
      | target                        | src/main/java/example/imports                                                |
      | placement                     | source root src/main/java, package example.imports, module app                |
      | affected primary file         | create src/main/java/example/imports/ClipboardImportProof.java                |
      | rendered diff                 | the complete create diff for the exact clipboard fixture                      |
      | diagnostic                    | information RK-JAVA-IMPORT-001: Package placement verified                    |
      | provenance and license        | clipboard source, no source URL, unknown license, warn policy                  |
      | risk                          | high                                                                           |
      | conflicts                     | none                                                                           |
      | staleness                     | current with no stale reasons                                                  |
      | blockers                      | backend eligible with no blockers                                              |
    And "src/main/java/example/imports/ClipboardImportProof.java" still does not exist
    And Apply remains disabled until the developer acknowledges the unknown-license and high-risk evidence for this exact plan
    When the developer gives that acknowledgement and chooses "Apply Import"
    Then the Apply request contains only the exact reviewed plan and authority identity fields:
      | field                         |
      | planId                        |
      | workspaceId                   |
      | workspaceGeneration           |
      | selectionGeneration           |
      | requestId                     |
      | approval.approvalId           |
      | approval.approvedPlanId       |
      | approval.approvedAt           |
    And the Apply request contains no clipboard source, code, patch, target directory, or targetPackage
    When RefactorKit reports a successful transaction whose only changed and primary file is "src/main/java/example/imports/ClipboardImportProof.java"
    Then File Explorer refreshes only the backend-reported parent "src/main/java/example/imports"
    And only the backend-reported primary file is routed to the desktop editor
    And the editor composition receives the exact logical clipboard content intended for Monaco
    And the observable composition trace contains no direct IDE filesystem mutation, Pi or AI request, or clipboard-source-bearing log event
    And cancellation or a stale workspace, selection, request, or plan generation prevents Apply, clears retained review state, and requests discard cleanup for each correlated retained or late plan
    And after cleanup failure the bounded observable trace contains no Apply request, imported target, restored review authority, or clipboard source
