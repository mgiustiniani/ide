# Language: en
# Feature: Document language editing with split preview
# Story: As a writer editing markup/documentation files I want the editor and a
#        rendered preview side by side, with a button to hide either pane, so I
#        can focus on writing or reviewing the rendered document.

Feature: Document language editing with split preview

  @REQ-IDE-DOC-SYNTAX-SPLIT-001 @desktop @functional-requirement @implemented-not-e2e-validated
  Scenario: A markup/documentation file opens in a split editor and preview
    Given a document file named "guide.rst"
    When the document pane opens
    Then the document kind is "rst"
    And the pane shows the editor on the left and the preview on the right

  @REQ-IDE-DOC-SYNTAX-SPLIT-001 @desktop @functional-requirement @implemented-not-e2e-validated
  Scenario: The toggle button hides the preview pane
    Given the document pane is in split view for "guide.rst"
    When the writer activates the document view toggle
    Then the pane shows the preview only and hides the editor

  @REQ-IDE-DOC-SYNTAX-SPLIT-001 @desktop @functional-requirement @implemented-not-e2e-validated
  Scenario: The toggle button hides the editing pane
    Given the document pane is in preview-only view for "guide.rst"
    When the writer activates the document view toggle
    Then the pane shows the editor only and hides the preview

  @REQ-IDE-DOC-SYNTAX-SPLIT-001 @desktop @functional-requirement @implemented-not-e2e-validated
  Scenario: The toggle returns to the split view
    Given the document pane is in editor-only view for "guide.rst"
    When the writer activates the document view toggle
    Then the pane returns to split view with the editor and preview side by side
