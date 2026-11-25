@REQ-IDE-EDITOR-DISK-COMPARISON-001 @desktop @native-gui @functional-requirement @non-functional-requirement @resilience @partial
Business Need: Resolve editor and disk differences without hidden writes or lost drafts
  People editing files need read-only inspection, explicit buffer adoption and revision-safe subsequent saving.

  These Linux release/no-bundle GUI scenarios use real keyboard, pointer and native file commands, plus deliberate external fixture writes or deletion.
  Saving while a comparison is open makes that review obsolete; a later external disk revision is protected even after explicit adoption of the inspected snapshot.
  The asynchronous-adoption scenario changes the source from an external writer while the real recovery checkpoint is pending, then verifies that Save refuses the newer disk revision until it is freshly inspected.
  In-buffer edits during modal confirmation, automatic watching, three-way merge, other OSes and installers remain separate qualification work.

  Scenario: Cancel inspection, refuse a saved-baseline stale review and preserve later external writes
    Given the disk-comparison GUI has two isolated deterministic source files
    When the production disk-comparison IDE opens and the person makes both buffers dirty
    And the person inspects the original disk source beside the draft
    And the person cancels disk inspection with Escape
    Then cancelling disk inspection has retained both drafts and both source files
    When the person inspects the original disk source beside the draft
    And the person saves through the keyboard while that disk review remains open
    And the person attempts to adopt the obsolete pre-save disk review
    Then the stale comparison refusal retains the explicitly saved buffer instead of loading its old disk text
    When the person edits again, an external writer changes the source, and the person cancels the new inspection
    And the person attempts Save after that cancelled external-disk inspection
    Then cancelled inspection has not advanced the save baseline or overwritten the external revision
    When the person reviews the external disk source again
    And a later external writer changes the source after the disk review
    And the person explicitly adopts only the inspected disk snapshot
    Then the inspected text is a clean buffer but the later disk write and companion draft remain intact
    When the person edits the adopted buffer and attempts Save over the later revision
    Then the later external revision is preserved and the new buffer edits remain dirty
    When the person freshly compares and adopts the latest disk version before editing and saving again
    Then the subsequent ordinary Save succeeds against that newly adopted revision
    When the person explicitly discards the companion draft and closes the clean comparison IDE through X11
    Then the comparison IDE exits with only the deliberate external writes and explicit saves on disk

  Scenario: Report a deleted disk source without recreating it or discarding its open draft
    Given the disk-comparison GUI has two isolated deterministic source files
    When the production disk-comparison IDE opens and the person makes both buffers dirty
    And an external writer deletes the open comparison source
    And the person requests disk inspection of the deleted source
    Then disk inspection reports unavailable while the deleted-source draft and companion edits survive
    When the person requests Save for the deleted comparison source
    Then Save reports failure without recreating the source or clearing either dirty buffer
    When both deleted-source scenario drafts are acknowledged as checkpoints before the owned IDE is terminated
    Then the terminated comparison IDE has not recreated the deleted source or changed the companion file

  Scenario: Preserve a disk write that arrives during asynchronous adoption
    Given the disk-comparison GUI has two isolated deterministic source files
    When the production disk-comparison IDE opens and the person makes both buffers dirty
    And the person reviews a disk snapshot while a new draft checkpoint is pending
    And the person starts adopting the inspected disk snapshot
    And an external writer updates the source while adoption awaits the recovery checkpoint
    Then adoption loads only the inspected snapshot and leaves the later disk write untouched
    When the person edits the adopted buffer and attempts Save over the newer disk revision
    Then the later external write is preserved and the new buffer edits remain dirty
    When the person adopts the latest disk revision and saves a new edit
    Then the subsequent ordinary Save succeeds against that newly adopted revision
    When the person explicitly discards the companion draft and closes the clean comparison IDE through X11
    Then the comparison IDE exits with only the deliberate external writes and explicit saves on disk
