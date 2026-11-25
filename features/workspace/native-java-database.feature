@REQ-IDE-JAVA-DATABASE-001 @partial @desktop @native-gui @functional-requirement @e2e @java-database-native
Feature: Inspect and query a Java database
  Java developers can connect to a database using a trusted JDBC driver, inspect its schema, and
  run an explicitly submitted SQL statement. Credentials remain in memory, and result and schema
  views are bounded.

  Scenario: Connect to H2, change data explicitly, and inspect the updated schema
    Given the native Java database tool has an isolated workspace and H2 driver
    When the person connects to the empty H2 database and inspects its schema
    Then the database connection is explicit and the workspace remains unchanged
    When the person creates a table, inserts a row, refreshes the schema, and selects the row
    Then the IDE shows the updated table and returned row
    When the person closes the database IDE window
    Then the database IDE exits cleanly and the workspace remains unchanged

  Scenario: Bind typed values without changing SQL and recover from a binding error
    Given the native Java database tool has an isolated workspace and H2 driver
    When the person connects to the empty H2 database and inspects its schema
    Then the database connection is explicit and the workspace remains unchanged
    When the person creates a table, inserts a row, refreshes the schema, and selects the row
    Then the IDE shows the updated table and returned row
    When the person runs typed bound SQL queries and recovers from an incorrect parameter count
    Then the bound values are returned literally and the database console recovers
    When the person closes the database IDE window
    Then the database IDE exits cleanly and the workspace remains unchanged

  Scenario: Keep a transaction across panel changes and protect pending work on close and workspace switch
    Given the native Java database tool has an isolated workspace and H2 driver
    When the person connects to the empty H2 database and inspects its schema
    Then the database connection is explicit and the workspace remains unchanged
    When the person commits and rolls back on the same connection with protected pending work
    Then committed data survives reconnection and explicitly discarded data is absent
    When the person closes the database IDE window
    Then the database IDE exits cleanly and the workspace remains unchanged

  Scenario: Stop a query that has entered the driver and preserve its SQL for review
    Given the native Java database tool has an isolated workspace and H2 driver
    When the person connects to the empty H2 database and inspects its schema
    Then the database connection is explicit and the workspace remains unchanged
    When the person stops a running JDBC query and reconnects explicitly
    Then the query worker exits with an unknown database outcome and the SQL draft remains reviewable
    When the person closes the database IDE window
    Then the database IDE exits cleanly and the workspace remains unchanged

  Scenario: Insert driver-quoted schema names without executing a SQL draft
    Given the native Java database tool has an isolated workspace and H2 driver
    When the person connects to the empty H2 database and inspects its schema
    Then the database connection is explicit and the workspace remains unchanged
    When the person composes and runs a quoted SQL query using schema suggestions
    Then schema insertion preserves explicit execution and the quoted query returns the expected row
    When the person closes the database IDE window
    Then the database IDE exits cleanly and the workspace remains unchanged

  @native-java-database-plans
  Scenario: Inspect estimated plans without applying a planned write and preserve JDBC transaction control
    Given the native Java database tool has an isolated workspace and H2 driver
    When the person connects to the empty H2 database and inspects its schema
    Then the database connection is explicit and the workspace remains unchanged
    When the person estimates bound SQL plans and refuses execution forms on the same JDBC transaction
    Then estimated plans preserve data and bindings, export the captured plan, and retain transaction control
    When the person closes the database IDE window
    Then the database IDE exits cleanly and the workspace remains unchanged
