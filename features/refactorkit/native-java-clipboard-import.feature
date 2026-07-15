Business Need: Trustworthy deterministic native Java clipboard import
  To validate the desktop import boundary without trusting a developer-installed provider
  A Java developer needs one reviewed clipboard class to cross the real native GUI and remain confined to an isolated workspace transaction.

  This requirement is bounded to a deterministic sandbox-owned RefactorKit fixture and a fresh Linux X11 release/no-bundle Tauri executable.
  It makes no claim about a real, global, immutable, or packaged RefactorKit provider; provider metadata or provider no-write behavior; an application package or installer; Wayland or another operating system; user-facing rollback; or the cancellation and stale-generation matrix of REQ-REFACTORKIT-JAVA-IMPORT-001.
  Complete evidence could justify @implemented-and-validated only for this deterministic native integration boundary.

  @REQ-REFACTORKIT-JAVA-IMPORT-002 @desktop @native-gui @functional-requirement @security @resilience @not-implemented
  Scenario: Cancel and then apply one clipboard class through the isolated native desktop integration
    Given one scenario sandbox contains the authorized Maven-like workspace and isolated HOME and XDG state
    And the workspace contains the existing package directory "src/main/java/example/imports"
    And "src/main/java/example/imports/ClipboardImportProof.java" does not exist
    And a sandbox-owned Linux X11 clipboard owner holds exactly:
      """
      package example.imports;

      public final class ClipboardImportProof {
        public static final String REQUIREMENT = "REQ-REFACTORKIT-JAVA-IMPORT-002";
      }
      """
    And a sandboxed deterministic daemon advertises all of these RefactorKit capabilities:
      | declaration                  | conformant contract                                           |
      | API version                  | 0.2                                                          |
      | java.importExternalClass     | targetDirectory, preview, apply, discard, and rollback       |
      | refactor.apply               | available                                                    |
      | refactor.discard             | available                                                    |
      | patch.rollback               | available                                                    |
    And its absolute executable is selected only through "IDE_ALLOW_REFACTORKIT_DAEMON_OVERRIDE=1" and the guarded production "IDE_REFACTORKIT_DAEMON" override
    And the process environment cannot discover a global RefactorKit command or daemon
    When a freshly built production release/no-bundle Tauri executable is launched directly on Linux X11 with the scenario HOME, XDG, workspace, daemon, and clipboard state
    And the developer expands the actual File Explorer to "src/main/java/example/imports"
    And opens that directory's actual context menu and chooses "Paste Java Class from Clipboard"
    Then the production native clipboard command reads the exact fixture once from the Linux X11 clipboard owner for the first preview
    And the deterministic daemon accepts that exact fixture and selected directory for the first preview
    And the actual review dialog binds the first plan to all of this evidence:
      | evidence               | reviewed value                                                  |
      | target                 | src/main/java/example/imports                                    |
      | affected primary file  | create src/main/java/example/imports/ClipboardImportProof.java   |
      | provenance and license | clipboard source, no source URL, unknown license, warn policy    |
      | risk                   | high                                                             |
    And "src/main/java/example/imports/ClipboardImportProof.java" is still absent
    When the developer chooses "Cancel" in the actual review dialog
    Then exactly one discard is correlated to the first reviewed plan
    And no Apply request or project-content write occurs for that plan
    And "src/main/java/example/imports/ClipboardImportProof.java" remains absent
    When the developer repeats the actual directory context-menu action
    Then the production native clipboard command reads the exact fixture once from the Linux X11 clipboard owner for the second preview
    And the daemon returns a distinct fresh plan for the same exact fixture and selected directory
    And the actual review dialog requires acknowledgement of the fresh plan's unknown-license and high-risk evidence before Apply is enabled
    When the developer gives that acknowledgement and chooses "Apply Import"
    Then the production Apply command sends only these fresh plan authority fields:
      | field                       |
      | planId                      |
      | workspaceId                 |
      | workspaceGeneration         |
      | selectionGeneration         |
      | requestId                   |
      | approval.approvalId         |
      | approval.approvedPlanId     |
      | approval.approvedAt         |
    And it sends no clipboard source, code, patch, target directory, or target package
    And the deterministic daemon reports and exclusively writes exactly one changed and primary target, "src/main/java/example/imports/ClipboardImportProof.java"
    Then the refreshed actual File Explorer shows "src/main/java/example/imports/ClipboardImportProof.java"
    And the selected editor tab is exactly "ClipboardImportProof.java"
    And real Monaco shows the exact logical clipboard fixture
    And the source-free retained daemon transcript proves exact preview, correlated discard, fresh-plan Apply, and the one reported target without containing clipboard source text
    When the native window is closed and scenario cleanup releases the X11 clipboard owner
    Then the application, deterministic daemon, and clipboard-owner processes exit cleanly
    And all HOME, XDG, workspace, daemon, transcript, and clipboard-owner effects remain confined to the scenario sandbox
    And the workspace contains no ".refactorkit/workspace.lock"
