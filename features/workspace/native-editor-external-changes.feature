@REQ-IDE-EDITOR-EXTERNAL-CHANGES-001 @desktop @native-gui @functional-requirement @resilience @partial
Business Need: Notice external disk changes without replacing an editor buffer
  A person needs a passive warning for open files while drafts and revision-protected saves remain under explicit control.
  The focused Linux release/no-bundle check does not qualify recursive watching, merge, transient writes, installers or other operating systems.

  Scenario: Notice an external write and deletion without implicit reload or save-baseline adoption
    Given the external-change GUI has two isolated deterministic source files
    When the external-change IDE opens and the person edits both buffers
    And an external writer changes the inactive open source without changing its byte length
    Then an automatic disk-change warning appears without replacing either draft or writing a source
    When the person reviews and cancels the warned disk version
    And the person requests Save without adopting that version
    Then Save refuses and the warning has not advanced the save baseline
    When the person explicitly adopts the warned disk version
    Then only that buffer becomes clean and its external-change warning clears
    When the person edits the adopted buffer and explicitly saves it
    Then the saved bytes match the new edits without a false external-change warning
    When an external writer deletes the active monitored source
    Then an automatic missing-file warning appears without recreating it or changing the buffer
    When the person edits and requests Save for the missing monitored source
    Then the missing-source Save refuses and both drafts remain intact
    When an external writer deliberately recreates the source and the person explicitly discards both drafts and closes through X11
    Then the monitored IDE exits with only the explicit save and deliberate fixture writes on disk
