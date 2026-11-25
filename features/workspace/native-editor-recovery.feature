@REQ-IDE-EDITOR-RECOVERY-001 @desktop @native-gui @functional-requirement @non-functional-requirement @resilience @partial
Business Need: Recover unsaved editor buffers without silently overwriting source files
  People editing a workspace need acknowledged checkpoints to survive a terminated IDE and remain available for explicit review and restoration.

  These focused scenarios use the real Linux release/no-bundle application, keyboard editing, private native storage and explicit review.
  Restart checks use SIGKILL only on the observed owned application and a second GUI process with the same isolated workspace and user storage.
  History is generated through real editing/checkpoint commands, not an injected journal. The storage-error fixture temporarily obstructs the journal pathname while retaining its original bytes.
  Count-retention checks create every acknowledged version through native keyboard editing and checkpoint commands; journal contents are observed, never injected.
  Capacity checks exceed the per-buffer UTF-8 limit through real Undo and typing, with full buffer copying observed through the native clipboard.
  The corruption fixture truncates an issued journal while retaining its exact valid bytes; repair is an explicit external fixture action, not an automatic product reset.
  The remaining qualification scope is maintained in [ARC42](../../ARC42.md#101-verification-scope).
  The broader recovery/history capability retains a conservative partial declaration.

  @native-recovery-restart
  Scenario: Review and restore an acknowledged draft after native IDE termination
    Given the recovery GUI uses an isolated workspace with two deterministic source files and private user storage
    When the production recovery IDE is launched through the native driver
    And the person replaces the recovery buffer through the keyboard without saving
    Then the automatic recovery checkpoint is acknowledged while both source files remain unchanged
    When the owned recovery IDE is forcibly terminated without closing or saving
    And the recovery IDE is relaunched with the same workspace and user storage
    Then its previous-session draft is visible without automatically replacing the disk buffer
    When the person makes the companion buffer dirty without saving
    And the person reviews the previous-session recovery checkpoint
    And the person cancels the recovery review
    Then cancelling has retained the original buffer, dirty companion and both disk sources
    When the person reviews the previous-session recovery checkpoint again
    And an external writer changes the source after that review
    And the person explicitly restores the reviewed recovery checkpoint
    Then the recovered buffer is dirty, the companion edits survive and the original checkpoint is retained
    When the person tries to save the recovered buffer over the later external revision
    Then Save is visibly refused and the later disk revision is preserved
    When the person explicitly discards both dirty buffers through disk comparison and closes the recovered IDE
    Then the recovered IDE exits without changing source files or escaping its isolated storage

  @native-recovery-history
  Scenario: Select exact history versions and remove only an explicitly confirmed checkpoint
    Given the history GUI has an isolated workspace with two deterministic source files
    When the production history IDE opens its source file
    And the person edits and explicitly checkpoints the first history version
    Then the first history checkpoint is acknowledged without a source save
    When the person checkpoints a second version and leaves newer source and companion edits dirty
    Then both older histories are selectable and removal of the current draft is disabled
    When the person reviews and cancels each of the two older history versions
    Then the exact selected texts were presented without replacing either current dirty buffer
    When the person explicitly restores the first local-history version
    Then history restoration changes only the reviewed buffer and retains its checkpoint and unrelated edits
    When the person requests removal of the second history checkpoint but cancels confirmation
    Then cancelled history removal preserves the journal, source bytes and dirty buffers
    When the person separately confirms permanent removal of the second history checkpoint
    Then only that selected checkpoint disappears from native storage and the visible inventory
    When the person explicitly discards both history scenario drafts and closes the clean IDE through X11
    Then the history IDE exits with both original source files unchanged

  @native-recovery-history
  Scenario: Rotate workspace history at its count limit while preserving both current drafts
    Given the retention GUI has an isolated workspace with two deterministic source files
    When the production history IDE opens its source file
    And the person edits and explicitly checkpoints the first history version
    And the person checkpoints three companion versions and returns to the source
    And the person types and acknowledges 102 successive source versions without saving
    Then exactly the newest 100 histories and both current drafts remain in native storage and the inventory
    When the person reviews and cancels the oldest and newest retained source histories
    And the person restores the newest retained source history after rotation
    Then restoration after rotation preserves the companion draft and both saved sources
    When the person explicitly discards both history scenario drafts and closes the clean IDE through X11
    Then the history IDE exits with both original source files unchanged

  @native-recovery-failures
  Scenario: Copy an acknowledged checkpoint whose source was deleted before native restart
    Given the missing-source recovery GUI has an isolated workspace with deterministic sources
    When the production history IDE opens its source file
    And the person edits and explicitly checkpoints the first history version
    And the owned history IDE is terminated and an external writer deletes that checkpoint's source file
    And the missing-source history IDE is relaunched with the same workspace and private storage
    And the person reviews the missing source's recoverable draft
    Then the missing-source review retains its checkpoint text and disables automatic buffer replacement
    When the person selects and copies the missing-source checkpoint through native pointer and keyboard actions
    Then the native clipboard contains the exact checkpoint while the source remains absent
    When the person cancels the missing-source review and closes the clean IDE through X11
    Then the missing-source IDE exits without recreating the file or changing its companion

  @native-recovery-failures
  Scenario: Expose a real journal access failure without turning it into a source-save permission gate
    Given the storage-failure recovery GUI has an isolated workspace with deterministic sources
    When the production history IDE opens its source file
    And the person edits and explicitly checkpoints the first history version
    And the native journal pathname is temporarily obstructed while its valid bytes are retained
    And the person makes a newer edit and requests a checkpoint while storage is obstructed
    Then a visible recovery failure retains the dirty buffer, unchanged source and previous journal bytes
    When the person requests ordinary Save while recovery storage remains obstructed
    Then the source Save succeeds without hiding the recovery failure or changing the retained journal
    When the journal pathname is repaired and the person explicitly retries checkpointing
    Then recovery becomes ready again and its earlier acknowledged checkpoint remains selectable
    When the person closes the clean storage-retry IDE through X11
    Then the storage-retry IDE exits with only the explicit source Save on disk

  @native-recovery-capacity-corruption
  Scenario: Refuse a buffer one UTF-8 byte over recovery capacity without evicting its previous checkpoint
    Given the capacity recovery GUI has a source of exactly one MiB UTF-8 and an isolated companion
    When the production capacity IDE creates two small acknowledged drafts through keyboard editing
    Then both checkpoints are acknowledged while the original source bytes are unchanged
    When the person undoes the source edit and types one extra byte at the end
    And the person requests a checkpoint of that oversized recovery buffer
    Then recovery visibly refuses while the exact oversized buffer, companion draft and previous journal bytes survive
    When the person refreshes checkpoint inventory without shrinking the oversized buffer
    Then refresh does not hide the failed checkpoint or claim the newest edits are durable
    When the person explicitly saves the oversized source buffer
    Then ordinary Save writes those exact bytes and clears only that source buffer's dirty state
    When the person explicitly checkpoints the remaining valid companion draft
    Then recovery becomes ready and the original small source checkpoint is retained as history
    When the person explicitly discards the capacity companion draft and closes the clean IDE through X11
    Then the capacity IDE exits with only the explicit source Save on disk

  @native-recovery-capacity-corruption
  Scenario: Preserve a truncated journal through restart and source Save and recover only after explicit external repair
    Given the corruption recovery GUI has isolated deterministic sources and private storage
    When the production corruption IDE acknowledges a small unsaved source checkpoint
    Then the issued checkpoint is acknowledged without changing either source file
    When the owned corruption IDE is terminated and the issued journal is truncated with its valid bytes retained
    And the corruption IDE is relaunched with the same isolated workspace and storage
    Then startup reports unreadable recovery storage without restoring a buffer or replacing the truncated journal
    When the valid journal is externally repaired and the person retries checkpointing with no dirty buffers
    Then the retry revalidates storage and presents the original recoverable draft without a source write
    When the journal is truncated again and the person edits both source and companion buffers
    And the person requests a checkpoint while the journal is corrupt
    Then the corrupt journal, valid retained bytes and both dirty buffers survive the visible failure
    When the person explicitly saves the source while recovery storage remains corrupt
    Then the source Save succeeds while the journal remains untouched and the companion stays dirty
    When the valid journal is externally repaired and the person retries the remaining dirty checkpoint
    Then recovery becomes ready with the original issued draft retained and its review does not replace the saved source
    When the person explicitly discards the corruption companion draft and closes the clean IDE through X11
    Then the corruption IDE exits with only the deliberate source Save and external journal repair

  @native-editor-storage-full @e2e
  Scenario Outline: Exhaust a bounded filesystem and recover through the native editor
    Given the native editor has an isolated <storage> filesystem limited to one MiB
    When the person exhausts that filesystem and retries after releasing space
    Then the source and recovery behavior retain the inspected data through ENOSPC
    When the person closes the storage-full IDE normally
    Then the bounded filesystem scenario releases its native processes and environment

    Examples:
      | storage  |
      | source   |
      | recovery |
