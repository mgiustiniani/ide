@partial
Feature: Java build, run, tests and debugging with installed tools
  Java execution uses the JDK and Maven or Gradle behind a frontend port.
  RefactorKit supplies project analysis and refactoring, not execution.
  The deterministic desktop harness checks controller, adapter and panel behavior.
  Separate real-JDK tests check compilation, execution and jdb breakpoints.
  Native GUI acceptance for selected build, run, test and debugger workflows is recorded separately
  in ../workspace/native-java-execution.feature. Those scenarios do not qualify every project layout,
  packaged application or operating system; the overall requirement remains partial.

  @REQ-IDE-JAVA-BUILD-RUN-DEBUG-001 @desktop @story-bdd @functional-requirement
  Scenario: Build an explicitly trusted Java workspace
    Given a trusted Java execution workspace
    When Java execution requests build
    Then the Java execution console presents the build result returned by the tools

  @REQ-IDE-JAVA-BUILD-RUN-DEBUG-001 @desktop @story-bdd @functional-requirement
  Scenario: Run a configured Java main class
    Given a trusted Java execution workspace
    When Java execution requests run
    Then the Java execution console presents the run result returned by the tools

  @REQ-IDE-JAVA-BUILD-RUN-DEBUG-001 @desktop @story-bdd @functional-requirement
  Scenario: Delegate project tests to Maven or Gradle
    Given a trusted Java execution workspace
    When Java execution requests test
    Then the Java execution console presents the test result returned by the tools

  @REQ-IDE-JAVA-BUILD-RUN-DEBUG-001 @desktop @story-bdd @functional-requirement
  Scenario: Control and stop the JDK debugger
    Given a trusted Java execution workspace
    When Java execution requests debug
    Then the Java execution console presents the debug result returned by the tools
    And Java execution forwards a breakpoint command and stops its debugger session

  @REQ-IDE-JAVA-BUILD-RUN-DEBUG-001 @desktop @story-bdd @functional-requirement
  Scenario: Report missing tools without inventing execution results
    Given a trusted Java execution workspace whose toolchain is unavailable
    When Java execution requests build
    Then Java execution reports unavailable without a successful result
    And the browser refuses local Java execution
    And Java execution keeps web layers Tauri-free

  @REQ-IDE-JAVA-BUILD-RUN-DEBUG-001 @desktop @story-bdd @functional-requirement
  Scenario: Refuse execution before workspace trust is confirmed
    Given an untrusted Java execution workspace
    When Java execution requests build
    Then Java execution does not start a native process
