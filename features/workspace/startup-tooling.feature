Feature: Startup tooling appropriate to each workspace
  To avoid offering tools that cannot operate in the current environment
  People opening a workspace need its startup tooling to match how it is running.

  @web @REQ-WEB-001 @functional-requirement @implemented-and-validated
  Scenario: A generic standalone web workspace exposes only core web tooling
    Given a person starts a generic standalone web workspace
    When the workspace is ready
    Then only core web tooling is offered
    And that tooling includes an integrated terminal
    But desktop-only Java tooling is not offered
    And desktop-only XCOM tooling is not offered
