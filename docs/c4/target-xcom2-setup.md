# XCOM Integration Diagram

Scope and limitations: [ARC42 section 5.3](../../ARC42.md#53-pi-and-first-party-xcom-features).

```mermaid
flowchart TB
    Settings[Machine Settings] --> Monitor[Read-only Steam monitor]
    Settings --> SDK[Reviewed SDK transactions and restore]
    Workspace[Authorized workspace] --> Recognition[Conventional or configured recognition]
    Recognition --> Recipe[Metadata-only build recipe review]
    Foundry[Project Foundry dialog] --> Render[Native committed-template renderer]
    Render --> Approval[Exact reviewed plan approval]
    Approval --> Create[Non-replacing native project creation]
```

There is no recipe-execution edge: approval of metadata is not an executor. Detailed model: [workspace.dsl](workspace.dsl), XCOM recognition and Foundry views.
