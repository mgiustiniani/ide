# Java Integration Diagram

Current behavior: [ARC42 section 5.2](../../ARC42.md#52-java-tooling). Execution and debugger scope: [section 6.3](../../ARC42.md#63-java-execution). Dotted relationships below are future work, not available providers.

```mermaid
flowchart LR
    Monaco[Monaco Java model] --> Sync[Versioned document synchronization]
    Sync --> JDT[JDT LS\nDiagnostics, completion, hover and signature help]
    Monaco --> Navigation[Java navigation port\nSaved-source cursor definition and references]
    Navigation --> NativeNavigation[Tauri adapter and native snapshot validation]
    NativeNavigation --> RK
    Project[Project and refactoring controllers] --> RK[RefactorKit\nSymbols, navigation and reviewed transformations]
    Run[Java execution controller and panel] --> Port[Java execution port and Tauri adapter]
    Run --> EditorDebug[Java source debugger controller\nGuarded Monaco glyphs and selected-frame lines]
    Monaco --> EditorDebug
    EditorDebug --> Port
    Port --> Owner[Rust process manager]
    Owner --> Build[Maven or Gradle\nBuild, test and application tasks]
    Build --> XML[JUnit XML reports]
    XML --> Reports[Native bounded report inspection\nFresh suites, cases and failed selections]
    Reports --> Port
    Owner --> JDK[Selected JDK\njavac, java and jdb]
    Owner --> Bridge[JDI debugger helper\nTyped runtime state and suspension identities]
    Owner --> Reload[Captured compiled class reload\nWorkspace, runtime and integrity guards]
    Reload --> Bridge
    Bridge -->|Launches and owns through JDI/JDWP| Debuggee[Launched Java application under debug]
    Bridge -->|SocketAttach; external target ownership| ExternalVM[Already listening JDWP JVM]
    Bridge --> Owner
    Owner --> SourceBinding[Saved Java source binding\nCaptured fingerprints and unique runtime source paths]
    SourceBinding --> Port
    Run -.-> Advanced[Future logpoints, general expressions, automatic compile/reload and verified external source binding]
    Monaco -.-> Coordinator[Planned shared RefactorKit change coordinator\nSemantic selection, snapshot, review and reconciliation]
    Coordinator -.-> RK
```

Planned transformation workflow: [ARC42 section 8.4](../../ARC42.md#84-planned-shared-refactoring-workflow). Detailed model: [workspace.dsl](workspace.dsl), Java provider/component views. The filename is retained for existing links; this is an implementation diagram with an explicitly marked future extension.
