# Executable feature inventory

`features/**/*.feature` is the configured runner-neutral source for executable requirements and the behavioral backlog. The repository intentionally has no `PLAN.md`; requirement identity and implementation status live in Gherkin.

## Current inventory

| Feature file                                                  | Requirement              | Target  | Classification                | Declared status                  |
| ------------------------------------------------------------- | ------------------------ | ------- | ----------------------------- | -------------------------------- |
| `workspace/startup-tooling.feature`                           | `REQ-WEB-001`            | Web     | Functional                    | `@implemented-and-validated`     |
| `workspace/application-content-layout.feature`                | `REQ-LAYOUT-WEB-001`     | Web     | Functional and non-functional | `@implemented-and-validated`     |
| `workspace/application-content-layout.feature`                | `REQ-LAYOUT-DESKTOP-001` | Desktop | Functional and non-functional | `@implemented-not-e2e-validated` |
| `refactorkit/typescript-compiler-diagnostics.feature`         | `REQ-REFACTORKIT-TS-001` | Desktop | Functional and non-functional | `@not-implemented`               |
| `refactorkit/typescript-javascript-symbol-definition.feature` | `REQ-REFACTORKIT-TS-002` | Desktop | Functional and non-functional | `@not-implemented`               |

`REQ-WEB-001` and `REQ-LAYOUT-WEB-001` are selected by the implemented web profile and validated through Playwright. `REQ-LAYOUT-DESKTOP-001` is selected by the deterministic `desktop/tauri-harness` aggregate, which is not packaged native GUI/E2E evidence. Packaged native GUI validation remains absent. Both RefactorKit requirements are parked because of documented upstream bugs; supporting implementation or focused test evidence does not promote their declared `@not-implemented` status.

## Status and profile semantics

- Every production scenario owns one repository-unique `@REQ-*` ID, at least one requirement classification, and exactly one effective status.
- A status is a product implementation declaration, not a summary of every supporting test result. Focused fixtures, adapter tests, or protocol probes do not change it.
- `@implemented-and-validated @web` scenarios run through the Playwright web profile. The current selection contains two scenarios: `REQ-WEB-001` and `REQ-LAYOUT-WEB-001`.
- `@implemented-not-e2e-validated @desktop` scenarios run through the deterministic `desktop/tauri-harness` aggregate. It currently selects the `REQ-LAYOUT-DESKTOP-001` scenario but is not packaged native GUI/E2E evidence; packaged native GUI validation remains absent.
- `@not-implemented` scenarios are excluded from implemented aggregates. This currently excludes `REQ-REFACTORKIT-TS-001` and `REQ-REFACTORKIT-TS-002`.
