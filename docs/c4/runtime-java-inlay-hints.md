# Java Inlay Hints Runtime

Implemented behavior and limitations: [ARC42 section 5.2](../../ARC42.md#52-java-tooling) and [section 6.2](../../ARC42.md#62-editing-and-saving).

Monaco requests hints for the visible range of the active Java buffer. The controller flushes pending document changes and binds the request to the workspace, language-server generation and document version. The native service requires the negotiated JDT LS capability, validates UTF-16 positions against the synchronized document and requested range, removes provider tooltips and commands, and returns bounded plain-text labels. Current preferences show parameter names for literal arguments. Replies for an edited buffer or replaced session are discarded. Hints do not modify or save source.

The installed JDT LS smoke test verifies a literal-argument parameter hint. Monaco provider tests verify coordinate mapping and stale-reply suppression. A Linux release/no-bundle native GUI scenario confirms Monaco renders parameter labels beside literal arguments while leaving saved source unchanged. Installer and other operating-system coverage remains unavailable.

```mermaid
sequenceDiagram
    actor Developer
    participant Monaco as Monaco Java editor
    participant Controller as Java language controller
    participant Sync as Versioned document synchronization
    participant Adapter as Tauri Java intelligence adapter
    participant Native as Native JDT LS service
    participant JDT as Eclipse JDT LS
    Developer->>Monaco: Open or edit a Java source buffer
    Monaco->>Controller: Request hints for visible UTF-16 range
    Controller->>Sync: Flush pending didChange
    Sync-->>Controller: Current synchronized document
    Controller->>Adapter: Capability-gated request with workspace, generation and version
    Adapter->>Native: Typed inlay-hint range request
    Native->>Native: Check session, open version and range boundaries
    Native->>JDT: textDocument/inlayHint
    JDT-->>Native: Provider hints
    Native->>Native: Keep bounded plain labels inside the requested range
    Native-->>Adapter: Normalized hints or explicit refusal
    Adapter-->>Controller: Current-document result
    Controller->>Controller: Reject an edited buffer or replaced session
    Controller-->>Monaco: Hints for the unchanged visible range
    Monaco-->>Developer: Inline parameter-name hints
```
