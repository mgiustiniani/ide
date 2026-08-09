Business Need: Workspace-bound native Pi Agent continuity
  To work with Pi without losing its native interaction model or project context
  Desktop users need one composite Agent screen that follows the IDE workspace while the real Pi TUI continues in a backend-owned terminal session.

  The existing Workspace Registry, File Explorer, editor, and Pi runtime remain the respective authorities for workspace identity, files, documents, and conversation behavior.
  Changes, Activity, Resources, and Sessions are read-only accessory views; they never mirror Pi messages or act as chat, tool, model, trust, command, extension, compaction, or history authority.
  A docked or detached renderer is only an attachment. Closing either view must not stop Pi; termination requires the separate confirmed Stop Pi action.

  @REQ-PI-WORKSPACE-AGENT-001 @desktop @tauri-harness @native-gui @functional-requirement @non-functional-requirement @resilience @accessibility @implemented-and-validated
  Scenario: Keep two native Pi TUI sessions isolated while navigating, detaching, and restoring workspaces
    Given the existing IDE Workspace Registry contains distinct workspaces A and B
    And workspace A and workspace B each contain a distinct file visible through the existing File Explorer
    And Pi is available as a fixed executable that can run its real interactive TUI in a pseudoterminal
    When the person selects the existing Agent activity for workspace A
    Then the composite Agent screen attaches to a backend-owned Pi pseudoterminal rooted at the exact registered root of workspace A
    And the terminal forwards raw keyboard input, paste, modified Enter sequences, ANSI output, and resize without a synthetic prompt or command parser
    And Pi remains the sole authority for chat messages, history, tools, commands, extensions, models, trust, compaction, retry, and session behavior
    When the person enters a distinctive workspace A interaction in the native Pi TUI
    Then workspace A output is retained in a bounded reattachment transcript owned by the backend terminal transport
    And the same Agent screen exposes Changes, Activity, Resources, and Sessions as read-only accessory views
    And Resources includes every installed Pi package even when a package registers no slash command
    And Sessions identifies the workspace-bound Pi session without projecting its conversation
    When the person uses the existing Workspace Explorer to switch to workspace B
    Then the Agent screen detaches from workspace A without EOF, signal, or termination
    And it attaches to a distinct backend-owned Pi pseudoterminal rooted at the exact registered root of workspace B
    And no workspace A input or output is delivered to workspace B
    When the person enters a distinctive workspace B interaction and returns through the existing Workspace Explorer to workspace A
    Then the original live workspace A Pi process and bounded transcript are reattached
    And no workspace B input or output is delivered to workspace A
    When the person selects workspace A's distinct file in the Files activity
    Then the existing editor authority opens that file without a second file or workspace model
    When the person detaches the Agent screen
    Then one larger Agent window is pinned to workspace A and attaches to the same Pi process and session
    When the person closes the detached Agent window and later reopens the docked Agent screen
    Then workspace A Pi is still running and its bounded transcript is available for reattachment
    When the person requests Stop Pi for workspace A
    Then a separate confirmation names workspace A and warns that the live process will terminate
    And cancelling the confirmation leaves Pi running
    When the person confirms Stop Pi
    Then only workspace A's Pi process is terminated
    And workspace B's Pi process and session remain unaffected
    When Pi is started again for workspace A
    Then the same deterministic Pi session identifier restores Pi-owned session history
    And the IDE still has not created a parallel workspace, file, editor, chat, tool, extension, model, or history authority
