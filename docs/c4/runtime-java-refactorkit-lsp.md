# RefactorKit Java LSP Refactoring Runtime

Implemented behavior and limitations: [ARC42 section 6.4](../../ARC42.md#64-refactoring-and-agent-flows).

Capability discovery and preview use a short-lived RefactorKit LSP process. The desktop selects operations from the server's advertised capabilities. Preview requests bind the workspace generation, synchronized project root, source path, Java editor overlays and document versions. The native client starts analysis at that selected project root, passes the selected project JDK, and uses the host Java runtime configured for the application to launch the server. It maps Java documents and proposed edits between project-relative and workspace-relative paths, and excludes open Java documents outside the selected project. The native client accepts only explicitly client-managed, version-checked edits for the requested operation and project. Before applying a reviewed proposal, the desktop rechecks the workspace generation, selected project root, project JDK and captured buffer versions; a valid Apply changes editor buffers only. A proposed superclass file becomes a dirty editor tab and is written only after a separate Save action.

One Linux release/no-bundle native GUI scenario using a source-built RefactorKit LSP qualifies Change Visibility: Apply updates the editor buffer only, offline Maven `verify` passes on a copy using the selected JDK 21, the saved source remains unchanged, and discarding the draft restores a clean buffer. This does not qualify other LSP operations, packaged applications or other operating systems. The default cached RefactorKit 0.7.0 bundle does not advertise these commands, so this LSP path is unavailable with that bundle. Provider command coverage and desktop-side tests do not establish package behavior.

An opt-in Rust integration test invokes the production stdio client against a source-built RefactorKit LSP server. It verifies initialization and command discovery, requests a bounded `changeVisibility` proposal for a Java 17 Maven fixture, checks the normalized versioned edit, and confirms that the saved Java source remains unchanged. Run it with explicit server and project-JDK paths:

```sh
IDE_REAL_REFACTORKIT_LSP=/path/to/refactorkit-lsp IDE_REAL_JAVA_HOME=/path/to/jdk \
  cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib \
  commands::refactorkit_lsp::tests::real_lsp_change_visibility_uses_native_transport_and_preserves_saved_source \
  -- --ignored --exact --test-threads=1
```

This test covers the Rust transport and provider response on one bounded fixture; it does not exercise the desktop UI or packaged-provider discovery.

```mermaid
sequenceDiagram
    actor Developer
    participant Monaco as Monaco Java editor
    participant App as Desktop application
    participant Adapter as Tauri refactoring adapter
    participant Native as Native RefactorKit LSP client
    participant LSP as RefactorKit LSP server
    participant Disk as Workspace files

    App->>Adapter: Discover capabilities for workspace, generation and project JDK
    Adapter->>Native: Typed capability request
    Native->>Native: Verify active workspace and selected project JDK
    Native->>LSP: Start process and initialize with workspace root
    LSP-->>Native: Advertised execute-command capabilities
    Native->>LSP: shutdown and exit
    Native-->>Adapter: Available operations or explicit unavailability
    Adapter-->>App: Capability-gated Java actions

    Developer->>Monaco: Request a Java refactoring
    Monaco->>App: Active source, cursor or selection
    App->>App: Capture editor buffers; retain Java overlays and versions
    App->>Adapter: Preview request for current workspace generation
    Adapter->>Native: Operation, selected project root and JDK, Java documents
    Native->>Native: Verify workspace identity, generation, project root, paths and versions
    Native->>LSP: Start process and initialize with selected Java project root
    loop Each saved Java document in selected project
        Native->>LSP: textDocument/didOpen with captured version and buffer text
    end
    Native->>LSP: workspace/executeCommand with operation arguments
    LSP-->>Native: Client-managed versioned WorkspaceEdit
    Native->>Native: Check ownership, versions, workspace paths and operation shape
    Native->>LSP: shutdown and exit
    Native-->>Adapter: Normalized proposal or explicit refusal
    Adapter-->>App: Preview for the captured documents
    App->>App: Stage exact before/after transaction without mutation
    App-->>Developer: Review proposed editor changes

    Developer->>App: Apply to editor buffers
    App->>App: Recheck workspace generation, project root, project JDK and every captured buffer
    App->>Monaco: Commit the reviewed edits to unsaved buffers
    opt Extract Superclass proposes CreateFile
        App->>Monaco: Open generated Java source as a dirty tab
        Note over Monaco,Disk: No workspace file is written by Apply
        Developer->>Monaco: Save generated source
        Monaco->>Disk: Create file atomically without overwriting a new destination
        Disk-->>App: Save succeeds or reports a destination conflict
        App->>App: Refresh the file tree after successful first save
    end
```
