# Java project source-set execution

This interaction uses the selected module and source set from RefactorKit's effective project context. Build, Run and Debug support additional Gradle source sets when the provider exposes their outputs and runtime classpath. Test execution, discovery and coverage also support a custom Gradle source set when exactly one `Test` task uses its compiled class directories and its classpath contains the provider-declared runtime classpath. Maven integration tests use the configured Failsafe plugin through `verify`; earlier lifecycle phases, including Surefire unit tests, also run. Selectors use `it.test`, and only fresh XML from the configured report directory is attributed to the action. A synchronized Maven source set with kind `integration-test` requires RefactorKit context v4 to attest exactly one complete Failsafe execution, its phase and goals, and a concrete report directory. Partial, ambiguous, unresolved, or unsafe metadata is refused before Maven starts. Only integration-test and integration-coverage operations are available for this source set; other Maven `custom` source sets remain unavailable. The IDE does not infer source-set kinds from paths or modify the project build. The selected test filter and test JVM options apply to execution; mapped Gradle test tasks run for every request to produce fresh results. Discovery uses Gradle dry-run and does not run JUnit test bodies. Coverage attaches JaCoCo to the mapped task and generates its report from the selected source set. Ambiguous mappings or a mismatched classpath fail closed. Local adapter, UI, and Rust tests cover v4 consumption and refusal paths. One synchronized Maven Build Helper/Failsafe source set now passes in a Linux release/no-bundle GUI with a v4-capable daemon; packaged applications, broader Maven layouts, and other operating systems remain unqualified.

```mermaid
sequenceDiagram
    actor Person
    participant UI as Java Run
    participant Native as Native execution service
    participant RK as RefactorKit project context
    participant Gradle as Gradle build
    participant Maven as Maven build
    participant JVM as Selected JDK
    participant JDT as JDT LS workspace index

    Person->>UI: Request an operation for a selected source set, or repeat captured Run/Debug
    UI->>UI: Save open buffers; capture reviewed saved revisions
    alt New operation
        UI->>RK: Refresh exact provider/module/source-set context
        RK-->>UI: Current snapshot and selected source-set evidence
        UI->>UI: Verify saved revisions, workspace, project settings and selection
        UI->>Native: Start operation with refreshed project authority
    else Restart or rerun a captured Run or Debug session
        UI->>Native: Request restart of exact session with current trust and bound breakpoints
        Native->>RK: Validate retained provider settings and session
        opt Previous owned process is still running
            Native->>JVM: Stop previous owned process and wait for exit
        end
        Native->>Native: Replace exact session; retain captured launch configuration
    end
    Native->>RK: Resolve operation-specific execution evidence
    RK-->>Native: Snapshot, source-set outputs and runtime classpath
    alt Custom Gradle Discovery
        Native->>Gradle: Require one Test task with matching classes and runtime classpath
        Native->>Gradle: Dry-run mapped task to collect test descriptors
        Gradle-->>Native: Actual task exit and discovery data
    else Custom Gradle Test
        Native->>Gradle: Require one Test task with matching classes and runtime classpath
        Native->>Gradle: Run selected task with the test filter and JVM options
        Gradle-->>Native: Actual task exit and fresh JUnit reports
    else Custom Gradle Coverage
        Native->>Gradle: Require one Test task with matching classes and runtime classpath
        Native->>Gradle: Run mapped task with JaCoCo, filter and JVM options
        Gradle-->>Native: Actual task exit, fresh JUnit reports and selected-source-set coverage
    else Gradle Build, Run or Debug
        Native->>Gradle: Run private task depending on selected classesTaskName
        opt Run or Debug
            Gradle->>Gradle: Resolve selected source set runtimeClasspath
        end
        Gradle-->>Native: Actual task exit and output
    else Maven Failsafe integration tests
        Native->>RK: Request context v4 for provider, module and integration-test source-set kind
        RK-->>Native: One declared execution, selectors and reportsDirectory
        Native->>Native: Require complete unique execution and workspace-relative report path
        Native->>Maven: Run verify and optional it.test selector
        Maven-->>Native: Actual task exit and fresh XML from declared reportsDirectory
        Native->>Native: Require complete fresh Failsafe reports; reject missing results
    else Maven main or test source set
        Native->>Maven: Run selected module compile or runtime preparation task
        Maven-->>Native: Actual task exit and output
    end
    opt Run or Debug
        Native->>RK: Re-resolve context after compilation
        RK-->>Native: Current module, source set and runtime evidence
        Native->>Native: Refuse if project or selected source set changed
        Native->>JVM: Launch selected main class with provider runtime classpath
        JVM-->>Native: Process output and exit; Debug also owns the JDI session
    end
    Native-->>UI: Report task or process status and captured output
    UI-->>Person: Show result for the captured workspace session
    opt Person opens a reported test source
        Person->>UI: Open test source
        UI->>JDT: Search the reported Java class in the current workspace generation
        JDT-->>UI: Bounded class symbols and source ranges
        UI->>UI: Require one class declaration inside the selected test module
        UI->>UI: Open the resolved source without using report paths
        alt Failed case has an exact class frame and line in the saved buffer
            UI-->>Person: Reveal the bounded failure line
        else No usable failure frame
            UI-->>Person: Reveal the class declaration
        end
    end
```

The build tool performs compilation, test execution and runtime dependency resolution. RefactorKit remains the authority for project and source-set metadata; the IDE does not construct a competing semantic project model. The native service verifies custom test-task outputs and runtime classpath before the mapped task runs. Custom-source-set discovery uses the same verified mapping and dry-run facility. Custom-source-set coverage applies JaCoCo to that verified task and reports against the selected source set. Maven Failsafe configuration remains project-owned; synchronized execution uses the provider-declared report directory, and when `verify` produces no fresh integration-test reports, the IDE reports a failed task. Before starting a project operation, the IDE verifies its captured saved-buffer revisions before and after context acquisition. Only that reviewed post-save execution refresh may omit the retired source snapshot hash; ordinary context refreshes remain snapshot-bound. Test-source navigation resolves its file through JDT LS symbols inside the selected module; the IDE uses report stack frames only for an exact Java class and filename match with a line inside the opened, saved buffer. Gradle symbol lookup requires explicit, session-only authorization for JDT LS Gradle import; RefactorKit synchronization does not grant it.
