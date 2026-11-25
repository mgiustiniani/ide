@REQ-IDE-JAVA-EXECUTION-NATIVE-001 @desktop @native-gui @functional-requirement @non-functional-requirement @resilience @partial
Business Need: Execute trusted Java code through the real desktop Java Run activity
  People developing Java need real compiler and runtime outcomes, explicit workspace trust and save-before-execution, and cancellation that terminates the owned process.

  These focused native scenarios use an installed full JDK, real GUI editing and the production native execution commands. The native profile selects the desktop artifact; qualification scope is recorded in [ARC42](../../ARC42.md).
  The jdb cases qualify console controls, source stepping, inspection, completion and Stop. The JDI cases qualify source-margin breakpoints before Debug, saved choices after interface reload and a clean application restart, reviewed rebinding after editing, suspended-line markers, changed-buffer refusal, typed thread/frame selection, local/object/array inspection, persistent watches, one-time read-only evaluation, stepping and Pause. Busy cases suspend only the owned debugger process, fill its actual input through public controls, check the visible queue-full error and stop both debugger and debuggee before closing the window.
  The build-tool cases exercise one-module Maven and Gradle projects in a selected workspace subdirectory with named configurations restored after reloading the clean interface, literal application arguments, application JVM options, environment overrides, an explicit JDK, JUnit 4, direct JUnit Jupiter execution, method filtering, structured results and failed-test reruns. A separate Maven reactor case verifies Failsafe reports from two modules and a GUI-triggered failed-test rerun. Separate JUnit 4, JUnit Jupiter and TestNG discovery cases check compiled runner identities without test-body execution and a selected method using captured settings. Separate coverage cases check JaCoCo branch measurements, saved failing tests, fresh failure reruns and Stop. Effective project synchronization and broader discovery remain separate qualification work.
  Application-only JVM option drafts do not block Build or Run tests, and JUnit does not inherit the application JVM properties. Advanced debugging, larger reactor layouts, installers and other operating systems are separate acceptance work.
  It does not change the conservative declaration of the broader Java build/run/debug requirement.

  @native-java-application-input
  Scenario Outline: Deliver application input separately from the debugger channel in <tool>/<mode>
    Given the native Java application input fixture uses "<tool>/<mode>"
    When the person enables application input and launches the real Java application
    Then Unicode text and an empty line reach System.in exactly once and EOF completes the application
    When the person repeats the captured input launch and stops its waiting JVM
    Then the Java application input IDE closes with its source preserved

    Examples:
      | tool   | mode |
      | jdk    | run  |
      | jdk    | jdi  |
      | jdk    | jdb  |
      | maven  | run  |
      | maven  | jdi  |
      | maven  | jdb  |
      | gradle | run  |
      | gradle | jdi  |
      | gradle | jdb  |

  @native-java-jdk
  Scenario: Save, compile, run, report failures and stop an owned JVM through the native GUI
    Given the native Java execution GUI has an isolated workspace with a deterministic main class
    When the production Java IDE opens Main.java and selects Java Run from the command palette
    Then Java execution actions are disabled before the person confirms workspace trust
    When the person edits the main class through the keyboard without saving
    And the person confirms Java workspace trust and requests Build
    Then the edited source is saved and the real compiler produces a successful class file
    When the person requests Run for the configured main class
    Then the Java console and workspace output file prove execution of the edited main class
    When the person introduces invalid Java syntax and requests Build
    Then the native Java console reports a compiler failure and opens its source line without overwriting an unsaved draft
    When the person repairs the main class and starts a long-running Java task
    Then an owned real JVM is running and Stop is enabled
    When the person presses Stop in the Java Run activity
    Then the Java task is stopped and its observed JVM has exited
    When the person closes the clean Java IDE through the native window protocol
    Then the Java IDE exits without further source changes or escaped user storage

  @native-java-working-directory
  Scenario: Keep the application working directory separate from compilation and retain it across rerun and reload
    Given the native Java IDE has separate project and application directories
    When the person configures the application directory and runs the main class
    Then rerun retains the captured directory and a missing directory refuses execution while Build remains available
    When the person reloads the saved configuration and debugs from its application directory
    Then the Java working-directory IDE closes with its source preserved

  @native-java8-maven-run
  Scenario: Launch an application and discover JUnit tests with a saved Maven Java 8 configuration
    Given the native Java IDE has a real Maven application and a full JDK 8
    When the person saves the Maven Java 8 application settings and reloads the IDE
    Then the restored Maven launch preserves its literal values, runtime dependency and working directory
    And Maven discovery lists both Java 8 tests and executes only the selected method on request

  @native-java-plain-jdk-testng
  Scenario: Run, rerun and select TestNG methods in a plain-JDK project
    Given the native plain-JDK TestNG GUI has an isolated real project
    When the production plain-JDK IDE opens the TestNG fixture and Java Run activity
    Then plain-JDK TestNG actions remain disabled until workspace trust is given
    When the person trusts the workspace and runs the full TestNG suite
    Then the native TestNG results show one pass and one failure with fresh XML
    When the person repairs the TestNG failure and reruns only the failed method
    Then the captured TestNG rerun reports one passing method
    When the person requests plain-JDK TestNG discovery
    Then discovery leaves test bodies untouched
    When the person changes current settings and runs a discovered TestNG method
    Then the captured TestNG method runs and reports its own fresh result
    When the person closes the clean plain-JDK TestNG IDE through the native X11 protocol
    Then the plain-JDK TestNG IDE exits with confined reports and dependencies

  @native-java-plain-jdk-testng @native-java-unicode
  Scenario: Run and debug Unicode classes and rerun and discover Unicode test methods
    Given the native plain-JDK TestNG GUI has Unicode class and method names
    When the production plain-JDK IDE opens the TestNG fixture and Java Run activity
    Then plain-JDK TestNG actions remain disabled until workspace trust is given
    When the person runs and debugs the Unicode main class
    When the person trusts the workspace and runs the full TestNG suite
    Then the native TestNG results show one pass and one failure with fresh XML
    When the person repairs the TestNG failure and reruns only the failed method
    Then the captured TestNG rerun reports one passing method
    When the person requests plain-JDK TestNG discovery
    Then discovery leaves test bodies untouched
    When the person changes current settings and runs a discovered TestNG method
    Then the captured TestNG method runs and reports its own fresh result
    When the person closes the clean plain-JDK TestNG IDE through the native X11 protocol
    Then the plain-JDK TestNG IDE exits with confined reports and dependencies

  @native-java-jfr
  Scenario: Record a trusted Java application with Flight Recorder and inspect the saved recording
    Given the native Java profiling GUI has an isolated workspace and a controllable real JFR tool
    When the production Java IDE opens Main.java and selects Java Run from the command palette
    Then Java execution actions are disabled before the person confirms workspace trust
    When the person confirms Java workspace trust and requests Run with JFR from Commands
    Then the Java console and saved JFR recording prove execution, expose readable metadata, and show a bounded event timeline with selected event fields and sampled stack traces
    When the person reruns Java while summary and timeline reads are each held before the real JFR tool
    Then Java Run remains responsive and new recordings remain analyzable across the held reads
    When the person reruns the captured profiling session and restarts its active JVM with an edited source
    Then the new JFR recording identifies the replacement JVM and the original recording remains unchanged
    When the person closes the clean Java IDE through the native window protocol
    Then the Java IDE exits without further source changes or escaped user storage

  @native-java-coverage
  Scenario Outline: Measure production branches, compare coverage history and check configured coverage thresholds
    Given the native <tool> coverage GUI has an isolated branching Java project
    When the person configures the selected project and literal test JVM options before trusting coverage
    And the person runs one test with coverage and sees one of two measured branches
    And the person edits the test without saving and coverage presents its saved failure and measurements
    And the person repairs the test and reruns failures with coverage despite changed form selections
    And the person repeats the captured coverage session with its original threshold and test selection
    And the person runs both tests and sees both branches covered
    And the person filters the reported tests without changing the completed result or rerun selection
    And the person compares the complete coverage measurement with the earlier single-test run
    And the person stops a running coverage JVM and no complete current measurement remains visible
    And the person reopens the IDE, compares saved coverage and clears its saved history
    And the person closes the clean coverage IDE with unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-jdi-attach
  Scenario: Inspect an external JVM and build/reload classes without terminating it
    Given the native attach GUI has an independently started real JVM listening for JDWP
    When the person configures and restores its saved JDI socket endpoint with trust disabled
    And the person edits the attach source without saving it
    And the person trusts the workspace and attaches without source writes
    And the attached debugger inspects a field and source frame with a verified local line breakpoint
    And the person refreshes prepared class names from the attached JVM
    And the person selects External from the attached JVM class list
    And the person runs the attached JVM to a source cursor in the caller
    And the person filters JDK stepping and exact or subclass exceptions in the attached JVM
    And the person builds and reloads a saved method body while the attached JVM stays connected
    And the JVM refuses a compiled structural change while preserving the running program
    And the person detaches and the external JVM continues with its source unchanged
    And the person attempts a refused connection without fabricating debugger success
    And the person closes the clean attach IDE and the external JVM remains alive

  @native-java-conditional-debugger
  Scenario: Control saved and runtime breakpoint conditions with real JDI values
    Given the native conditional debugger has an isolated looping Java program
    When the person saves a source condition and matching-hit count then reloads and restarts the clean IDE
    And the person starts Debug and the saved breakpoint stops at its third matching occurrence
    And the person continues and the one-shot source condition lets the remaining loop complete
    And the person starts a fresh debugger and a runtime condition stops at its second match
    And an invalid condition leaves the old settings intact and a missing field suspends with a visible error
    And the person repairs the condition and observes two later matches before clearing it and completing
    And the person runs a logpoint that interpolates live values and lets the JVM complete
    And the person enables a disabled saved logpoint from the editor during Debug and its settings survive completion and reload
    And the person closes the clean conditional IDE after both observed JVM processes have exited

  @native-java-exception-breakpoints
  Scenario: Stop a real JVM on caught and uncaught Java exceptions
    Given the native conditional debugger has an isolated looping Java program
    When the person verifies caught and uncaught exception breakpoints with JDI
    And the person closes the clean conditional IDE after both observed JVM processes have exited

  @native-java-debugger
  Scenario Outline: Inspect and control a real JVM from the debugger GUI
    Given the native debugger GUI has an isolated main class and a <finish> finish
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person edits the main class and trusts the workspace before requesting Debug
    Then the edited source is saved and the real debugger starts with application code suspended
    When the person sets a source-line breakpoint and requests Continue
    Then the owned real JVM stops at the breakpoint with the captured launch settings
    When the person requests stack, locals, threads and expression evaluation
    Then the debugger console presents the actual main frame, local value, threads and evaluation
    When the person steps into, over and out of the method and clears the breakpoint
    Then the debugger console proves callee stepping and return without running the next source statement
    When the person finishes the configured debugger session
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

    Examples:
      | finish   |
      | complete |
      | stop     |
      | busy     |

  @native-java-jdi-debugger
  Scenario Outline: Inspect structured JDI runtime state and stop an unresponsive debugger from the native GUI
    Given the native JDI debugger GUI has an isolated main class and a <finish> finish
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person edits the main class and trusts the workspace before requesting Debug
    Then the edited source is saved and the real debugger starts with application code suspended
    When the person confirms the saved source breakpoint is loaded and requests Continue
    Then the owned real JVM stops at the breakpoint with the captured launch settings
    When the person inspects JDI threads, frames, fields, arrays and watches
    Then the structured JDI view presents actual locals, object fields and both array pages without executing methods
    When the person evaluates read-only string, numeric, computed-index, array-type, primitive-cast and conditional expressions once
    Then the structured JDI view returns typed values and leaves the persistent watch set unchanged
    When the person steps into and over to a local, changes it explicitly, then steps out and clears the breakpoint
    Then the structured JDI view proves the local change, frame selection, callee stepping and return before the next source statement
    When the person completes or pauses and stops the configured JDI session
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

    Examples:
      | finish   |
      | complete |
      | busy     |

  @native-java-execution-commands
  Scenario: Execute configured Java commands from the palette and debugger function keys
    Given the native JDI debugger GUI has an isolated main class and a complete finish
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person saves the Java draft through configured Build and Run commands and runs it again with Ctrl F5
    Then the configured Java commands save the source and execute the actual application
    When the person starts, steps, restarts, stops and reruns the configured Java debugger with function keys
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

  @native-java-restart-session
  Scenario: Restart the owned Java debugger and rerun its captured launch settings
    Given the native JDI debugger GUI has an isolated main class and a complete finish
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person edits the main class and trusts the workspace before requesting Debug
    Then the edited source is saved and the real debugger starts with application code suspended
    When the person confirms the saved source breakpoint is loaded and requests Continue
    Then the owned real JVM stops at the breakpoint with the captured launch settings
    When the person restarts the live debugger then reruns its captured settings after changing the form
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

  @native-java-drop-frame
  Scenario: Drop a suspended Java method frame and reenter it with the changed argument
    Given the native JDI debugger GUI has an isolated main class and a complete finish
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person edits the main class and trusts the workspace before requesting Debug
    Then the edited source is saved and the real debugger starts with application code suspended
    When the person confirms the saved source breakpoint is loaded and requests Continue
    Then the owned real JVM stops at the breakpoint with the captured launch settings
    When the person drops the selected method frame and reenters it with its changed argument
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

  @native-java-class-change-review
  Scenario: Review changed compiled files and explicitly reload them into the suspended JVM
    Given the native JDI debugger GUI has an isolated main class and a complete finish
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person edits the main class and trusts the workspace before requesting Debug
    Then the edited source is saved and the real debugger starts with application code suspended
    When the person confirms the saved source breakpoint is loaded and requests Continue
    Then the owned real JVM stops at the breakpoint with the captured launch settings
    When the person builds and reviews a changed compiled class before confirming reload
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

  @native-java-run-to-cursor @partial
  Scenario: Run to a selected Java source line with a temporary JDI breakpoint
    Given the native JDI debugger GUI has an isolated main class for Run to Cursor
    When the production debugger IDE opens the source and literal launch settings
    Then Debug is disabled before trust and no execution artifacts exist
    When the person edits the main class and trusts the workspace before requesting Debug
    Then the edited source is saved and the real debugger starts with application code suspended
    When the person revokes and restores trust, mutes line breakpoints and runs the suspended JDI session to a cursor line in Monaco
    Then Run to Cursor stops at the selected source line and removes its temporary breakpoint
    When the person completes or pauses and stops the configured JDI session
    Then the debugger and debuggee exit with the expected completion or Stop result
    When the person closes the clean debugger IDE through the native window protocol
    Then the debugger IDE exits with only the explicit source save and confined storage

  @native-java-build-tools
  Scenario Outline: Save, build, run and observe passing and failing JUnit tests through a real build tool
    Given the native <tool> Java GUI has an isolated real project with a pinned JUnit dependency
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person saves separate application and test configurations and reloads the clean interface
    Then the named build-tool settings and selection are restored without workspace trust
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the build-tool workspace and requests Build
    Then the detected real build tool saves the main buffer, cleans compiled outputs and rebuilds without running tests
    When the person requests Rebuild in the build-tool Java activity
    Then Rebuild removes the old output and recompiles without running the application or tests
    When the person requests the build-tool main class Run
    Then the build-tool console and append-only application proof show one execution of the saved main class
    When the person selects the savedSource test method in the chosen project directory
    When the person requests Run tests in the build-tool Java activity
    Then a real passing JUnit report and test-written proof identify the executed case
    When the person changes the JUnit expectation through the keyboard and requests Run tests
    Then the saved test edit produces a nonzero test failure and a new failing JUnit report
    When the person repairs the JUnit expectation and requests Rerun failed tests
    Then the repaired test is saved and a new passing JUnit report proves another execution
    When the person breaks the main class syntax and requests build-tool Run
    Then the compiler error opens the selected project source without saving its draft or changing application and test outcomes
    When the person repairs the main class and requests build-tool Build
    Then the repaired main compiles successfully without an implicit application or test execution
    When the person requests a test method that does not exist
    Then the build tool reports a nonzero test failure without executing another case
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

  Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-build-tools
  Scenario: Run Maven Failsafe tests from a custom source root with full-lifecycle coverage
    Given the native Maven integration-test GUI has an isolated Failsafe project with a custom source root
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the Maven workspace and requests Run integration tests with coverage
    Then fresh Failsafe results stay separate from Surefire while JaCoCo reports full verify coverage
    When the person requests Rerun session for the completed test selection
    Then a new integration coverage report preserves the captured Failsafe scope
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

  @native-java-failsafe-reactor
  Scenario Outline: Collect <reports> Maven reactor Failsafe reports and rerun a failed method through the native GUI
    Given the native Maven integration-test GUI has an isolated two-module Failsafe reactor with <reports> reports
    When the production Maven reactor IDE opens its application and AppIT sources
    Then the Maven reactor integration actions are untrusted and no module execution artifacts exist
    When the developer trusts the Maven reactor workspace and requests Run integration tests
    Then fresh results display both module Failsafe reports and omit the Surefire reports
    And Open test source reveals the failing AppIT line in the module that produced its report
    When the developer repairs AppIT in the editor and requests Rerun failed tests
    Then the reactor rerun executes only the repaired failed test and leaves the core module unchanged
    When the developer requests Rerun session for that integration test
    Then the integration test runs again without rerunning the core module
    When the developer closes the clean Maven reactor IDE through the native window protocol
    Then the reactor IDE exits with only the explicit AppIT save and unchanged Maven descriptors

    Examples:
      | reports  |
      | standard |
      | custom   |

  @native-java-testng-discovery
  Scenario Outline: Discover compiled TestNG identities and execute one method with captured settings
    Given the native <tool> discovery GUI has an isolated real project with two TestNG methods
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and requests Discover tests
    Then the discovery lists the compiled class and both method-name groups without executing their bodies
    When the person changes the test form and runs the discovered savedSource method-name group
    Then only the discovered method-name group executes using the original session settings
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-test-jvm-options
  Scenario Outline: Preserve explicit test JVM settings through native configuration reload and failed-test rerun
    Given the native <tool> test JVM GUI has an isolated real project with a pinned JUnit dependency
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person enters literal test JVM options independently of an application draft
    And the person saves separate application and test configurations and reloads the clean interface
    Then the named build-tool settings and selection are restored without workspace trust
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and runs the saved test JVM configuration
    Then the real JUnit process uses the selected test JVM options and JDK
    When the person changes the JUnit expectation through the keyboard and requests Run tests
    Then the saved test edit produces a nonzero test failure and a new failing JUnit report
    When the person repairs the JUnit expectation and requests Rerun failed tests
    Then the repaired test rerun retains its original JVM options despite current form edits
    When the person requests Rerun session for the completed test selection
    Then the test selection runs again with the captured JVM options
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-test-jvm-options
  Scenario: Report ignored Surefire JVM options without fabricating a tool failure or configured test success
    Given the native Maven test JVM GUI has a project with a fixed Surefire argLine
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person enters literal test JVM options independently of an application draft
    And the person edits the build-tool main class through the keyboard without saving
    And the person trusts the fixed-argLine workspace and requests Run tests
    Then the passing JUnit report accompanies a visible test configuration failure with tool exit zero
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

  @native-java-test-discovery
  Scenario Outline: Discover compiled JUnit identities and execute one method with captured settings
    Given the native <tool> discovery GUI has an isolated real project with two JUnit methods
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and requests Discover tests
    Then the discovery lists the compiled class and both method-name groups without executing their bodies
    When the person changes the test form and runs the discovered savedSource method-name group
    Then only the discovered method-name group executes using the original session settings
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-test-discovery @native-java-maven-aggregator-discovery
  Scenario: Run and rerun a discovered Maven aggregator test without building its child
    Given the native Maven discovery GUI has an aggregator with custom test output and an identically named child test
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and requests Discover tests
    Then discovery compiles and lists the aggregator tests without building the child or running test bodies
    When the person changes the test form and runs the discovered savedSource method-name group
    Then only the discovered method-name group executes using the original session settings
    When the person requests Rerun session for the completed test selection
    Then the aggregator test runs a second time with the child still unbuilt
    When the person closes the clean build-tool IDE through the native window manager
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

  @native-java-test-discovery
  Scenario Outline: Discover JUnit Jupiter overloads and execute the selected method-name group with captured settings
    Given the native <tool> discovery GUI has an isolated real project with JUnit Jupiter method-name groups including overloads
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and requests Discover tests
    Then the discovery lists the compiled class and both method-name groups without executing their bodies
    When the person changes the test form and runs the discovered savedSource method-name group
    Then only the discovered method-name group executes using the original session settings
    When the person rediscovers and requests coverage for the savedSource overloads
    Then coverage reports both savedSource overloads and both production branches without running the companion
    When the person rediscovers and debugs the savedSource overloads until entry suspension
    Then continuing the debugger executes both overloads and leaves the companion unexecuted
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-junit5-test-execution
  Scenario Outline: Run a JUnit Jupiter test directly with the selected test JVM and JDK
    Given the native <tool> JUnit Jupiter test GUI has an isolated real project
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person enters literal test JVM options independently of an application draft
    And the person saves separate application and test configurations and reloads the clean interface
    Then the named build-tool settings and selection are restored without workspace trust
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and runs the saved test JVM configuration
    Then the real JUnit process uses the selected test JVM options and JDK
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-testng-test-execution
  Scenario Outline: Run a TestNG test directly with the selected test JVM and JDK
    Given the native <tool> TestNG test GUI has an isolated real project
    When the production build-tool IDE opens both Java sources with automatic tool detection
    Then the build-tool actions are untrusted and no execution artifacts exist
    When the person enters literal test JVM options independently of an application draft
    And the person saves separate application and test configurations and reloads the clean interface
    Then the named build-tool settings and selection are restored without workspace trust
    When the person edits the build-tool main class through the keyboard without saving
    And the person trusts the workspace and runs the saved test JVM configuration
    Then the real TestNG process uses the selected test JVM options and JDK
    When the person closes the clean build-tool IDE through the native X11 protocol
    Then the build-tool IDE exits with only explicit source saves and unchanged project descriptors

    Examples:
      | tool   |
      | maven  |
      | gradle |
