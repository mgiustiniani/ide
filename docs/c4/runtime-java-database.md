# Java Database Runtime Interaction

This sequence describes the implemented desktop JDBC session. Connecting, executing SQL, estimating a plan and changing transaction state each require an explicit action.

```mermaid
sequenceDiagram
    actor Developer
    participant Panel as Java Database Panel
    participant Controller as Workspace-bound Controller
    participant Adapter as Tauri Adapter
    participant Rust as Native Session Owner
    participant JDK as Persistent JDK Worker
    participant Driver as Captured JDBC Driver
    participant DB as Selected Database

    Developer->>Panel: Trust driver and choose Connect
    Panel->>Controller: Submit connection draft
    Controller->>Adapter: Connect with workspace and request identity
    Adapter->>Rust: Correlated Tauri command
    Rust->>Rust: Validate main window and active workspace; reserve session
    Rust->>JDK: Compile bridge, capture driver JAR, start owned JVM
    Rust->>JDK: Send URL and credentials on stdin once
    JDK->>Driver: Load captured driver
    Driver->>DB: Open physical connection and inspect metadata
    JDK-->>Rust: Bounded metadata and session state
    Rust-->>Adapter: Confirm current workspace and session
    Adapter-->>Controller: Validate limits and identity
    Controller-->>Panel: Show schema and auto-commit state

    Developer->>Panel: Begin transaction
    Panel->>Controller: Disable auto-commit explicitly
    Controller->>Rust: Scoped transaction command through adapter
    Rust->>JDK: Reserve worker and request begin
    JDK->>Driver: setAutoCommit(false) on existing connection
    JDK-->>Panel: Confirm manual mode through native adapter/controller

    Developer->>Panel: Open schema suggestions for a captured SQL selection
    Panel->>Panel: Filter captured current-catalog metadata and quote identifiers
    Developer->>Panel: Select an identifier
    Panel->>Panel: Revalidate workspace, metadata and draft; replace only selection
    Note over Panel: No connection, metadata refresh or SQL execution from insertion

    Developer->>Panel: Review SQL and optional typed parameters; Run SQL
    Controller->>Rust: Scoped SQL command through adapter
    Rust->>Rust: Validate SQL/parameters and reserve worker
    Rust->>JDK: Send unchanged SQL and optional bindings on stdin
    alt Bound parameters selected
        JDK->>Driver: Prepare SQL, check parameter count and bind typed values
    else Ordinary statement
        JDK->>Driver: Create statement
    end
    Driver->>DB: Execute using existing connection
    JDK-->>Panel: Bounded result or SQL refusal plus current session state

    opt Estimate one SQL plan
        Developer->>Panel: Review SQL and bindings; Estimate plan
        Controller->>Rust: Dedicated estimated-plan request through adapter
        Rust->>JDK: Reserve same worker; send SQL and bindings
        JDK->>Driver: Verify supported H2 provider and live REGULAR mode
        JDK->>JDK: Admit one statement and refuse ANALYZE or multiple submissions
        JDK->>Driver: Prepare EXPLAIN PLAN FOR with typed bindings
        Driver->>DB: Request estimated plan on existing connection
        JDK-->>Panel: Correlated bounded plan and current session state
        Note over Panel,DB: Keep SQL, bindings and manual work; no fallback to ordinary execution
    end

    opt Export a captured tabular result
        Developer->>Panel: Choose format; acknowledge partial rows if needed
        Panel->>Rust: Export options and captured request identity through database port
        Rust->>Rust: Check workspace activation and immutable native result
        Rust->>Developer: Native Save As chooser for a new file
        Developer-->>Rust: Choose destination or cancel
        Rust->>Rust: Recheck ownership; create CSV/JSON without replacing files
        Rust-->>Panel: Confirm export or report refusal/cancellation
        Note over Rust,DB: No connection or SQL execution during export
    end

    Developer->>Panel: Commit or Rollback
    Controller->>Rust: Scoped transaction command through adapter
    Rust->>JDK: Request boundary on existing connection
    JDK->>Driver: commit() or rollback()
    JDK-->>Panel: Confirm outcome; leave auto-commit off

    opt Stop during startup or a running operation
        Developer->>Panel: Stop and disconnect
        Controller->>Rust: Stop captured session or connection request
        Rust->>JDK: Request process termination, then enforce bounded exit
        Rust-->>Panel: Confirm worker exit; database outcome unknown
        Panel->>Panel: Keep SQL/parameters for review; clear credentials
    end

    Developer->>Panel: Rollback and disconnect
    Controller->>Rust: Close with explicit rollback consent
    Rust->>JDK: Request rollback and connection close
    JDK->>Driver: Roll back manual work and close
    Rust->>Rust: Stop owned worker and remove private temporary files
    Rust-->>Panel: Confirm disconnect or report unknown outcome
```

The panel remains mounted across bottom tool-window changes. Workspace/close guards refuse transitions while the worker is busy or submitted manual work remains. Cleanup cannot silently authorize rollback of pending work. The native workspace activation check runs before root authority changes; a request's UI generation is correlation data, while the native activation generation and workspace binding determine session ownership.

The statement counter is conservative and includes reads, estimated-plan requests and failed attempts. It is not a database change detector. DDL may cause an implicit commit, according to the driver's metadata. Stop, a timeout, transport failure or failed transaction control closes the session without claiming a confirmed database outcome. Stop attempts bounded orderly process termination before forcing exit; database durability settings still apply. A stop that arrives before its queued connection request is handled prevents that request from opening a worker. Late SQL/startup replies cannot replace the stopped state. The person must check database state before retrying. Limits, lifecycle behavior, verification scope and unavailable workflows are maintained in [ARC42 section 6.10](../../ARC42.md#610-java-database-tools).
