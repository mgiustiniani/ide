# Java Formatting Runtime

Implemented behavior and limitations: [ARC42 section 6.2](../../ARC42.md#62-editing-and-saving).
This interaction formats the active Java buffer through the initialized JDT LS session. It covers document formatting, selected-line formatting and optional formatting after typing a server-advertised character. Changes remain unsaved. Workspace settings control indentation, the typing preference and an optional Eclipse formatter profile; verification scope is maintained in ARC42.

```mermaid
sequenceDiagram
    actor Developer
    participant Settings as Workspace editor settings
    participant App as Desktop application
    participant Storage as Private session storage
    participant Monaco as Monaco editor
    participant Controller as Java language controller
    participant Sync as Java document synchronization
    participant Adapter as Tauri Java intelligence adapter
    participant Native as Native JDT LS service
    participant JDT as Eclipse JDT LS
    Developer->>Settings: Choose indentation, typing preference or Eclipse formatter profile
    Settings->>App: Save preferences for current workspace
    App->>Monaco: Update open editor options
    opt Eclipse formatter profile selected
        App->>App: Validate profile XML and exact profile name
        App->>Storage: Copy profile XML to private session file
        App->>JDT: Configure file URI and profile name
        App->>Monaco: Restart language session and reopen unsaved buffers
    end
    alt Manual formatting
        Developer->>Monaco: Format Document or Format Selection
    else Typing preference enabled and character advertised
        Developer->>Monaco: Type character
        Monaco->>Monaco: Wait for exact typed buffer context, bounded to half a second
    end
    Monaco->>Controller: Current document/version, indentation and optional range or typed character/position
    Controller->>Sync: Flush pending didChange for the active buffer
    Sync-->>Controller: Synchronized snapshot
    Controller->>Adapter: Capability-gated request bound to workspace, generation and version
    Adapter->>Native: Typed formatting request with indentation options
    Native->>Native: Verify active session and open document version
    alt Format Document
        Native->>JDT: textDocument/formatting
    else Format Selection
        Native->>JDT: textDocument/rangeFormatting
    else Format while typing
        Native->>Native: Require the exact advertised character
        Native->>JDT: textDocument/onTypeFormatting
    end
    JDT-->>Native: Formatting text edits
    Native->>Native: Check UTF-16 ranges, overlap, document bounds and selected-line bounds
    Native-->>Adapter: Correlated edits or explicit refusal
    Adapter-->>Controller: Normalized document edits
    Controller->>Controller: Reject a replaced session or changed source buffer
    Controller-->>Monaco: Edits only for the unchanged document version
    Monaco->>Monaco: Apply edits to the in-memory editor model
    Monaco-->>Developer: Formatted, still-unsaved buffer
```
