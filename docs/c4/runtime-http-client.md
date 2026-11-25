# HTTP Client Runtime

Implemented desktop interaction. Behavior, bounds and limitations: [ARC42 section 6.9](../../ARC42.md#69-http-client).

```mermaid
sequenceDiagram
    actor Person
    participant Panel as HTTP client panel
    participant Controller as HTTP and collection controllers
    participant Parser as Local OpenAPI importer and parameter formatter
    participant FileParser as HTTP request-file parser
    participant Port as Web-core HTTP client port
    participant Adapter as Tauri HTTP client adapter
    participant Command as Native HTTP request command
    participant OAuth as Native OAuth command
    participant Browser as External system browser
    participant Callback as Temporary native loopback listener
    participant Identity as User-selected authorization server
    participant LibraryCommand as Native HTTP collection commands
    participant Store as Private per-workspace collection storage
    participant Chooser as Native save dialog
    participant Export as Selected new JSON file
    participant Service as User-selected HTTP service
    opt Load local collections
        Controller->>Port: Load for current workspace and generation
        Port->>Adapter: Load collection request
        Adapter->>LibraryCommand: Correlated read
        LibraryCommand->>Store: Lock and read bounded private JSON
        Store-->>LibraryCommand: Templates, environments and revision
        LibraryCommand-->>Adapter: Correlated snapshot
        Adapter-->>Port: Validated current snapshot
        Port-->>Controller: Current library
        Controller-->>Panel: Saved requests and environments
        Person->>Panel: Select template and environment (no network request)
    end
    opt Save a reusable request or environment
        Person->>Panel: Choose Save
        Panel->>Controller: Updated library and reviewed revision
        Controller->>Port: Save for the current workspace
        Port->>Adapter: Save request
        Adapter->>LibraryCommand: Correlated update
        LibraryCommand->>LibraryCommand: Verify workspace activation and revision
        LibraryCommand->>Store: Lock, validate, atomically replace private JSON
        Store-->>LibraryCommand: Saved revision or failure
        LibraryCommand-->>Adapter: Correlated snapshot or refusal
        Adapter-->>Port: Validated save result
        Port-->>Controller: Save result
        Controller-->>Panel: New revision or refusal (keep draft)
    end
    opt Export saved collections to a selected external file
        Person->>Panel: Choose Export collections as…
        Panel->>Controller: Request export of current saved library
        Controller->>Port: Export with workspace and expected library revision
        Port->>Adapter: Request native destination selection
        Adapter->>LibraryCommand: No renderer-supplied destination
        LibraryCommand->>LibraryCommand: Check main window, workspace and current revision
        LibraryCommand->>Chooser: Show native save dialog without holding workspace/store locks
        Person->>Chooser: Choose a new JSON file or Cancel
        alt Cancel
            Chooser-->>LibraryCommand: No destination
            LibraryCommand-->>Adapter: No export created
        else Choose file
            Chooser-->>LibraryCommand: Native-selected local destination
            LibraryCommand->>LibraryCommand: Recheck binding, activation and library revision
            LibraryCommand->>Store: Read current bounded saved library
            LibraryCommand->>Export: Publish complete JSON as a new private file; refuse existing targets
            LibraryCommand-->>Adapter: Correlated destination and byte count
        end
        Adapter-->>Port: Validated result or cancellation
        Port-->>Controller: Export result
        Controller->>Controller: Suppress results from retired workspace, generation or port
        Controller-->>Panel: Current export status
        Note over Panel,Service: Export sends no HTTP request and retains the current draft
    end
    opt Prepare a request from OpenAPI
        Person->>Panel: Paste document and choose Load OpenAPI
        Panel->>Parser: Parse bounded JSON/YAML text in memory
        Parser-->>Panel: Supported operations, explicit parameter definitions and request examples
        Person->>Panel: Select operation
        opt Declared parameters
            Person->>Panel: Review/edit values and choose Prepare request
            Panel->>Parser: Serialize supported styles or content within request limits
            Parser-->>Panel: Encoded URL and headers or a preparation refusal
            Note over Panel: Preserve draft on refusal; edits require preparation again
        end
        Person->>Panel: Review editable request before Send
    end
    opt Prepare a request from the active HTTP editor buffer
        Person->>Panel: Select a file request (no network request)
        Panel->>FileParser: Parse bounded buffer and resolve referenced file variables
        FileParser-->>Panel: Request preview or unsupported entry
        Person->>Panel: Review resolved request and choose Send file request
        Panel->>Panel: Recheck live buffer, selection and workspace activation
    end
    opt Acquire a service-account token
        Person->>Panel: Enter Client Credentials settings; Get OAuth token
        Panel->>Port: Typed explicit token request
        Port->>Adapter: Token acquisition
        Adapter->>OAuth: Main-window native command
        OAuth->>OAuth: Check workspace and endpoint policy
        OAuth->>Identity: Form POST through bounded HTTP transport, no redirects
        Identity-->>OAuth: Complete JSON token or refusal
        OAuth->>OAuth: Normalize Bearer fields; recheck workspace activation
        OAuth-->>Panel: Correlated token or redacted failure
        Person->>Panel: Review scope/lifetime; Use OAuth token
        Note over Panel: No API request yet; token remains in memory
    end
    opt Authorize through the system browser
        Person->>Panel: Configure registered client; Sign in with system browser
        Panel->>Port: Start scoped browser authorization
        Adapter->>OAuth: Start command
        OAuth->>Callback: Bind loopback; generate state and native S256 verifier
        OAuth->>Browser: Request OS URL handler with challenge and redirect
        OAuth-->>Panel: Captured session and callback URI
        Panel->>OAuth: Complete captured session through port/adapter
        Person->>Browser: Login and approve consent
        Browser->>Identity: Authorization and consent
        Identity-->>Browser: Redirect with code, state and issuer
        Browser->>Callback: GET loopback response
        Callback->>OAuth: Validated code or refusal; close listener
        OAuth->>Identity: One code exchange; no redirects
        Identity-->>OAuth: Token response
        OAuth->>OAuth: Recheck scope and calculate expiry from exchange start
        OAuth-->>Panel: Token metadata or redacted refusal
        Person->>Panel: Review token; Use sign-in token
        Note over Panel,Browser: API Send remains separate; cancel retires the listener, not the browser
    end
    opt Configure authentication for a manual request
        Person->>Panel: Choose Basic or Bearer and enter credentials
        Note over Panel: Helper fields stay in memory and are omitted from saved templates
    end
    Person->>Panel: Enter or review request and choose Send
    Panel->>Controller: Submit draft and optional manual authentication
    Controller->>Controller: Resolve variables and expiry; build Authorization; enforce OAuth HTTPS and no-redirect policy
    Controller->>Controller: Capture workspace, generation and request identity
    Controller->>Port: Send typed request
    Port->>Adapter: Invoke native adapter
    Adapter->>Command: Correlated Tauri command
    Command->>Command: Validate URL, method and size limits
    Command->>Service: Send with timeout and selected redirect policy
    Service-->>Command: Status, headers and response body
    Command->>Command: Bound and encode response
    Command-->>Adapter: Correlated result
    Adapter-->>Port: Validated result
    Port-->>Controller: Request result
    Controller->>Controller: Discard if workspace generation is stale
    Controller-->>Panel: Current response or transport error
    Panel-->>Person: Display status, headers and body
```
