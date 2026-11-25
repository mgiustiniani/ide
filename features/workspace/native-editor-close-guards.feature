@REQ-IDE-EDITOR-CLOSE-GUARDS-001 @desktop @native-gui @functional-requirement @non-functional-requirement @resilience @partial
Business Need: Protect unsaved buffers during tab, workspace and native-window transitions
  People editing source must not lose buffer edits or overwrite another writer's changes during a close or workspace transition.

  Closing a dirty tab saves it only when the disk revision is current. A conflicting save retains the tab.
  Workspace switching and the standard native X11 window-close request refuse while any source buffer is dirty.
  Linux release/no-bundle qualification includes unsafe transitions and newer keyboard edits during a genuinely held source Save.
  These scenarios are not installer, other-OS, general unload, confirmation-race, or all close-lifecycle qualification.

  Scenario: Refuse unsafe transitions and accept explicitly resolved native closes
    Given the close-guard GUI has two isolated registered workspaces and deterministic source files
    When the production close-guard IDE opens the primary workspace
    And the person edits both guard buffers without saving
    And an external writer changes the guard source
    And the person closes the conflicting guard tab
    Then the tab refusal preserves both dirty buffers and the external revision
    When the person selects the other workspace while guard buffers are dirty
    Then the workspace refusal retains the current workspace and source buffers
    When the person requests the owned native window close through X11
    Then the native close refusal leaves the IDE responsive with both dirty buffers
    When the person closes the other guard tab with a current save revision
    Then that tab is saved before closing and the conflicting buffer is retained
    When the person explicitly adopts the guard disk version and switches to the other workspace
    Then the resolved workspace transition retains the destination source unchanged
    When the person closes the clean guard IDE through the same X11 protocol
    Then the clean IDE exits with only the explicit tab save and external write on disk

  @native-editor-save-close-race
  Scenario: Retain newer keyboard edits while a real source Save is pending during tab close
    Given the native Save-close race has isolated original and companion source files
    When the production IDE opens and acknowledges both keyboard-edited race buffers
    And the person requests tab close while a real Linux file lease holds source I/O
    And the person types newer buffer edits before releasing the held source I/O
    Then the pending close writes only its captured source and retains newer dirty edits and the companion
    When the person explicitly saves the retained newer race buffer
    Then the source contains the newer edits and the companion source is still unchanged
    When the person explicitly discards the companion draft and closes the clean race IDE through X11
    Then the owned race IDE exits with only the explicit saves and confined storage
