# C4 System Context

Architecture description: [ARC42 chapter 3](../../ARC42.md#section-3-system-context--external-actors).

```mermaid
flowchart LR
    Developer[Developer] --> IDE[IDE application]
    IDE --> Files[Workspace filesystem and Git]
    IDE --> JDT[Eclipse JDT LS]
    IDE --> RK[RefactorKit]
    IDE --> Tools[JDK, Maven and Gradle]
    IDE -->|Requests external login| Browser[System browser]
    Developer -->|Reviews login and consent| Browser
    Browser --> Identity[User-selected authorization server]
    Browser -->|Loopback authorization response| IDE
    IDE -->|Explicit token exchange| Identity
    IDE --> Http[User-selected HTTP service]
    IDE --> Database[User-selected JDBC database]
    IDE --> Pi[Pi interactive runtime]
    IDE --> XCOM[Steam and XCOM installation]
```

Detailed model and relationships: [workspace.dsl](workspace.dsl), view `IdeSystemContext`.
