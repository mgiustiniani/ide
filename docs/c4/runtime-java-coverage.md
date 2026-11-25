# Java Coverage Runtime

Implemented behavior and limitations: [ARC42 section 6.3](../../ARC42.md#63-java-execution).
This interaction measures the selected build-tool test execution. Its source-file and line counters describe compiled production code. Synchronized Gradle coverage resolves project dependencies from the selected test source set and generates their reports in a second Gradle invocation after the test process exits; direct and nested included builds share the execution data and JaCoCo classpath from that run. Source navigation and editor decorations are limited to a unique main source path from the captured Java Project context and source buffers that were open and remain unchanged for this run. Generated-source association is unavailable.

```mermaid
sequenceDiagram
    actor Developer
    participant UI as Java Run controller
    participant Editor as Editor save port
    participant Context as Captured Java Project context
    participant Native as Owned Java execution
    participant Tools as Maven or Gradle and JaCoCo
    participant Reports as Coverage report import
    Developer->>UI: Run tests with coverage
    UI->>UI: Require workspace trust and valid settings
    UI->>Editor: Save dirty buffers and capture open Java source buffers
    UI->>Native: Start coverage with captured configuration
    Native->>Native: Validate workspace and own private execution artifacts
    Native-->>UI: Starting session; coverage collecting
    Native->>Tools: Run selected tests with owned JaCoCo agent settings
    Tools-->>Native: Real test output and exit status
    alt Maven
        Native->>Tools: Run the JaCoCo report goal after tests, including failures
    else Manual Gradle project execution
        Native->>Tools: Run finalized Gradle report tasks after tests, including failures
    else Synchronized Gradle project context
        Native->>Native: Capture resolved build and project identities
        Native->>Tools: Run the aggregate report task after the test process, including failures
    end
    Tools-->>Reports: Generated XML and execution session identifier
    Native->>Reports: Collect measurements for this execution
    Reports->>Reports: Check correlation, regular files, XML and size limits
    Reports-->>Native: Ready, partial or unavailable counters and source lines
    Native-->>UI: Test outcome and measured coverage remain separate
    opt Complete measurements, available context and unchanged captured buffers
        UI->>Context: Match package and filename in declared main source roots
        Context-->>UI: Unique captured source path or unavailable mapping
        UI->>Editor: Open a measured line and decorate the unchanged active source
        Editor-->>Developer: Show covered, uncovered and partial lines
        Note over UI,Editor: Ambiguous roots, unopen sources or buffer changes leave measurements without source links or decorations.
    end
    UI-->>Developer: Counters, measured lines and explicit limitations
    opt Stop or workspace revocation
        UI->>Native: Stop the owned execution
        Native->>Tools: Terminate owned processes
        Native-->>UI: Stopped; complete coverage unavailable
    end
```
