# IDE

A Tauri desktop IDE with a reusable browser frontend, Monaco editing, Java tooling, RefactorKit integration, and a workspace-scoped Pi agent.

**[Read the architecture, current capabilities, limitations, and roadmap in ARC42](ARC42.md).** That document is the single source of truth; this README is only an entry point.

## Get started

Install the repository's supported Node.js/pnpm versions and the native Tauri prerequisites, then run:

```bash
pnpm install
pnpm dev:web
# Or, with the native prerequisites installed:
pnpm --filter @ide/desktop tauri dev
```

For Java tools, packaging, builds, and test commands, see [ARC42 section 7](ARC42.md#section-7-deployment-view). For the Java Run workflow and its debugger limits, see [section 6.3](ARC42.md#63-java-execution).

## Documentation

- [Architecture and roadmap](ARC42.md)
- [Architecture decisions, indexed in ARC42 chapter 9](ARC42.md#section-9-architectural-decisions)
- [Requirements appendix](docs/arc42/appendix-requirements.adoc)
- [C4 diagrams](docs/c4/README.md)
- [Repository contribution and documentation rules](AGENTS.md)
