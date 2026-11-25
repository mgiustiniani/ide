@REQ-IDE-GIT-SOURCE-CONTROL-001 @partial @desktop @native-gui @e2e @functional-requirement
Feature: Explicit local Git changes, staging and commits
  A Java developer reviews saved changes and the Git index without losing editor drafts.
  Git owns repository interpretation, hooks and commits; the IDE scopes explicit actions to
  the active workspace and never saves a buffer as a side effect of a Git action.
  Saved-source blame line navigation requires fresh Git evidence and an unchanged clean editor buffer.

  Scenario: Review and commit saved Java changes while retaining an unrelated editor draft
    Given the native Git GUI has an isolated repository with saved Java changes
    When the person reviews, stages, unstages and commits the saved Java file while retaining a notes draft
    Then Git records only the staged Java version, honors its hook and preserves the notes draft
    When the person discards the notes draft and reopens the Git IDE
    Then Git trust is reset and the existing index is unchanged after restart
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved

  Scenario: Keep the native window and workspace active while a real Git commit hook is pending
    Given the native Git GUI has an isolated repository with a held pre-commit hook
    When the person tries native close and workspace switching while the Git hook is pending
    Then the Git mutation refuses both transitions and permits switching after completion
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved

  Scenario: Create, rename and switch local branches without losing saved files or editor drafts
    Given the native Git GUI has an isolated repository with distinct local branches
    When the person creates a branch and switches after resolving editor and saved-file conflicts
    Then Git preserves drafts and saved conflicts and refreshes clean buffers with a usable save baseline
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved

  Scenario: Review, abort and resolve a local Java merge without losing editor changes
    Given the native Git GUI has an isolated repository with diverging Java branches
    When the person aborts a reviewed conflict and then resolves and commits the Java merge
    Then Git preserves drafts, restores the aborted merge and records a compilable two-parent resolution
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved

  Scenario: Review and recover a linear local Java rebase without losing editor drafts
    Given the native Git GUI has an isolated repository with a linear Java rebase
    When the person reviews, aborts and then resolves and continues the local Java rebase
    Then Git rewrites only the reviewed branch, preserves drafts and compiles the resolved Java source
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved

  @native-git-history
  Scenario: Browse older Java commits and review deleted source without changing editor drafts
    Given the native Git GUI has an isolated repository with more than fifty historical Java commits
    When the person pages committed Java history, reviews a deleted file and encounters an external commit
    Then historical reviews preserve drafts and the index and refuse the retired Git page
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved

  @native-git-branch-deletion
  Scenario: Delete reviewed merged and unmerged local branches while retaining Java source and drafts
    Given the native Git GUI has isolated merged and unmerged local branches
    When the person reviews local branch deletion, rejects a stale target and explicitly confirms forced deletion
    Then Git deletes only the confirmed local branches while preserving the current source, index and editor draft
    When the person closes the Git source-control IDE
    Then the Git source-control IDE exits with source files preserved
