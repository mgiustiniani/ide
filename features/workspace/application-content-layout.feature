Business Need: Predictable application content geometry during panel changes
  To keep navigation available without allowing bottom tools to cover it
  People working in the IDE need side and bottom regions to retain their intended boundaries as panels change.

  Business boundary: Native evidence measures application WebView DOM chrome and status geometry at an explicitly asserted viewport.
  It excludes OS decoration, package evidence, Wayland, other OS/DPI combinations, drag resizing, restart persistence, and the optional right sidebar.

  @web @REQ-LAYOUT-WEB-001 @functional-requirement @non-functional-requirement @accessibility @implemented-and-validated
  Scenario: Preserve full-height navigation and editor-side bottom tools in a web workspace
    Given a person has opened a workspace in a supported web browser
    And the application content includes an activity rail, a left sidebar, an editor area, and a bottom shell/tool-window host
    When the person expands, collapses, and resizes the left sidebar and the bottom panel in turn
    Then after every change the activity rail and left sidebar span the full height available to application content
    And the bottom shell/tool-window host begins after the left sidebar and occupies only the editor-side width
    And the top-level chrome and status bar remain separate from application content
    And they retain the positions and extents they had before the panel changes
    And keyboard resizing and the existing accessibility semantics of each resizable panel boundary remain available

  @desktop @native-gui @REQ-LAYOUT-DESKTOP-001 @functional-requirement @non-functional-requirement @accessibility @implemented-not-e2e-validated
  Scenario: Preserve full-height navigation and editor-side bottom tools in a desktop workspace
    Given a person has opened a workspace in the desktop IDE
    And the application content includes an activity rail, a left sidebar, an editor area, and a bottom shell/tool-window host
    When the person keyboard-resizes both the left-sidebar separator and the bottom-panel separator, then collapses and re-expands the left sidebar and the bottom panel in turn
    Then after every change the activity rail and left sidebar span the full height available to application content
    And the bottom shell/tool-window host begins after the left sidebar and occupies only the editor-side width
    And the top-level chrome and status bar remain separate from application content
    And they retain the positions and extents they had before the panel changes
    And keyboard resizing and the existing accessibility semantics of each resizable panel boundary remain available
