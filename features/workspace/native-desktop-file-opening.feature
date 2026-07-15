Business Need: Trustworthy native desktop opening of an existing workspace file
  To prove essential desktop interaction independently of postponed packaging
  People evaluating the desktop IDE need direct file opening to become usable without leaked user state or an unresponsive editor.

  This requirement covers only opening one existing deterministic file at the authorized workspace root.
  Saving, editing, nested navigation, workspace switching, optional tooling, installer or package behavior, and performance benchmarking are outside its scope.

  @REQ-DESKTOP-FILE-OPEN-001 @desktop @native-gui @functional-requirement @non-functional-requirement @resilience @accessibility @not-implemented
  Scenario: Open a deterministic root file through the real native desktop interface
    Given an isolated temporary sandbox contains the authorized workspace and all desktop user state
    And the workspace root contains a deterministic file named "native-open-proof.ts"
    And its unique exact logical content is:
      """
      export const nativeOpenProof = "REQ-DESKTOP-FILE-OPEN-001";
      """
    When the real production release/no-bundle Tauri executable is launched directly instead of a CachyOS package
    Then the authorized File Explorer becomes ready
    And it exposes "native-open-proof.ts" as a visible file item with an accessible name
    When the person clicks that file item
    Then within 15 seconds the selected path is exactly the sandboxed workspace path for "native-open-proof.ts"
    And within the same 15 seconds the active editor tab is exactly "native-open-proof.ts" and exposes its selected state
    And within the same 15 seconds Monaco is ready with the unique exact logical content of "native-open-proof.ts"
    And the editor shows neither an opening placeholder nor a file-open failure
    And the native window remains responsive without hanging
    When the person closes the native window
    Then the executable exits cleanly
    And no state has been written outside the temporary sandbox
