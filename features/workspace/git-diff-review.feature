Business Need: Read-only hunk-level diff review of modified files in the Changes surface
  To review uncommitted edits safely without mutating the working tree
  People reviewing changes need a read-only hunk-level diff with line and range metadata, an exact-range editor open, and an honest failure mode when the platform cannot produce a diff.

Ability: Review modified files through frontend ports and open exact diff ranges in the existing editor
  The IDE can list modified files from the workspace changes surface, produce a read-only hunk-level diff with line/range metadata, open the exact file path and range in the existing editor, and report unavailable honestly without a mock-only or hard-coded response.

Feature: Read-only git diff review behind frontend ports
  This requirement covers the read-only hunk-level diff flow, the exact-range editor open, and the honest unavailable reporting through the workspace-changes, read-only-diff, and editor-open-range frontend ports.
  Working-tree write authority, new AI/model dependencies, and platform API imports in web-first layers are outside its scope.

  @REQ-IDE-GIT-DIFF-REVIEW-001 @story-bdd @diff-review @tier-a @web @functional-requirement @implemented-and-validated
  Scenario: A modified file appears as a read-only hunk-level diff in the Changes surface
    Given an open workspace with a modified file "src/lib/git.ts"
    When the Changes surface is asked to review the modified file
    Then the Changes surface returns a read-only hunk-level diff for the modified file
    And the hunk-level diff carries line and range metadata
    And no write operation touched the working tree during the review

  @REQ-IDE-GIT-DIFF-REVIEW-002 @story-bdd @diff-review @tier-a @web @functional-requirement @implemented-and-validated
  Scenario: Activating a diff range opens the exact file and range in the existing editor
    Given an open workspace with a modified file "src/lib/git.ts"
    And a visible read-only hunk-level diff range from line 42 to line 60
    When the person activates the diff range in the Changes surface
    Then the existing editor port opens the exact path "src/lib/git.ts" at lines 42 to 60
    And the IDE creates no new AI or model dependency for the open operation

  @REQ-IDE-GIT-DIFF-REVIEW-003 @story-bdd @diff-review @tier-a @web @functional-requirement @implemented-and-validated
  Scenario: A platform that cannot produce a diff reports unavailable honestly
    Given an open workspace with a modified file "src/lib/git.ts"
    And a platform that cannot produce a diff for the modified file
    When the diff adapter is asked to produce the diff
    Then the diff adapter reports unavailable honestly with a platform reason
    And the diff adapter does not fall back to a mock-only or hard-coded response

  @REQ-IDE-GIT-DIFF-REVIEW-004 @story-bdd @diff-review @tier-a @web @non-functional-requirement @implemented-and-validated
  Scenario: Web-first layers stay free of platform API imports and diff implementations live behind ports
    Given the web-first layers packages/ui, packages/web-core, and apps/web
    When their source is scanned for platform API imports
    Then no import of @tauri-apps/api is present in the web-first layers
    And browser and Tauri diff implementations live behind the frontend ports
