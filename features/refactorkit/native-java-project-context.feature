@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 @desktop @native-gui @functional-requirement @partial
Business Need: Develop Java modules using the selected SDK and effective project context
  A Java developer needs module, source-set, generated-root and dependency evidence from RefactorKit with an explicit JDK.
  Context qualification uses real reference project inputs and a daemon providing the versioned project.context contract.
  Synchronization preserves editor drafts; execution saves them explicitly before compiling the selected module.
  Gradle metadata evaluation requires explicit authorization; installers require separate acceptance.
  The native SDK-switch check requires two distinct installed JDK homes; a single-JDK environment records that check as unavailable.


  @native-java-project-scaffold
  Scenario: Create Java Maven and Gradle starters, including a tested Spring Boot MVC endpoint
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Java Project panel and Maven project wizard
    And the person creates Maven Java 8 and 27, Gradle Groovy DSL, Gradle Kotlin DSL, and Spring Boot MVC Maven and Gradle starters and attempts to reuse the Maven and Groovy project folders
    And the person creates Java 27 Gradle Groovy and Kotlin DSL starters
    Then the native workspace contains the starter sources, pinned build wrappers and visible project folder
    And all generated projects have no build output and require an explicitly selected JDK for synchronization
    And the refused duplicates leave the Maven and Groovy projects unchanged
    When the harness builds, tests, and launches the generated Java 8 Maven and Java 21 Gradle starters offline
    And the harness builds, tests, and launches the generated Java 27 Maven starter offline with JDK 27
    And the harness builds, tests, and launches the generated Java 27 Gradle Groovy and Kotlin DSL starters offline with JDK 27
    Then the Maven, Gradle and Spring Boot starter builds pass their generated tests, print greetings and verify the HTTP endpoint
    And the Java 27 Maven starter passes its JUnit test and emits Java 27 class files
    And the Java 27 Gradle starters pass their JUnit tests and emit Java 27 class files
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

  @native-java-project-scaffold @native-java26-scaffold
  Scenario: Create Java 26 Maven and Gradle starters without compiling them
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Java Project panel and Maven project wizard
    And the person creates Java 26 Maven and Gradle starters without building them
    Then the native workspace contains Java 26 Maven and Gradle starters with no build output
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

  @native-java-project-scaffold @native-java-spring-boot-starter
  Scenario: Create a Maven Spring Boot starter and run it from Java Run
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Maven project wizard with a capable RefactorKit daemon
    And the person creates a Maven Spring Boot MVC starter without compiling it
    Then the person tests, runs and stops the generated Spring Boot application from Java Run
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

  @native-java-project-scaffold @native-java-spring-boot-gradle-starter
  Scenario Outline: Create a Gradle Spring Boot starter and run it from Java Run with <DSL> DSL
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Gradle project wizard with a capable RefactorKit daemon
    And the person creates a Gradle Spring Boot MVC starter using "<DSL>" without compiling it
    Then the person tests, runs and stops the generated "<DSL>" Spring Boot application from Java Run
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

    Examples:
      | DSL    |
      | groovy |
      | kotlin |

  @native-java26-scaffold-build
  Scenario: Explicitly build and run Java 26 Maven and Gradle starters with JDK 26
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Java Project panel and Maven project wizard
    And the person creates Java 26 Maven and Gradle starters without building them
    Then the native workspace contains Java 26 Maven and Gradle starters with no build output
    When the harness explicitly builds, tests, and runs the generated Java 26 Maven and Gradle starters offline with JDK 26
    Then both Java 26 starters pass their tests, run, and emit Java 26 class files
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

  @native-java26-scaffold-wrapper-build
  Scenario: Bootstrap the pinned wrappers for Java 26 Maven and Gradle starters
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Java Project panel and Maven project wizard
    And the person creates Java 26 Maven and Gradle starters without building them
    Then the native workspace contains Java 26 Maven and Gradle starters with no build output
    When the harness bootstraps both pinned wrappers into empty caches and builds, tests, and runs the starters with JDK 26
    Then both Java 26 starters pass their tests, run, and emit Java 26 class files
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

  @native-java27-scaffold-wrapper-build
  Scenario: Build Java 27 Maven and Gradle Groovy and Kotlin starters from their pinned wrappers
    Given the Maven scaffold GUI has an empty isolated workspace
    When the person opens the Java Project panel and Maven project wizard
    And the person creates Java 27 Maven and both Gradle DSL starters without building them
    When the harness bootstraps the pinned distributions and builds, tests, and runs all three starters through their wrappers with JDK 27
    Then the Java 27 Maven starter passes its JUnit test and emits Java 27 class files
    And the Java 27 Gradle starters pass their JUnit tests and emit Java 27 class files
    When the person closes the Maven scaffold IDE
    Then the native window exits cleanly and the scenario environment is restored

  @native-java-unsupported-release-context
  Scenario: Refuse Maven context synchronization when RefactorKit does not support Java 26
    Given the project context GUI has a real Maven Java 26 reference project and a capable daemon
    When the person opens the Java Project panel for the Java 26 Maven project
    And the person synchronizes the Java 26 Maven project context
    Then the IDE shows the provider refusal, claims no available context, preserves Maven inputs and creates no build output
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-unsupported-release-context
  Scenario: Refuse Maven context synchronization when RefactorKit does not support Java 27
    Given the project context GUI has a real Maven Java 27 reference project and a capable daemon
    When the person opens the Java Project panel for the Java 27 Maven project
    And the person synchronizes the Java 27 Maven project context
    Then the IDE shows the provider refusal for Java 27, claims no available context, preserves Maven inputs and creates no build output
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java26-supported-context @native-java26-maven-context
  Scenario: Synchronize Maven Java 26 context with the selected full JDK
    Given the Java 26 project-context GUI has a real Maven project and the upgraded daemon
    When the person opens the Java Project panel for the Maven project
    And the person synchronizes the supported Java 26 Maven project context
    Then the effective Maven context reports Java 26 source level and the selected JDK
    And the Java 26 context request uses matching snapshot and SDK evidence and preserves Maven inputs
    When the person verifies Java 26 rename refusal without processor output and explicitly builds the synchronized application
    And the person applies and undoes the Java 26 cursor rename then applies and rolls back the saved-source class rename
    Then the Java 26 rename uses qualified SDK analysis and its applied source copy compiles and passes tests
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java26-supported-context @native-java26-gradle-context
  Scenario: Synchronize Gradle Java 26 context with the selected full JDK
    Given the Java 26 project-context GUI has a real Gradle project and the upgraded daemon
    When the person opens the Java Project panel for the Gradle project
    And the person explicitly evaluates the Java 26 Gradle project context offline
    Then the effective Gradle context reports Java 26 source level and the selected JDK
    And the Java 26 Gradle synchronization attestation matches the project context snapshot and preserves inputs
    When the person verifies Java 26 rename refusal without processor output and explicitly builds the synchronized application
    And the person applies and undoes the Java 26 cursor rename then applies and rolls back the saved-source class rename
    Then the Java 26 rename uses qualified SDK analysis and its applied source copy compiles and passes tests
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java27-supported-context @native-java27-maven-context
  Scenario: Build, run, test and debug Maven Java 27 with the selected full JDK
    Given the Java 27 project-context GUI has a real Maven execution project and the isolated candidate daemon
    When the person opens the Java Project panel for the Maven project
    And the person synchronizes the supported Java 27 Maven project context
    Then the effective Maven context reports Java 27 source level and the selected JDK
    And the Java 27 context request uses matching snapshot and SDK evidence and preserves Maven inputs
    When the person builds, runs, tests and debugs the synchronized Java 27 Maven application
    And the person records the synchronized Java 27 application with Flight Recorder
    And the person opens a discovered Java 27 test class and runs one selected test
    And the person opens the selected Java 27 test source from its result
    And the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java27-preview-source-ownership
  Scenario: Resolve Java 27 Maven source ownership with a JDT preview candidate
    Given the Java 27 project-context GUI has a real Maven project and the isolated candidate daemon
    When the person opens the Java Project panel for the Maven project
    And the person synchronizes the supported Java 27 Maven project context
    Then the preview candidate resolves Java 27 Maven source ownership with a JDT binding
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java27-v7-owner-only-source-ownership
  Scenario: Resolve Java 27 Maven file ownership without claiming symbol analysis
    Given the Java 27 project-context GUI has a real Maven project and the isolated candidate daemon
    When the person opens the Java Project panel for the Maven project
    And the person synchronizes the supported Java 27 Maven project context
    Then the v7 candidate resolves Java 27 Maven source-root ownership without semantic analysis
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java27-v7-jdtls-definition
  Scenario: Use JDT LS for Java 27 cross-module definition navigation after v7 source ownership
    Given the Java 27 project-context GUI has a real Maven project and the standard user installation
    When the person opens the Java Project panel for the Maven project
    Then the IDE discovers RefactorKit from the standard user installation without provider overrides
    When the person synchronizes the supported Java 27 Maven project context
    Then the v7 candidate resolves Java 27 Maven source-root ownership without semantic analysis
    When the person starts Eclipse JDT LS on the qualified JDK 25 runtime for Java 27 and navigates the inherited Maven call
    And the person resynchronizes Maven after language-server import and repeats F12
    Then the IDE opens the exact cross-module declaration through the JDT LS F12 fallback without changing project sources
    When the person closes the Java 27 declaration tab before inspecting references
    And the person requests Shift F12 on the Java 27 inherited call
    Then the IDE opens the exact call site from guarded JDT LS references after RefactorKit refuses semantic analysis
    When the person Control-clicks the Java 27 inherited Maven call
    Then the IDE opens the exact cross-module declaration through the JDT LS Control-click fallback
    And the editor and Java Intelligence open the Java 27 receiver type and the panel retires results when the cursor moves
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java27-supported-context @native-java27-gradle-context
  Scenario: Synchronize Gradle Java 27 context with the selected full JDK
    Given the Java 27 project-context GUI has a real Gradle project and the isolated candidate daemon
    When the person opens the Java Project panel for the Gradle project
    And the person explicitly evaluates the Java 27 Gradle project context offline
    Then the effective Gradle context reports Java 27 source level and the selected JDK
    And the Java 27 Gradle synchronization attestation matches the project context snapshot and preserves inputs
    And the v7 candidate resolves Java 27 Gradle source-root ownership without semantic analysis
    When the person builds the synchronized Java 27 Gradle application module
    Then the Java 27 Gradle build succeeds with the selected compiler JDK
    When the person reevaluates the Java 27 Gradle context after Build
    Then the effective Gradle context reports Java 27 source level and the selected JDK
    And the Java 27 Gradle synchronization attestation matches the project context snapshot and preserves inputs
    And the Java Project panel displays the materialized Gradle annotation processor path and generated source root
    When the person runs the synchronized application module from Java Run
    Then the Java 27 Gradle application builds and runs from the metadata-only context with the selected JDK
    When the person reevaluates the Java 27 Gradle context after Run
    Then the effective Gradle context reports Java 27 source level and the selected JDK
    And the Java 27 Gradle synchronization attestation matches the project context snapshot and preserves inputs
    When the person runs tests for the synchronized application module
    Then the Java 27 Gradle tests pass with the selected JDK and captured test settings
    When the person measures coverage for the synchronized Java 27 Gradle application
    And the person debugs the synchronized Java 27 Gradle application
    And the person records the synchronized Java 27 application with Flight Recorder
    When the person enables JDT LS Gradle import for this session when needed
    And the person opens a discovered Java 27 test class and runs one selected test
    When the person starts Eclipse JDT LS on the qualified JDK 25 runtime for Java 27 and navigates the inherited Gradle call
    And the person reevaluates Gradle after language-server import and repeats F12
    Then the IDE opens the exact cross-module declaration through the JDT LS F12 fallback without changing project sources
    When the person requests Shift F12 on the Java 27 inherited call
    Then the IDE opens the exact call site from guarded JDT LS references after RefactorKit refuses semantic analysis
    And the person opens the selected Java 27 test source from its result
    And F12 opens the generated Java method declaration from its call site
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-text-search
  Scenario: Search Java source and project text in the selected project and open a result
    Given the Java text search GUI has an isolated project workspace
    When the person searches the selected Java project for saved source and resource text
    Then Find in Java results show exact columns for all matches, including repeated matches on one line, open in the editor and omit unsupported files
    When the person searches while the Java resource editor has an unsaved text change
    Then the resource draft replaces its saved results without changing the file on disk
    When the person searches while the Java editor has an unsaved draft
    Then the draft replaces its saved version in the results and preserves project files
    When the person closes the Java text search IDE
    Then the text search window exits cleanly and the scenario environment is restored

  @native-java-gradle-diagnostics @resilience
  Scenario Outline: Recover from a real Gradle <cause> failure through an explicit cache correction
    Given the native Gradle diagnostic GUI has a real project and a <cause> cache failure
    When the person explicitly evaluates Gradle and receives a bounded cause without an effective context
    And the person selects a complete writable cache and explicitly evaluates Gradle again
    Then the Gradle diagnostic window closes with inputs unchanged and no implicit compilation

    Examples:
      | cause      |
      | permission |
      | offline    |
      | plugin     |

  @native-java-gradle-diagnostics @resilience
  Scenario: Prepare Gradle dependencies from Java Run with an initially empty cache
    Given the native Gradle diagnostic GUI has a real project and a prepare cache failure
    When the person explicitly evaluates Gradle and receives a bounded cause without an effective context
    And the person prepares the same Gradle cache from Java Run and evaluates offline with the repository stopped
    Then the Gradle diagnostic window closes with inputs unchanged and no implicit compilation

  @native-java-gradle-diagnostics @resilience
  Scenario: Prepare Gradle TestNG dependencies from Java Run with an initially empty cache
    Given the native Gradle diagnostic GUI has a real project and a testng cache failure
    When the person explicitly evaluates Gradle and receives a bounded cause without an effective context
    And the person sees preparation fail during a repository outage then retries and evaluates offline
    Then the Gradle diagnostic window closes with inputs unchanged and no implicit compilation

  @native-java-gradle-diagnostics @resilience
  Scenario: Prepare Gradle dependencies for a Java project in a nested included build
    Given the native Gradle diagnostic GUI has a real project and a composite cache failure
    When the person explicitly evaluates Gradle and receives a bounded cause without an effective context
    And the person prepares the same Gradle cache from Java Run and evaluates offline with the repository stopped
    Then the Gradle diagnostic window closes with inputs unchanged and no implicit compilation

  @native-java-maven-preparation
  Scenario: Verify a Maven reactor before synchronization with an initially empty repository
    Given the native Java IDE has a two-module Maven reactor and an empty local repository
    When the person verifies Maven from Java Run and synchronizes with the mirror removed
    Then the Maven verification window closes with source and build inputs unchanged

  @native-java-maven-preparation
  Scenario: Diagnose incomplete Maven compiler options with an explicitly selected JDK
    Given the native Java IDE has a Maven reactor with source and target and an implicit compiler plugin
    When the person sees compiler configuration guidance and resynchronizes with an explicit Java release
    Then the Maven verification window closes with source and build inputs unchanged

  @native-java-maven-preparation
  Scenario: Synchronize an implicit compiler from a local Maven distribution
    Given the native Java IDE has a Maven reactor with an implicit compiler and a local Maven distribution
    When Java Run builds with the compiler plugin shown during Maven synchronization
    Then the Maven verification window closes with source and build inputs unchanged

  @native-java-project-working-directory
  Scenario Outline: Use application input and separate build directories in synchronized <tool> execution
    Given the project working-directory GUI has a real <tool> reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the working-directory source before project synchronization
    And the person synchronizes the selected execution project with its full JDK
    And the person sends application input and EOF through Run, JFR and captured working-directory Rerun
    And the person runs synchronized tests without inheriting application input or its directory
    And the person sends input during synchronized Debug and stops another waiting application
    And the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   |
      | Maven  |
      | Gradle |

  @native-java-project-execution
  Scenario: Save and execute the selected Maven module with synchronized dependencies and JDK
    Given the project execution GUI has a real Maven reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Maven project with its selected full JDK
    When the person introduces a syntax error and requests Build for the synchronized module
    Then the compiler location navigates from the library to the application while preserving its unsaved repair
    When the person saves the repair, synchronizes again and leaves a new unsaved source edit
    And the person runs the synchronized application module from Java Run
    Then the native application uses the selected JDK and runtime dependencies after saving the draft
    When the person cleans and rebuilds the synchronized application module without running it
    Then the selected module regenerates compiled and processor outputs without changing project inputs
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-wrapper
  Scenario: Execute the Maven module through its workspace wrapper
    Given the project execution GUI has a real Maven reference project with a workspace wrapper and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Maven project with its selected full JDK
    And the person runs the synchronized application module from Java Run
    Then the workspace wrapper dispatches to the real build tool and selected-JDK application result is visible
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-wrapper
  Scenario: Execute the Gradle module through its workspace wrapper
    Given the project execution GUI has a real Gradle reference project with a workspace wrapper and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person runs the synchronized application module from Java Run
    Then the workspace wrapper dispatches to the real build tool and selected-JDK application result is visible
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-custom-output
  Scenario: Run a Maven module from its configured custom output directories
    Given the project execution GUI has a real Maven reference project with custom output directories and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Maven project with its selected full JDK
    And the person runs the synchronized application module from Java Run
    Then the native application uses the selected JDK runtime dependencies and configured build output directories after saving the draft
    When the person refreshes the selected project context after the custom main output is generated
    When the person runs tests for the synchronized application module
    Then the selected module tests pass with the selected JDK and configured test output directory
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-custom-output
  Scenario: Run a Gradle module from its configured custom output directories
    Given the project execution GUI has a real Gradle reference project with custom output directories and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person runs the synchronized application module from Java Run
    Then the native application uses the selected JDK runtime dependencies and configured build output directories after saving the draft
    When the person refreshes the selected project context after the custom main output is generated
    And the person runs tests for the synchronized application module
    Then the selected module tests pass with the selected JDK and configured test output directory
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-project-execution
  Scenario: Save and execute the selected Gradle module with synchronized dependencies and JDK
    Given the project execution GUI has a real Gradle reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    When the person introduces a syntax error and requests Build for the synchronized module
    Then the compiler location navigates from the library to the application while preserving its unsaved repair
    When the person saves the repair, synchronizes again and leaves a new unsaved source edit
    And the person runs the synchronized application module from Java Run
    Then the native application uses the selected JDK and runtime dependencies after saving the draft
    When the person cleans and rebuilds the synchronized application module without running it
    Then the selected module regenerates compiled and processor outputs without changing project inputs
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-mixed-jvm
  Scenario: Run and debug a Java application that calls Kotlin in the same Gradle module
    Given the Java Run GUI has a mixed Java and Kotlin Gradle module and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before project synchronization
    And the person synchronizes the selected execution project with its full JDK
    And the person runs the synchronized application module from Java Run
    Then the Java application calls Kotlin and receives the result of its call back into Java
    And F12 explains the unavailable Kotlin destination and opens the Java control declaration
    And the IDE refuses member rename when Kotlin consumers cannot be verified
    And JDI stops in the Java callback invoked by Kotlin and resumes execution
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-kotlin-definition
  Scenario: Open saved Kotlin declarations from Java after a Gradle build
    Given the Java Run GUI has a mixed Java and Kotlin Gradle module and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before project synchronization
    And the person synchronizes the selected execution project with its full JDK
    And the person runs the synchronized application module from Java Run
    Then the Java application calls Kotlin and receives the result of its call back into Java
    And F12 opens the saved Kotlin type and method declarations from Java
    And F12 rejects changed Kotlin source until a rebuild produces matching class files
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-mixed-jvm
  Scenario: Run and debug a Java application that calls Kotlin in the same Maven module
    Given the Java Run GUI has a mixed Java and Kotlin Maven module and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before project synchronization
    And the person synchronizes the selected execution project with its full JDK
    And the person runs the synchronized application module from Java Run
    Then the Java application calls Kotlin and receives the result of its call back into Java
    And a Maven output directory change blocks member rename until the project is synchronized again
    And JDI stops in the Java callback invoked by Kotlin and resumes execution
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-composite
  Scenario: Select, run and debug an included Gradle project with its provider-qualified build identity
    Given the project execution GUI has a real Gradle composite with an app directory outside the included build root and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person synchronizes the selected execution project with its full JDK
    Then the selected project context resolves the included app's provider-qualified build identity
    When the person runs the synchronized application module from Java Run
    Then the included Gradle application runs from its selected build and library project
    And the person synchronizes and explicitly evaluates the Gradle composite again after Run
    And the person discovers tests from the synchronized application module
    Then all selected module methods are discovered without running their bodies
    When the person changes visible test settings and runs one discovered module method
    Then only the selected method runs with the discovery session JDK JVM options and environment
    And the person synchronizes and explicitly evaluates the Gradle composite again after its selected test
    And the person opens the Gradle library source before composite coverage
    And the person runs coverage for the synchronized included application module
    Then composite coverage includes covered application and included-library code and opens the dependency source
    And the person synchronizes and explicitly evaluates the Gradle composite again after coverage
    When the person sets a source breakpoint in the synchronized app module and requests Debug
    Then the project debugger starts suspended before application code with the saved edit
    When the person continues the synchronized Gradle debugger to the source breakpoint
    Then JDI stops on the selected module source before its output statement
    When the person continues the Gradle debuggee to completion
    Then the application reports its effective dependencies and selected JDK and its JVM exits
    When the person cleans and rebuilds the included Gradle app through the command palette
    Then composite Clean targets the external app directory and preserves library outputs and project inputs
    When the person requests Rebuild for the included Gradle app through the command palette
    Then composite Rebuild removes the old output, recompiles the app and preserves the library
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-composite
  Scenario: Run Gradle apps with the same project path and resolve a substituted dependency in the nested app
    Given the project execution GUI has a real Gradle composite with an app directory outside the included build root and another :app project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person synchronizes the selected execution project with its full JDK
    And the person selects and runs the app in the second included build
    Then only the second app reports its marker and creates its compiled entry point
    When the person synchronizes and explicitly evaluates the Gradle composite again after Run
    And the person runs the synchronized application module from Java Run
    Then the included Gradle application runs from its selected build and library project
    When the person builds the nested app's test source set without running it
    When the person discovers the tests of the second app with both Runner sources open
    Then running the discovered method with coverage after selecting Plain JDK measures and opens only the second Runner
    And Rerun session produces fresh coverage for the same method in the second included build
    And debugging the rediscovered method after selecting the first app stops in the second Runner and completes only that test
    When the person sets breakpoints in both Greeter sources and debugs the first included app
    Then JDI stops in the library loaded from its project JAR and excludes the other Greeter breakpoint
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-failsafe-context @native-java-maven-test-jvm-selection
  Scenario: Run Java 8 and JDK 21 Failsafe forks and debug the Java 8 test
    Given the native GUI has a Maven Failsafe reactor whose app selects a Java 8 test JVM
    When the person opens and synchronizes the Maven reactor before opening Java source
    And the person runs integration tests from the synchronized app Maven source set
    Then the Java 8 app test receives the project and IDE options and produces a fresh Failsafe report
    When the person retries the app test after separately removing and restoring a plugin JAR and its parent POM in the isolated offline Maven cache
    When the person resynchronizes Maven after the app test
    And the person runs integration tests from the synchronized library Maven source set
    Then the JDK 21 library test passes from its declared Failsafe report directory
    When the person retries the library test after Maven loses and regains its required toolchain
    And the person measures Failsafe coverage with the Java 8 and JDK 21 test forks
    When the person debugs the Java 8 app integration test and stops its captured rerun
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-custom-source-set
  Scenario: Build, run and test a Gradle custom source set when a duplicate task has the wrong runtime
    Given the project execution GUI has a real Gradle custom test source set and a duplicate Test task with an incomplete runtime classpath, using a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person builds the synchronized Gradle integrationTest source set from Java Run
    Then the synchronized Gradle integrationTest source set build runs its mapped classes task
    And the person refreshes the selected Gradle project context after the custom source set is compiled
    When the person runs the application from the synchronized Gradle integrationTest source set
    Then the custom source-set application uses its compiled classes runtime dependencies and selected JDK
    And the person refreshes the selected Gradle project context after the custom source set is compiled
    And the person discovers tests from the synchronized Gradle integrationTest source set
    Then discovery reports the integrationTest method without running its body
    And the person refreshes the selected Gradle project context after the custom source set is compiled
    And the person runs tests for the synchronized Gradle integrationTest source set from Java Run
    Then the synchronized Gradle integrationTest source set runs its mapped task and reports one passing test
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-failsafe-context
  Scenario: Select and run independent Failsafe source sets in a synchronized Maven reactor
    Given the native GUI has a Maven reactor with app and library Failsafe integration-test source roots
    When the person opens and synchronizes the Maven reactor before opening Java source
    Then the Java Project panel warns when the app annotation processor context is incomplete
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the selected execution project with its full JDK
    Then the synchronized Maven context exposes separate app and library integration-test source sets
    When the person runs integration tests from the synchronized app Maven source set
    Then Maven Failsafe reports the app test from its declared report directory
    When the person refreshes Maven context after app Failsafe generates build output
    Then the refreshed Maven context keeps separate app and library integration-test source sets
    And the refreshed app context exposes its materialized processor path and generated source root
    When the person runs integration tests from the synchronized library Maven source set
    Then Maven Failsafe reports the library test from its declared report directory
    When the person measures Failsafe coverage with the selected project JDK
    When the person debugs the selected app integration test and stops its captured rerun
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-failsafe-context @native-java-maven-failsafe-profile
  Scenario: Activate a Maven Failsafe profile and resolve generated source roots
    Given the native GUI has a Maven reactor whose app integration tests are declared in a profile
    When the person opens and synchronizes the Maven reactor before opening Java source
    Then the Java Project panel warns when the app annotation processor context is incomplete
    When the person activates the disabled Maven profile and synchronizes it
    Then the Java Project panel shows the provider test JVM facts for each Failsafe source set
    And the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the selected execution project with its full JDK
    Then the synchronized Maven context exposes separate app and library integration-test source sets
    When the person runs integration tests from the synchronized app Maven source set
    Then Maven Failsafe reports the app test from its declared report directory
    When the person refreshes Maven context after app Failsafe generates build output
    Then the refreshed app context exposes its materialized processor path and generated source root
    And F12 opens the generated Java method declaration from its call site
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-custom-source-set
  Scenario: Debug an application class from a synchronized Gradle custom source set
    Given the project debugger GUI has a real Gradle custom test source set and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person sets a JDI source breakpoint in the synchronized Gradle integrationTest application and requests Debug
    Then the project debugger suspends at integrationTest entry with the saved project source
    When the person continues the custom Gradle debugger to the source breakpoint
    Then JDI stops in IntegrationRunner main before its output statement
    When the person continues the custom Gradle debuggee to completion
    Then the custom source-set application reports its runtime dependencies and selected JDK and exits
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-custom-source-set-coverage @native-java-project-coverage
  Scenario: Measure production coverage when duplicate Gradle tasks share custom-source-set outputs
    Given the project test GUI has a real Gradle custom test source set for coverage and a duplicate Test task with an incomplete runtime classpath, using a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person runs coverage from the synchronized Gradle integrationTest source set
    Then coverage from the synchronized Gradle integrationTest source set measures and opens the module's main Java code with line decoration
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-kotlin-dsl
  Scenario: Run Java tests in a multi-module Gradle Kotlin DSL project
    Given the project execution GUI has a real multi-module Gradle Kotlin DSL project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person runs tests for the synchronized Gradle Kotlin DSL project from Java Run
    Then the synchronized Gradle Kotlin DSL project runs its mapped test task and reports one passing test
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-coverage @native-java-gradle-multimodule-coverage
  Scenario: Measure application and project dependency coverage in Gradle Kotlin DSL
    Given the project test GUI has a real multi-module Gradle Kotlin DSL project for coverage and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person opens the Gradle library source before running coverage
    And the person runs coverage from Commands for the synchronized application module
    Then the multi-module Gradle coverage includes covered application and library code and opens the dependency source
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-debugger
  Scenario: Debug the synchronized Maven module with JDI and effective project dependencies
    Given the project debugger GUI has a real Maven reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Maven project with its selected full JDK
    And the person sets a source breakpoint in the synchronized app module and requests Debug from Commands
    Then the project debugger starts suspended before application code and saves the edit
    When the person continues the synchronized Maven debugger to the source breakpoint
    Then JDI stops on the selected module source before its output statement
    When the person reloads the synchronized Runner output through HotSwap
    Then JDI applies the synchronized Runner output and remains suspended
    When the person edits the synchronized Runner method and reviews its changed compiled class before reload
    When the person continues the Maven debuggee to completion
    Then the application reports its effective dependencies and selected JDK and its JVM exits
    When the person rebinds the saved Runner breakpoint and reruns the captured project debugger to completion
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-debugger
  Scenario: Debug the synchronized Gradle module with JDI and effective project dependencies
    Given the project debugger GUI has a real Gradle reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before Gradle synchronization
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    And the person sets a source breakpoint in the synchronized app module and requests Debug from Commands
    Then the project debugger starts suspended before application code with the saved edit
    When the person continues the synchronized Gradle debugger to the source breakpoint
    Then JDI stops on the selected module source before its output statement
    When the person reloads the synchronized Runner output through HotSwap
    Then JDI applies the synchronized Runner output and remains suspended
    When the person edits the synchronized Runner method and reviews its changed compiled class before reload
    When the person continues the Gradle debuggee to completion
    Then the application reports its effective dependencies and selected JDK and its JVM exits
    When the person rebinds the saved Runner breakpoint and reruns the captured project debugger to completion
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  Scenario: Inspect Maven source ownership, refuse obsolete evidence and present Gradle as partial
    Given the project context GUI has real Maven and Gradle reference projects and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person starts Eclipse JDT LS with the selected Maven JDK
    And the person synchronizes the Maven project with its selected full JDK
    And the person verifies the Java type package from the synchronized Maven source root
    Then the native project view shows effective Maven modules generated roots classpath scopes and artifact coordinates
    When the person refreshes the saved Java source structure
    Then the project model shows Runner at its engine-reported source location
    When the person opens Runner from the project model
    Then the editor reveals the reported line and preserves the unsaved draft
    When the person resolves the secondary main type
    And the Maven compiler adds a test output after context synchronization
    And the person reacquires Maven context after a background output change if required and resolves the same-path test type
    Then source ownership identifies the correct main and test files while preserving the editor draft
    When the Maven descriptor changes outside the IDE
    Then the project watcher retires the context and disables source ownership without saving the draft
    When the person synchronizes the Gradle reference project with its selected JDK
    Then Gradle is visibly partial with source ownership disabled and no build executed
    When the person explicitly evaluates the Gradle reference project after its build outputs are prepared
    Then Gradle effective modules and source ownership are visible while the Maven draft remains unsaved
    When the person refreshes the saved Java source structure for Gradle
    Then the project model shows Gradle Runner at its engine-reported source location
    When the person keeps the unsaved draft synchronizes Maven and navigates the inherited integer call
    Then the editor opens the exact cross-module declaration using the selected Maven context
    When the person attempts a project SDK change with an unsaved Java edit and requests navigation without resynchronizing
    Then the IDE preserves the draft while refusing stale navigation, or records that no distinct JDK is installed
    When the person synchronizes Maven again with the selected JDK
    And the person creates a Java module descriptor from the synchronized library source root
    Then the editor keeps the generated descriptor as a draft until Save and the saved descriptor compiles with the library sources
    When the person discards the fixture edit and closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-project-model
  Scenario: Present Gradle source locations from the RefactorKit project model
    Given the project context GUI has real Maven and Gradle reference projects and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Gradle reference project with its selected JDK
    Then Gradle is visibly partial with source ownership disabled and no build executed
    When the person explicitly evaluates the Gradle reference project after its build outputs are prepared
    Then Gradle effective modules and source ownership are visible while the Maven draft remains unsaved
    When the person refreshes the saved Java source structure for Gradle
    Then the project model shows Gradle Runner at its engine-reported source location
    When the person discards the fixture edit and closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-project-model
  Scenario: Display partial Gradle JPMS metadata and refuse incomplete source resolution
    Given the project context GUI has a real Gradle JPMS project and a capable daemon
    When the person opens the Java Project panel for the Gradle JPMS project
    And the person synchronizes the Gradle reference project with its selected JDK
    And the person explicitly evaluates the Gradle JPMS project with its real module-path JAR
    Then the native project view shows partial Gradle JPMS metadata and refuses incomplete source resolution
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-jpms-v5
  Scenario: Request complete Gradle JPMS v5 metadata and run and debug the named module
    Given the project context GUI has a real Gradle JPMS v5 project and a capable daemon
    When the person opens the Java Project panel for the Gradle JPMS project
    And the person synchronizes the Gradle reference project with its selected JDK
    And the person explicitly evaluates the Gradle JPMS project with its real module-path JAR
    Then the native project view requests complete Gradle JPMS v5 metadata and displays every standard directive
    When the person runs the synchronized Gradle JPMS v5 project as a named module
    Then the Gradle JPMS v5 Run resolves its dependency module and preserves literal arguments
    When the person starts JDI for the Gradle JPMS v5 named module
    Then the Gradle JPMS v5 debuggee suspends before application code
    When the person continues the Gradle JPMS v5 debuggee
    Then the Gradle JPMS v5 Debug resolves its dependency module, preserves literal arguments and exits
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-jpms-v5
  Scenario: Request complete Maven JPMS v5 metadata and run and debug the named module
    Given the project context GUI has a real Maven JPMS v5 project and a capable daemon
    When the person opens the Java Project panel for the Maven JPMS project
    And the person synchronizes the Maven JPMS project with its selected JDK
    Then the native project view requests complete Maven JPMS v5 metadata and displays every standard directive
    When the person runs the synchronized Maven JPMS v5 project as a named module
    Then the Maven JPMS v5 Run resolves its dependency module and preserves literal arguments
    When the person starts JDI for the Maven JPMS v5 named module
    Then the Maven JPMS v5 debuggee suspends before application code
    When the person continues the Maven JPMS v5 debuggee
    Then the Maven JPMS v5 Debug resolves its dependency module, preserves literal arguments and exits
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-gradle-preview
  Scenario: Apply verified Gradle preview settings to JDT LS
    Given the project context GUI has a real Gradle preview project and a capable daemon
    When the person opens the Java Project panel for the Gradle preview project
    And the person prepares JDT LS Gradle import and opens the preview source
    Then JDT LS reports the preview-feature mismatch before project-context synchronization
    When the person explicitly evaluates and builds the Gradle preview project
    Then the IDE applies Gradle's verified preview option to JDT LS and clears the diagnostic
    When the person closes the Gradle preview project IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-module-rename
  Scenario: Apply and roll back a reviewed Maven module rename
    Given the Maven module rename GUI has a real Maven reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes Maven's module catalog with the selected JDK
    Then the Maven module rename review remains available from its provider
    When the person corrects a refused Maven module destination without synchronizing again and reviews the rename
    Then the IDE refuses Apply while preserving the Maven module rename preview
    When the person discards the fixture edit and applies then rolls back the Maven module rename
    Then the IDE restores the original Maven module and build files
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-module-rename
  Scenario: Relocate a Maven module to a nested reactor directory while preserving its coordinates
    Given the Maven module rename GUI has a real Maven reference project and a capable daemon
    When the person reviews, applies and rolls back a nested Maven module relocation with the original artifact ID
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-maven-module-rename
  Scenario: Recover a saved Maven module rename interrupted between source moves
    Given the Maven module rename GUI has a real Maven reference project and a capable daemon
    And the daemon has stopped midway through a saved Maven module rename
    When the person opens the Java Project panel for the interrupted Maven rename
    And the person reviews saved-file recovery and confirms it after resolving an open draft
    Then the IDE restores the saved Maven project and synchronizes it again
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-project-tests @native-java-project-discovery
  Scenario Outline: Discover compiled module tests and execute one method with captured settings
    Given the project test GUI has a real <tool> reference project for discovery and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the edited Java source before Gradle project synchronization when needed
    And the person synchronizes the selected execution project with its full JDK
    And the person discovers tests from Commands for the synchronized application module
    Then all selected module methods are discovered without running their bodies
    When the person filters discovered module methods by name and kind
    And the person changes visible test settings and runs one discovered module method
    Then only the selected method runs with the discovery session JDK JVM options and environment
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    @native-java-maven-project-test-scope
    Examples: Maven
      | tool  |
      | maven |

    Examples: Gradle
      | tool   |
      | gradle |

  @native-java-project-tests @native-java-project-jupiter-tests
  Scenario Outline: Run a JUnit Jupiter test in the synchronized Maven or Gradle module
    Given the project test GUI has a real <tool> reference project for Jupiter execution and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the edited Java source before Gradle project synchronization when needed
    And the person synchronizes the selected execution project with its full JDK
    And the person runs tests for the synchronized application module
    Then the selected module runs one JUnit Jupiter test with the captured settings and selected JDK
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-project-tests @native-java-project-testng-tests
  Scenario Outline: Run a TestNG test in the synchronized Maven or Gradle module
    Given the project test GUI has a real <tool> reference project for TestNG execution and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the edited Java source before Gradle project synchronization when needed
    And the person synchronizes the selected execution project with its full JDK
    And the person runs tests for the synchronized application module
    Then the selected module runs one TestNG test with the captured settings and selected JDK
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-project-tests @native-java-project-mixed-engines
  Scenario Outline: Run JUnit 4 and Jupiter tests through the synchronized Maven or Gradle module
    Given the project test GUI has a real <tool> reference project for mixed JUnit execution and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the edited Java source before Gradle project synchronization when needed
    And the person synchronizes the selected execution project with its full JDK
    And the person runs tests for the synchronized application module
    Then the selected module runs its JUnit 4 and Jupiter tests through their configured engines
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-project-tests @native-java-project-coverage
  Scenario Outline: Measure application coverage from tests in the synchronized module
    Given the project test GUI has a real <tool> reference project for coverage and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the edited Java source before Gradle project synchronization when needed
    And the person synchronizes the selected execution project with its full JDK
    And the person runs coverage from Commands for the synchronized application module
    Then the module tests pass with the selected JDK and measured application instructions and lines
    And measured source navigation is available only with an available project context
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    @native-java-maven-project-test-scope
    Examples: Maven
      | tool  |
      | maven |

    Examples: Gradle
      | tool   |
      | gradle |

  @native-java-project-coverage
  Scenario Outline: Open a measured source in a workspace-root <tool> project
    Given the project test GUI has a real <tool> project at the workspace root for coverage
    When the person synchronizes the workspace-root project and runs tests with coverage
    Then Open measured source reveals the root project's covered Java code and a disk reload retires its coverage links
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-project-tests @native-java-project-test-rerun
  Scenario Outline: Navigate a failure from a named JVM class loader and rerun only the repaired method
    Given the project test GUI has a real <tool> reference project for rerun and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person saves the edited Java source before Gradle project synchronization when needed
    And the person synchronizes the selected execution project with its full JDK
    And the person runs tests from Commands for the synchronized application module
    Then the selected module reports one real failure and two passing companion methods
    When the person enables JDT LS Gradle import for this session when needed
    And the person restarts Eclipse JDT LS with the selected execution JDK
    And the person opens the reported Java test source
    Then the Java editor opens the exact test class from the selected module at the failing source line and preserves its source
    When the person repairs the failed test in the editor and saves it
    And the person synchronizes the project context after saving the repaired test when needed
    And the person changes visible test settings and reruns failures from Commands
    Then only the failed method runs again with the original JDK JVM options and environment
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with the repaired test and every other reference input preserved

    @native-java-maven-project-test-scope
    Examples: Maven
      | tool  |
      | maven |

    Examples: Gradle
      | tool   |
      | gradle |

  @native-java-test-templates
  Scenario: Offer JUnit, Mockito and Spring Boot templates from the resolved Maven test classpath
    Given the Java test-template GUI has a real Maven reference project with JUnit 4, Jupiter, TestNG, Mockito, Spring Boot Test and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Maven project with its selected full JDK
    And the person requests all resolved test-method, equality assertion, Mockito and Spring Boot templates in the synchronized Maven test source set
    Then the native check confirms Monaco inserts and compiles the resolved JUnit 4, Jupiter, TestNG, Mockito and Spring Boot templates with the selected JDK against the Maven test classpath while keeping every editor change unsaved
    When the person restores the test-template draft and closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-test-templates-gradle
  Scenario: Offer JUnit, Mockito and Spring Boot templates from the resolved Gradle test classpath after explicit evaluation
    Given the Java test-template GUI has a real Gradle reference project with JUnit 4, Jupiter, TestNG, Mockito, Spring Boot Test and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Gradle reference project with its selected JDK
    And the person explicitly evaluates the Gradle reference project after its build outputs are prepared
    And the person requests all resolved test-method, equality assertion, Mockito and Spring Boot templates in the explicitly evaluated Gradle test source set
    Then the native check confirms Monaco inserts and compiles the resolved JUnit 4, Jupiter, TestNG, Mockito and Spring Boot templates in the evaluated Gradle context with the selected JDK against the effective test classpath while keeping every editor change unsaved
    When the person restores the test-template draft and closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-selected-test-debugger
  Scenario Outline: Debug a selected test and stop its captured rerun with <tool>
    Given the native GUI has a real <tool> project for selected test debugging
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before test debugging
    And the person synchronizes the selected execution project with its full JDK
    And the person debugs the selected test then reruns it and stops the test JVM
    Then the selected Java test returns its real report and a captured debug rerun stops without executing the test body
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   |
      | maven  |
      | gradle |

  @native-java-failed-test-debugger
  Scenario Outline: Debug repaired failures with current saved breakpoints in a synchronized project
    Given the native GUI has a real <tool> project for failed test debugging from <origin>
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before test debugging
    And the person synchronizes the selected execution project with its full JDK
    And the person debugs a failing test class then repairs and debugs only its failed methods
    Then the failed test debug rerun uses current breakpoints and excludes the previously passing method
    When the person restores the failed test debug source through native text input and closes the IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    @native-java-maven-failed-test-debugger
    Examples: Maven
      | tool  | origin     |
      | maven | debug-test |
      | maven | test       |

    Examples: Gradle
      | tool   | origin     |
      | gradle | debug-test |
      | gradle | test       |

  @native-java-framework-test-debugger
  Scenario Outline: Debug framework failures with an explicit report-derived selection scope
    Given the native GUI has a real <tool> project for <framework> failed test debugging
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before test debugging
    And the person synchronizes the selected execution project with its full JDK
    And the person reviews the runner selections then repairs and debugs them
    Then the framework debug run follows the displayed method or class scope and preserves captured settings
    When the person restores the failed test debug source through native text input and closes the IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

    Examples:
      | tool   | framework |
      | gradle | jupiter   |
      | maven  | testng    |

  @native-java-framework-test-debugger
  Scenario: Navigate to an inherited interface default test and debug only failed tests
    Given the native GUI has a real Gradle Jupiter project with an inherited default test method
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly saves the edited Java source before test debugging
    And the person synchronizes the selected execution project with its full JDK
    And the person reviews the runner selections then repairs and debugs them
    Then the framework debug run follows the displayed method or class scope and preserves captured settings
    When the person restores the failed test debug source through native text input and closes the IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-declared-project @native-java-declared-project-tests
  Scenario Outline: Execute and discover <framework> tests in an explicitly declared two-module Java project
    Given the plain Java <framework> GUI has explicit sources and framework libraries
    When the person creates a plain Java declaration through the project form
    And the plain Java form has declared separate test roots and dependencies
    And the person synchronizes and selects the declared JDK source set
    Then the person builds each declared module in dependency order
    When the person runs one declared test method and reviews fresh results
    And the person discovers declared tests without execution and runs a captured method
    When the person closes the plain Java IDE
    Then the plain Java inputs are preserved and the IDE exits cleanly

    Examples:
      | framework |
      | JUnit     |
      | TestNG    |

  @native-java-entry-points @native-java-declared-project
  Scenario: Declare a plain Java project and launch its provider-owned main
    Given the plain Java GUI has explicit sources and a dependency JAR
    When the person creates a plain Java declaration through the project form
    And the person synchronizes and selects the declared JDK source set
    Then Build compiles only the declared sources into the chosen output directory
    When the person runs the declared main from the source file action
    And the person debugs the declared main at the cursor through a source breakpoint
    When the person closes the plain Java IDE
    Then the plain Java inputs are preserved and the IDE exits cleanly

  @native-java-entry-points
  Scenario: Discover and execute a saved main in the synchronized Maven module
    Given the project execution GUI has a real Maven reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person synchronizes the Maven project with its selected full JDK
    When the person requests main-class discovery with an unsaved Java draft
    And the person saves the Java draft, builds, synchronizes again and selects a provider-owned main class
    And the person runs the chosen main from the Java editor action
    Then the native application uses the selected JDK and runtime dependencies after saving the draft
    When the person synchronizes again, debugs the file main from the editor, stops on a source line and continues to completion
    When the person synchronizes, rejects a sibling without main and runs the type at the cursor
    And the person synchronizes and debugs the enclosing type at the cursor to completion
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-entry-points
  Scenario: Discover and execute a saved main in the synchronized Gradle module
    Given the project execution GUI has a real Gradle reference project and a capable daemon
    When the person opens the reference Java source and leaves an unsaved edit
    And the person explicitly synchronizes the Gradle execution project with its selected JDK
    When the person requests main-class discovery with an unsaved Java draft
    And the person saves the Java draft, builds, synchronizes again and selects a provider-owned main class
    And the person runs the chosen main from the Java editor action
    Then the native application uses the selected JDK and runtime dependencies after saving the draft
    When the person synchronizes again, debugs the file main from the editor, stops on a source line and continues to completion
    When the person synchronizes, rejects a sibling without main and runs the type at the cursor
    And the person synchronizes and debugs the enclosing type at the cursor to completion
    When the person restores the saved reference source and closes the project execution IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-editor-diagnostics
  Scenario Outline: Check unsaved Java compiler errors under Maven <profile>
    Given the Java compiler-check GUI has a Maven project using "<profile>"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

    Examples:
      | profile         |
      | source/target 8 |
      | release 8       |

  @native-java-editor-sdk26-diagnostics
  Scenario Outline: Check Java 26 editor drafts with the selected SDK compiler under Maven <profile>
    Given the Java compiler-check GUI has a Maven project using "<profile>"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

    Examples:
      | profile          |
      | source/target 26 |
      | release 26       |

  @native-java-editor-sdk26-diagnostics @native-java-editor-sdk26-test-diagnostics
  Scenario Outline: Keep Java 26 Maven main and JUnit test compiler classpaths separate under <profile>
    Given the Java compiler-check GUI has a Maven project with JUnit test sources using "<profile>"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the test dependency resolves only in test sources and repairs keep the classpaths separate
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

    Examples:
      | profile          |
      | source/target 26 |
      | release 26       |

  @native-java-editor-diagnostics @native-java-editor-gradle-diagnostics
  Scenario Outline: Check unsaved Java compiler errors under evaluated Gradle <profile>
    Given the Java compiler-check GUI has a Gradle project using "<profile>"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

    Examples:
      | profile         |
      | source/target 8 |
      | release 8       |

  @native-java-editor-diagnostics @native-java-editor-multi-module-diagnostics
  Scenario: Check unsaved Java compiler errors across dependent Maven reactor modules
    Given the Java compiler-check GUI has a Maven reactor using "source/target 8"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the changed library signature invalidates the caller and its unsaved repair resolves the error
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

  @native-java-editor-diagnostics @native-java-editor-multi-module-diagnostics
  Scenario: Check unsaved Java compiler errors across dependent Gradle multi-project modules
    Given the Java compiler-check GUI has a Gradle multi-project using "source/target 8"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the changed library signature invalidates the caller and its unsaved repair resolves the error
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

  @native-java-editor-diagnostics @native-java-editor-test-source-diagnostics
  Scenario: Check unsaved JUnit Java sources with separate Maven main and test classpaths
    Given the Java compiler-check GUI has a Maven project with JUnit test sources using "source/target 8"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the test dependency resolves only in test sources and repairs keep the classpaths separate
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

  @native-java-editor-diagnostics @native-java-editor-test-source-diagnostics
  Scenario: Check unsaved JUnit Java sources with separate Gradle main and test classpaths
    Given the Java compiler-check GUI has a Gradle project with JUnit test sources using "source/target 8"
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation
    When the person enables automatic Java compiler checks and repairs the companion
    Then the test dependency resolves only in test sources and repairs keep the classpaths separate
    Then the compiler-check results retire on edits and retain the expected SDK restriction
    When the person discards the Java drafts and closes the compiler-check IDE
    Then the compiler-check inputs remain unchanged and the native window exits cleanly

  @native-java-editor-diagnostics @native-java-editor-metadata-only-diagnostics
  Scenario: Keep compiler checks unavailable for metadata-only Java 27 without retiring build context
    Given the Java compiler-check GUI has a metadata-only Java 27 project
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    Then the compiler-check commands keep metadata-only Java analysis unavailable without losing the draft
    When the person pauses checks, discards the metadata-only draft and closes the IDE
    Then the metadata-only compiler-check inputs remain unchanged and the window exits normally

  @native-java-editor-diagnostics @native-java-editor-external-source-diagnostics
  Scenario: Refresh automatic Java compiler checks after an external source change in Maven
    Given the Java compiler-check GUI has a Maven project for external-source changes
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then automatic compiler checks recover from an external source change without saving drafts or evaluating the build
    When the person restores the external fixture, discards drafts and closes the compiler-check IDE
    Then the external-source compiler-check inputs remain unchanged and the window exits normally

  @native-java-editor-diagnostics @native-java-editor-external-source-diagnostics
  Scenario: Refresh automatic Java compiler checks after an external source change in Gradle
    Given the Java compiler-check GUI has a Gradle project for external-source changes
    When the person opens the compiler-check IDE and synchronizes its selected JDK
    And the person changes the Java caller and companion without saving
    Then automatic compiler checks recover from an external source change without saving drafts or evaluating the build
    When the person restores the external fixture, discards drafts and closes the compiler-check IDE
    Then the external-source compiler-check inputs remain unchanged and the window exits normally

  @native-java-git-branch-context
  Scenario: Retire and rebuild Maven context when an IDE branch switch changes the reactor
    Given the Java Git branch GUI has a real Maven reactor and a branch with an additional module
    When the person opens the Java Project panel for the Maven project
    And the person synchronizes the Maven project with its selected full JDK
    When the person switches, merges and aborts Java project branches, resynchronizes and runs their tests
    Then each branch and merge has its own current module catalog and source buffers and the selected tests pass
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved


  @native-java-git-branch-context @native-gradle-git-branch-context
  Scenario: Explicitly reevaluate Gradle context after an IDE branch switch changes its projects
    Given the Java Git branch GUI has a real Gradle build and a branch with an additional project
    When the person opens the Java Project panel for the Gradle project
    And the person explicitly synchronizes the Gradle Git branch project
    When the person switches, merges and aborts Java project branches, resynchronizes and runs their tests
    Then each branch and merge has its own current module catalog and source buffers and the selected tests pass
    And Gradle branch switching, merging and abort send no implicit project evaluation request
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-git-rebase-context
  Scenario: Retire Maven context through a conflicted rebase, abort and continuation
    Given the Java Git branch GUI has a real Maven reactor and a branch with an additional module
    When the person opens the Java Project panel for the Maven project
    And the person synchronizes the Maven project with its selected full JDK
    When the person aborts a Java rebase, resolves it again and resynchronizes before running tests
    Then rebase abort and continuation retire Java context and the rewritten project passes its tests
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-git-rebase-context @native-gradle-git-rebase-context
  Scenario: Explicitly rebuild Gradle context through a conflicted rebase, abort and continuation
    Given the Java Git branch GUI has a real Gradle build and a branch with an additional project
    When the person opens the Java Project panel for the Gradle project
    And the person explicitly synchronizes the Gradle Git branch project
    When the person aborts a Java rebase, resolves it again and resynchronizes before running tests
    Then rebase abort and continuation retire Java context and the rewritten project passes its tests
    And Gradle rebase operations send no implicit project evaluation request
    When the person closes the project context IDE
    Then the IDE exits cleanly with all reference source and build inputs preserved

  @native-java-reference-backend
  Scenario: Develop a real Spring MVC and JDBC backend through the native Java IDE
    Given the native Java IDE has an isolated Spring MVC and JDBC reference backend
    When the person imports the backend, applies a Java rename and reopens its applied review
    Then the backend context and original rollback authority remain available after closing the review
    When the person builds and tests the renamed backend from Java Run
    When the person runs the backend and exercises shared live state through the IDE HTTP and database tools
    When the person debugs an IDE HTTP request at its saved Java source breakpoint
    Then build, JUnit, HTTP, JDBC and JDI use the real backend while preserving the developer draft
    When the person cleans backend outputs, reopens Rollback and closes the native Java IDE
    Then the original backend sources are restored and all owned application JVMs have exited

  @native-java-compact-source
  Scenario: Create, discover and execute a compact Java 25 source with explicit launcher rules
    Given an isolated native Maven workspace targets Java 21 and has a selected JDK 25
    When the person synchronizes the project and attempts a compact source below Java 25
    Then the incompatible compact-source request preserves files, editor tabs and the form
    When the person upgrades the Maven release to 25 and creates a compact source beside another unsaved draft
    Then the captured compact draft compiles without saving it or the unrelated draft
    When the person saves, builds and manually runs the compact instance main through Java Run
    Then the real JDK 25 launches the compiled compact source and preserves its inputs
    When the person discovers the compact instance main with Java 25 launcher rules and runs the selected candidate
    Then the provider-owned compact class replaces the incorrect launch class and completes successfully
    When the person runs the compact main from its saved editor file using Java 25 launcher rules
    Then the editor file action executes the provider-owned compact class with the selected JDK
    When the person debugs the compact instance main at its saved source breakpoint
    Then JDI exposes the compact receiver and local value before the instance main completes
    When the person selects the inherited-main profile and runs the provider-owned child class
    Then the inherited profile omits the compact instance main and the real JVM launches the child
    When the person requests main launch inside a dormant inner type and then debugs the inheriting child at the cursor
    Then the inner type starts no session and JDI exposes the parent main before the child launch completes
    When the person checks and repairs a compact Java 25 draft through language-service and SDK compiler diagnostics
    Then both diagnostic providers track the compact draft without saving sources or rebuilding the project
    When the person closes the compact-source native IDE
    Then the compact source and Maven inputs remain saved and all owned JVMs exit

  @native-java-compact-source @native-java-compact-source-gradle
  Scenario: Create, discover and execute a compact Java 25 source in an evaluated Gradle project
    Given an isolated native Gradle workspace targets Java 21 and has a selected JDK 25
    When the person synchronizes the project and attempts a compact source below Java 25
    Then the incompatible compact-source request preserves files, editor tabs and the form
    When the person upgrades the Gradle release to 25 and creates a compact source beside another unsaved draft
    Then the captured compact draft compiles without saving it or the unrelated draft
    When the person saves, builds and manually runs the compact instance main through Java Run
    Then the real JDK 25 launches the compiled compact source and preserves its inputs
    When the person discovers the compact instance main with Java 25 launcher rules and runs the selected candidate
    Then the provider-owned compact class replaces the incorrect launch class and completes successfully
    When the person runs the compact main from its saved editor file using Java 25 launcher rules
    Then the editor file action executes the provider-owned compact class with the selected JDK
    When the person debugs the compact instance main at its saved source breakpoint
    Then JDI exposes the compact receiver and local value before the instance main completes
    When the person selects the inherited-main profile and runs the provider-owned child class
    Then the inherited profile omits the compact instance main and the real JVM launches the child
    When the person requests main launch inside a dormant inner type and then debugs the inheriting child at the cursor
    Then the inner type starts no session and JDI exposes the parent main before the child launch completes
    When the person checks and repairs a compact Java 25 draft through language-service and SDK compiler diagnostics
    Then both diagnostic providers track the compact draft without saving sources or rebuilding the project
    When the person closes the compact-source native IDE
    Then the compact source and Gradle inputs remain saved and all owned JVMs exit

  @native-java-modular-source-creation
  Scenario Outline: Create only compatible source drafts in a named <tool> module
    Given an isolated native <tool> project declares a named Java 25 module
    When the person synchronizes its module details and keeps an unrelated notes draft
    Then the source wizard has provider-qualified named-module metadata
    When the person attempts compact and unnamed-package types then creates a packaged type
    Then the incompatible requests create no files or tabs and the packaged type is an unsaved draft
    When the captured packaged draft is checked by the selected JDK and only the new type is saved
    Then the generated type belongs to a resolvable named module while notes and original inputs remain unchanged
    When the person inspects nested declarations and overloads in an unsaved project source
    Then the project outline navigates to the exact overload and preserves every source and notes draft
    When the person discards the unrelated draft and closes the modular-source IDE
    Then the modular source inputs remain intact and the native window closes normally

    Examples:
      | tool   |
      | Maven  |
      | Gradle |
