# Java Class Reload Runtime

Implemented behavior and limits: [ARC42 section 6.3](../../ARC42.md#63-java-execution). Rationale: [ADR 0021](../../ADR.md#adr-0021--structured-java-debugging-through-an-owned-jdi-process).

```mermaid
sequenceDiagram
    actor Person
    participant UI as Java Run and execution controller
    participant Adapter as Java execution adapter
    participant Native as Rust debugger session
    participant Build as Selected JDK or project build tool
    participant Storage as Private transfer file
    participant Helper as Owned JDI helper
    participant VM as Connected JVM
    Person->>UI: Refresh loaded JVM classes
    UI->>Adapter: Read-only class-list action
    Adapter->>Native: Current trusted workspace/session
    Native->>Helper: listLoadedClasses
    Helper->>VM: Enumerate prepared types
    VM-->>Helper: Bounded supported binary names and class-loader counts
    Helper-->>Native: Structured loaded-class state
    Native-->>UI: Names for class-name suggestions
    Note over UI,VM: Names do not identify a workspace source or output file
    Person->>UI: Choose Build and review changed classes
    UI->>UI: Save dirty editor buffers
    UI->>Adapter: Build request bound to active JDI session
    Adapter->>Native: Typed workspace/session request and trust
    Native->>Native: Validate current trusted JDI authority
    Native->>Native: Hash existing unambiguous outputs for listed JVM names
    Native->>Build: Run a separate build task
    Build-->>Native: Exit status and bounded output
    Native->>Native: Recheck scope and compare compiled files
    Native-->>UI: Build result and changed files, or comparison unavailable
    Note over UI,VM: File changes do not establish the bytes loaded by the JVM
    alt No usable changed-class selection
        UI-->>Person: Show actual build result and comparison status; no proposal is applied
    else Changed compiled files are available
    Person->>UI: Review and use changed classes; explicitly request Reload
    UI->>Adapter: Current trust, workspace, session and stop
    Adapter->>Native: Typed class reload request
    Native->>Native: Validate authority and actual VM capability
    Native->>Native: Refuse bytes that differ from the reviewed file hashes
    Native->>Storage: Capture bounded compiled bytes and integrity hash
    Native->>Native: Recheck state and retire local source binding
    Native->>Helper: Queue transfer path, hash and request identity
    Native-->>UI: Queued, without claiming application success
    Helper->>Storage: Read and verify captured transfer
    Helper->>VM: Resolve unique loaded types
    Helper->>VM: Redefine selected classes through JDI
    alt JVM accepts definitions
        VM-->>Helper: Actual redefinition returns
        Helper->>Helper: Retire affected breakpoints and old suspended identities
        Helper-->>Native: Applied result and refreshed runtime state
        Native-->>UI: Applied; active obsolete frames remain visible
    else JVM refuses the change
        VM-->>Helper: Actual error
        Helper-->>Native: Failed result
        Native-->>UI: Visible JVM refusal
    end
    Note over UI,Build: Manual Build and reload retains preselected files and the same build/session guards.
    Note over UI,VM: Review and compilation alone never request redefinition. Manual Reload does not build.
    Native->>Storage: Remove acknowledged transfer file
    end
    Note over Native,VM: Stop or Detach closes the owned helper; attachment preserves the external target.
    Note over Native,Build: Stop/Detach also cancels a build running beside this debugger session.
```
